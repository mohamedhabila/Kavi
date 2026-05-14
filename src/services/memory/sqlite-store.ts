// ---------------------------------------------------------------------------
// Kavi — SQLite Memory Store
// ---------------------------------------------------------------------------
// Persistent embedding-backed memory using expo-sqlite. Replaces the
// in-memory memoryIndex from embeddings.ts with durable storage. Provides
// batch embedding, content-hash deduplication, and efficient retrieval.

import * as SQLite from 'expo-sqlite';
import { cosineSimilarity, getEmbeddingCached } from './embeddings';
import { temporalDecay } from './embeddings';
import {
  readConversationMemory,
  readGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
} from './store';
import type { EmbeddingConfig, MemorySearchResult } from '../../types';

// ── Constants ────────────────────────────────────────────────────────────

const DB_NAME = 'kavi-memory.db';
const BATCH_SIZE = 5;
const BATCH_CONCURRENCY = 3;

export interface MemorySqliteScopeOptions {
  scope?: 'global' | 'conversation' | 'all';
  conversationId?: string;
  taskId?: string;
  projectId?: string;
  maxDailyFiles?: number;
}

export interface MemorySqliteSearchConfig {
  embedding?: EmbeddingConfig;
  vectorWeight?: number;
  textWeight?: number;
  temporalWeight?: number;
  maxResults?: number;
}

export interface InsertChunkOptions {
  scope?: 'global' | 'conversation' | 'daily';
  conversationId?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  sourceKey?: string;
  sourceKind?: string;
  version?: number;
}

// ── Database initialization ──────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

function ensureMemoryChunkColumn(
  database: SQLite.SQLiteDatabase,
  column: string,
  definition: string,
): void {
  try {
    database.execSync(`ALTER TABLE memory_chunks ADD COLUMN ${column} ${definition}`);
  } catch {
    // Column already exists on upgraded databases.
  }
}

function ensureMemoryChunkSchema(database: SQLite.SQLiteDatabase): void {
  database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        timestamp INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        conversation_id TEXT,
        task_id TEXT,
        project_id TEXT,
        source_key TEXT,
        source_kind TEXT NOT NULL DEFAULT 'memory_file',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at INTEGER,
        UNIQUE(content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON memory_chunks(content_hash);
      CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON memory_chunks(timestamp);
      CREATE INDEX IF NOT EXISTS idx_chunks_scope_source
        ON memory_chunks(scope, conversation_id, task_id, project_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_chunks_source_key
        ON memory_chunks(source_key, deleted_at);
    `);
  ensureMemoryChunkColumn(database, 'scope', "TEXT NOT NULL DEFAULT 'global'");
  ensureMemoryChunkColumn(database, 'conversation_id', 'TEXT');
  ensureMemoryChunkColumn(database, 'task_id', 'TEXT');
  ensureMemoryChunkColumn(database, 'project_id', 'TEXT');
  ensureMemoryChunkColumn(database, 'source_key', 'TEXT');
  ensureMemoryChunkColumn(database, 'source_kind', "TEXT NOT NULL DEFAULT 'memory_file'");
  ensureMemoryChunkColumn(database, 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureMemoryChunkColumn(database, 'deleted_at', 'INTEGER');
}

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    ensureMemoryChunkSchema(db);
  }
  return db;
}

export function closeMemoryDb(): void {
  if (db) {
    db.closeSync();
    db = null;
  }
}

// ── Content hashing (FNV-1a for speed) ───────────────────────────────────

function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── Chunk storage ────────────────────────────────────────────────────────

export interface MemoryChunk {
  id: number;
  source: string;
  content: string;
  contentHash: string;
  embedding: number[] | null;
  timestamp: number;
  indexedAt: number;
  scope: 'global' | 'conversation' | 'daily';
  conversationId: string | null;
  taskId: string | null;
  projectId: string | null;
  sourceKey: string;
  sourceKind: string;
  version: number;
  deletedAt: number | null;
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeChunkScope(
  raw: unknown,
  source: string,
): 'global' | 'conversation' | 'daily' {
  if (raw === 'conversation' || raw === 'daily') return raw;
  if (source.startsWith('conversation/')) return 'conversation';
  if (source.startsWith('daily/')) return 'daily';
  return 'global';
}

function inferChunkScope(source: string): 'global' | 'conversation' | 'daily' {
  return normalizeChunkScope(undefined, source);
}

function chunkSourceKey(source: string, options: InsertChunkOptions): string {
  if (options.sourceKey?.trim()) return options.sourceKey.trim();
  const scope = options.scope ?? inferChunkScope(source);
  const id = options.conversationId ?? options.taskId ?? options.projectId ?? '';
  return [scope, id, source].filter(Boolean).join(':');
}

function rowToChunk(row: any): MemoryChunk {
  const scope = normalizeChunkScope(row.scope, row.source);
  return {
    id: row.id,
    source: row.source,
    content: row.content,
    contentHash: row.content_hash,
    embedding: parseEmbedding(row.embedding),
    timestamp: row.timestamp,
    indexedAt: row.indexed_at,
    scope,
    conversationId: row.conversation_id ?? null,
    taskId: row.task_id ?? null,
    projectId: row.project_id ?? null,
    sourceKey: row.source_key ?? chunkSourceKey(row.source, { scope }),
    sourceKind: row.source_kind ?? 'memory_file',
    version: row.version ?? 1,
    deletedAt: row.deleted_at ?? null,
  };
}

export function insertChunk(
  source: string,
  content: string,
  timestamp: number,
  embedding?: number[],
  options: InsertChunkOptions = {},
): boolean {
  const scope = options.scope ?? inferChunkScope(source);
  const sourceKey = chunkSourceKey(source, { ...options, scope });
  const sourceKind = options.sourceKind ?? 'memory_file';
  const version = Math.max(1, options.version ?? 1);
  const hash = fnv1aHash(`${sourceKey}\n${source}\n${content}`);
  const database = getMemoryDb();

  try {
    database.runSync(
      `INSERT OR IGNORE INTO memory_chunks
        (source, content, content_hash, embedding, timestamp, indexed_at,
         scope, conversation_id, task_id, project_id, source_key, source_kind, version, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      source,
      content,
      hash,
      embedding ? JSON.stringify(embedding) : null,
      timestamp,
      Date.now(),
      scope,
      options.conversationId ?? null,
      options.taskId ?? null,
      options.projectId ?? null,
      sourceKey,
      sourceKind,
      version,
    );
    return true;
  } catch {
    return false;
  }
}

export function updateChunkEmbedding(id: number, embedding: number[]): void {
  const database = getMemoryDb();
  database.runSync(
    `UPDATE memory_chunks SET embedding = ?, indexed_at = ? WHERE id = ?`,
    JSON.stringify(embedding),
    Date.now(),
    id,
  );
}

export function getChunksWithoutEmbeddings(limit: number = 100): MemoryChunk[] {
  const database = getMemoryDb();
  const rows = database.getAllSync(
    `SELECT id, source, content, content_hash, embedding, timestamp, indexed_at,
            scope, conversation_id, task_id, project_id, source_key, source_kind, version, deleted_at
     FROM memory_chunks WHERE embedding IS NULL AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT ?`,
    limit,
  ) as any[];

  return rows.map(rowToChunk);
}

export function getAllChunks(): MemoryChunk[] {
  const database = getMemoryDb();
  const rows = database.getAllSync(
    `SELECT id, source, content, content_hash, embedding, timestamp, indexed_at,
            scope, conversation_id, task_id, project_id, source_key, source_kind, version, deleted_at
     FROM memory_chunks WHERE deleted_at IS NULL ORDER BY timestamp DESC`,
  ) as any[];

  return rows.map(rowToChunk);
}

export function getChunkCount(): number {
  const database = getMemoryDb();
  const row = database.getFirstSync('SELECT COUNT(*) as count FROM memory_chunks') as any;
  return row?.count ?? 0;
}

export function deleteChunksBySource(source: string): number {
  const database = getMemoryDb();
  const result = database.runSync('DELETE FROM memory_chunks WHERE source = ?', source);
  return result.changes;
}

export function clearAllChunks(): void {
  const database = getMemoryDb();
  database.runSync('DELETE FROM memory_chunks');
}

export function replaceChunksForSource(
  source: string,
  chunks: Array<{ content: string; timestamp: number; embedding?: number[] }>,
  options: InsertChunkOptions = {},
): number {
  const database = getMemoryDb();
  const sourceKey = chunkSourceKey(source, options);
  database.runSync('DELETE FROM memory_chunks WHERE source_key = ? OR source = ?', sourceKey, source);
  let inserted = 0;
  for (const chunk of chunks) {
    if (insertChunk(source, chunk.content, chunk.timestamp, chunk.embedding, {
      ...options,
      sourceKey,
    })) {
      inserted += 1;
    }
  }
  return inserted;
}

// ── Batch embedding ──────────────────────────────────────────────────────

export async function batchEmbedChunks(
  config: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const chunks = getChunksWithoutEmbeddings(200);
  if (chunks.length === 0) return 0;

  let embedded = 0;

  // Process in batches with limited concurrency
  for (let i = 0; i < chunks.length; i += BATCH_SIZE * BATCH_CONCURRENCY) {
    const batchGroup = chunks.slice(i, i + BATCH_SIZE * BATCH_CONCURRENCY);
    const promises: Promise<void>[] = [];

    for (let j = 0; j < batchGroup.length; j += BATCH_SIZE) {
      const batch = batchGroup.slice(j, j + BATCH_SIZE);
      promises.push(
        (async () => {
          for (const chunk of batch) {
            try {
              const embedding = await getEmbeddingCached(chunk.content, config);
              updateChunkEmbedding(chunk.id, embedding);
              embedded++;
              onProgress?.(embedded, chunks.length);
            } catch {
              // Skip failed embeddings, they'll be retried next time
            }
          }
        })(),
      );
    }

    await Promise.all(promises);
  }

  return embedded;
}

// ── Index from file-based memory into SQLite ─────────────────────────────

export async function indexMemoryToSqlite(
  config?: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
  options?: MemorySqliteScopeOptions,
): Promise<number> {
  let indexed = 0;
  const scope = options?.scope;
  const maxDailyFiles = options?.maxDailyFiles || 60;

  if (!scope || scope === 'global' || scope === 'all') {
    const global = await readGlobalMemory();
    if (global) {
      const sections = global.split(/\n(?=#{1,3}\s)/)
        .map((section) => section.trim())
        .filter(Boolean)
        .map((content) => ({ content, timestamp: Date.now() }));
      indexed += replaceChunksForSource('MEMORY.md', sections, {
        scope: 'global',
        sourceKey: 'global:MEMORY.md',
        sourceKind: 'memory_file',
      });
    }
  }

  if ((scope === 'conversation' || scope === 'all') && options?.conversationId) {
    const conversationMemory = await readConversationMemory(options.conversationId);
    if (conversationMemory) {
      const sections = conversationMemory.split(/\n(?=#{1,3}\s)/)
        .map((section) => section.trim())
        .filter(Boolean)
        .map((content) => ({ content, timestamp: Date.now() }));
      indexed += replaceChunksForSource(
        `conversation/${options.conversationId}/MEMORY.md`,
        sections,
        {
          scope: 'conversation',
          conversationId: options.conversationId,
          sourceKey: `conversation:${options.conversationId}:MEMORY.md`,
          sourceKind: 'memory_file',
        },
      );
    }
  }

  if (!scope || scope === 'global' || scope === 'all') {
    const dailyFiles = listDailyMemoryFiles();
    for (const dateStr of dailyFiles.slice(0, maxDailyFiles)) {
      const content = await readDailyMemory(dateStr);
      if (!content) continue;

      const dateMs = new Date(dateStr).getTime() || Date.now();
      const sections = content.split(/\n---\n/);
      const chunks = sections
        .map((section) => section.trim())
        .filter(Boolean)
        .map((section) => ({ content: section, timestamp: dateMs }));
      indexed += replaceChunksForSource(`daily/${dateStr}.md`, chunks, {
        scope: 'daily',
        sourceKey: `daily:${dateStr}`,
        sourceKind: 'daily_memory',
      });
    }
  }

  // Optionally embed new chunks
  if (config) {
    await batchEmbedChunks(config, onProgress);
  }

  return indexed;
}

// ── Semantic search using SQLite-stored embeddings ───────────────────────

export async function sqliteHybridSearch(
  query: string,
  config: MemorySqliteSearchConfig,
  options?: MemorySqliteScopeOptions,
): Promise<MemorySearchResult[]> {
  const { vectorWeight = 0.6, textWeight = 0.3, temporalWeight = 0.1, maxResults = 10 } = config;

  // Get query embedding
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = config.embedding ? await getEmbeddingCached(query, config.embedding) : null;
  } catch {
    // Fall back to text-only search
  }

  const requestedScope = options?.scope || 'global';
  const queryTokens = tokenizeForSearch(query);

  // Score all chunks from SQLite
  const chunks = getAllChunks();
  const scored: MemorySearchResult[] = [];

  for (const chunk of chunks) {
    if (requestedScope === 'global' && chunk.scope === 'conversation') {
      continue;
    }
    if (requestedScope === 'conversation') {
      if (chunk.scope !== 'conversation') continue;
      if (options?.conversationId && chunk.conversationId !== options.conversationId) continue;
    }
    if (requestedScope === 'all' && chunk.scope === 'conversation' && options?.conversationId) {
      if (chunk.conversationId !== options.conversationId) continue;
    }
    if (options?.taskId && chunk.taskId && chunk.taskId !== options.taskId) {
      continue;
    }
    if (options?.projectId && chunk.projectId && chunk.projectId !== options.projectId) {
      continue;
    }

    let vectorScore = 0;
    if (queryEmbedding && chunk.embedding) {
      vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    const textScore = lexicalSearchScore(queryTokens, chunk.content);
    const temporalScore = temporalDecay(chunk.timestamp);

    const combinedScore =
      vectorWeight * vectorScore + textWeight * textScore + temporalWeight * temporalScore;

    if (combinedScore > 0.01) {
      scored.push({
        source: chunk.source,
        scope: chunk.scope,
        snippet: chunk.content.slice(0, 500),
        score: combinedScore,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by content prefix
  const seen = new Set<string>();
  const deduped: MemorySearchResult[] = [];
  for (const result of scored) {
    const key = result.snippet.slice(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}

function tokenizeForSearch(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 2),
  );
}

function lexicalSearchScore(queryTokens: Set<string>, content: string): number {
  if (queryTokens.size === 0) return 0;
  const contentLower = content.toLowerCase();
  const contentTokens = tokenizeForSearch(content);
  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) hits += 1;
  }
  const overlap = hits / queryTokens.size;
  const phraseBoost = contentLower.includes(Array.from(queryTokens).join(' ')) ? 0.15 : 0;
  return Math.min(1, overlap + phraseBoost);
}
