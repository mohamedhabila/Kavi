// ---------------------------------------------------------------------------
// Kavi — SQLite Memory Store
// ---------------------------------------------------------------------------
// Persistent embedding-backed memory using expo-sqlite. Replaces the
// in-memory memoryIndex from embeddings.ts with durable storage. Provides
// batch embedding, content-hash deduplication, and efficient retrieval.

import * as SQLite from 'expo-sqlite';
import { cosineSimilarity, getEmbeddingCached, type HybridSearchConfig } from './embeddings';
import { temporalDecay } from './embeddings';
import {
  readConversationMemory,
  readGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
} from './store';
import type { EmbeddingConfig, MemorySearchResult } from '../../types';
import { searchMemory } from './store';

// ── Constants ────────────────────────────────────────────────────────────

const DB_NAME = 'kavi-memory.db';
const BATCH_SIZE = 5;
const BATCH_CONCURRENCY = 3;

export interface MemorySqliteScopeOptions {
  scope?: 'global' | 'conversation' | 'all';
  conversationId?: string;
  maxDailyFiles?: number;
}

// ── Database initialization ──────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    db.execSync(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        timestamp INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        UNIQUE(content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON memory_chunks(content_hash);
      CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON memory_chunks(timestamp);
    `);
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
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function insertChunk(
  source: string,
  content: string,
  timestamp: number,
  embedding?: number[],
): boolean {
  const hash = fnv1aHash(`${source}\n${content}`);
  const database = getMemoryDb();

  try {
    database.runSync(
      `INSERT OR IGNORE INTO memory_chunks (source, content, content_hash, embedding, timestamp, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      source,
      content,
      hash,
      embedding ? JSON.stringify(embedding) : null,
      timestamp,
      Date.now(),
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
    `SELECT id, source, content, content_hash, embedding, timestamp, indexed_at
     FROM memory_chunks WHERE embedding IS NULL ORDER BY timestamp DESC LIMIT ?`,
    limit,
  ) as any[];

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    content: r.content,
    contentHash: r.content_hash,
    embedding: parseEmbedding(r.embedding),
    timestamp: r.timestamp,
    indexedAt: r.indexed_at,
  }));
}

export function getAllChunks(): MemoryChunk[] {
  const database = getMemoryDb();
  const rows = database.getAllSync(
    `SELECT id, source, content, content_hash, embedding, timestamp, indexed_at
     FROM memory_chunks ORDER BY timestamp DESC`,
  ) as any[];

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    content: r.content,
    contentHash: r.content_hash,
    embedding: parseEmbedding(r.embedding),
    timestamp: r.timestamp,
    indexedAt: r.indexed_at,
  }));
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
      const sections = global.split(/\n(?=#{1,3}\s)/);
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        if (insertChunk('MEMORY.md', trimmed, Date.now())) {
          indexed++;
        }
      }
    }
  }

  if ((scope === 'conversation' || scope === 'all') && options?.conversationId) {
    const conversationMemory = await readConversationMemory(options.conversationId);
    if (conversationMemory) {
      const sections = conversationMemory.split(/\n(?=#{1,3}\s)/);
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        if (insertChunk('conversation/MEMORY.md', trimmed, Date.now())) {
          indexed++;
        }
      }
    }
  }

  if (!scope || scope === 'global' || scope === 'all') {
    const dailyFiles = listDailyMemoryFiles();
    for (const dateStr of dailyFiles.slice(0, maxDailyFiles)) {
      const content = await readDailyMemory(dateStr);
      if (!content) continue;

      const dateMs = new Date(dateStr).getTime() || Date.now();
      const sections = content.split(/\n---\n/);
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        if (insertChunk(`daily/${dateStr}.md`, trimmed, dateMs)) {
          indexed++;
        }
      }
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
  config: HybridSearchConfig,
  options?: MemorySqliteScopeOptions,
): Promise<MemorySearchResult[]> {
  const { vectorWeight = 0.6, textWeight = 0.3, temporalWeight = 0.1, maxResults = 10 } = config;

  // Get query embedding
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await getEmbeddingCached(query, config.embedding);
  } catch {
    // Fall back to text-only search
  }

  // Get text search results for text scoring
  const requestedScope = options?.scope || 'global';
  const textResults = await searchMemory(query, {
    scope: requestedScope,
    conversationId: options?.conversationId,
    maxDailyFiles: options?.maxDailyFiles,
  });
  const textScoreMap = new Map<string, number>();
  for (const r of textResults) {
    textScoreMap.set(r.snippet.slice(0, 200), r.score);
  }

  // Score all chunks from SQLite
  const chunks = getAllChunks();
  const scored: MemorySearchResult[] = [];

  for (const chunk of chunks) {
    const isConversationChunk = chunk.source.startsWith('conversation/');
    const isDailyChunk = chunk.source.startsWith('daily/');
    if (requestedScope === 'global' && isConversationChunk) {
      continue;
    }
    if (requestedScope === 'conversation' && !isConversationChunk) {
      continue;
    }

    let vectorScore = 0;
    if (queryEmbedding && chunk.embedding) {
      vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    const textScore = textScoreMap.get(chunk.content.slice(0, 200)) || 0;
    const temporalScore = temporalDecay(chunk.timestamp);

    const combinedScore =
      vectorWeight * vectorScore + textWeight * textScore + temporalWeight * temporalScore;

    if (combinedScore > 0.01) {
      scored.push({
        source: chunk.source,
        scope: isConversationChunk ? 'conversation' : isDailyChunk ? 'daily' : 'global',
        snippet: chunk.content.slice(0, 500),
        score: combinedScore,
      });
    }
  }

  // Fall back to pure text search if no SQLite chunks
  if (chunks.length === 0) {
    return textResults.slice(0, maxResults);
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
