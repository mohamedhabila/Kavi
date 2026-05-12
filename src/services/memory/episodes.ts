// ---------------------------------------------------------------------------
// Kavi — Episodic memory store
// ---------------------------------------------------------------------------
// Compact turn summaries and source evidence for durable facts. Episodes are
// searchable old-memory anchors; facts link back through memory_fact_evidence.
// ---------------------------------------------------------------------------

import { insertChunk } from './sqlite-store';
import {
  ensureFactSchema,
  newId,
  safeParseArray,
} from './schema';
import { getMemoryDb } from './sqlite-store';

export interface MemoryEpisode {
  id: string;
  conversationId: string | null;
  threadId: string | null;
  taskId: string | null;
  startedAt: number;
  endedAt: number;
  summary: string;
  entities: string[];
  messageIds: string[];
  toolNames: string[];
  importance: number;
  embedding: number[] | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface MemoryFactEvidence {
  id: string;
  factId: string;
  episodeId: string | null;
  messageId: string | null;
  role: string | null;
  quote: string | null;
  createdAt: number;
}

interface EpisodeRow {
  id: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  started_at: number;
  ended_at: number;
  summary: string;
  entities_json: string;
  message_ids_json: string;
  tool_names_json: string;
  importance: number;
  embedding: string | null;
  created_at: number;
  deleted_at: number | null;
}

interface EvidenceRow {
  id: string;
  fact_id: string;
  episode_id: string | null;
  message_id: string | null;
  role: string | null;
  quote: string | null;
  created_at: number;
}

function clamp01(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(value as number, 1));
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : null;
  } catch {
    return null;
  }
}

function rowToEpisode(row: EpisodeRow): MemoryEpisode {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    entities: safeParseArray<string>(row.entities_json),
    messageIds: safeParseArray<string>(row.message_ids_json),
    toolNames: safeParseArray<string>(row.tool_names_json),
    importance: clamp01(row.importance),
    embedding: parseEmbedding(row.embedding),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function rowToEvidence(row: EvidenceRow): MemoryFactEvidence {
  return {
    id: row.id,
    factId: row.fact_id,
    episodeId: row.episode_id,
    messageId: row.message_id,
    role: row.role,
    quote: row.quote,
    createdAt: row.created_at,
  };
}

export interface RecordEpisodeInput {
  conversationId?: string | null;
  threadId?: string | null;
  taskId?: string | null;
  startedAt?: number;
  endedAt?: number;
  summary: string;
  entities?: string[];
  messageIds?: string[];
  toolNames?: string[];
  importance?: number;
  embedding?: number[] | null;
  now?: number;
}

export function recordEpisode(input: RecordEpisodeInput): MemoryEpisode | null {
  ensureFactSchema();
  const summary = input.summary.trim();
  if (!summary) return null;
  const now = input.now ?? Date.now();
  const startedAt = input.startedAt ?? input.endedAt ?? now;
  const endedAt = input.endedAt ?? startedAt;
  const episode: MemoryEpisode = {
    id: newId('episode'),
    conversationId: input.conversationId ?? null,
    threadId: input.threadId ?? input.conversationId ?? null,
    taskId: input.taskId ?? null,
    startedAt,
    endedAt,
    summary: summary.length > 1200 ? `${summary.slice(0, 1199).trimEnd()}...` : summary,
    entities: Array.from(new Set(input.entities ?? [])).slice(0, 24),
    messageIds: Array.from(new Set(input.messageIds ?? [])).slice(0, 128),
    toolNames: Array.from(new Set(input.toolNames ?? [])).slice(0, 64),
    importance: clamp01(input.importance),
    embedding: input.embedding ?? null,
    createdAt: now,
    deletedAt: null,
  };
  getMemoryDb().runSync(
    `INSERT INTO memory_episodes
       (id, conversation_id, thread_id, task_id, started_at, ended_at, summary,
        entities_json, message_ids_json, tool_names_json, importance, embedding, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    episode.id,
    episode.conversationId,
    episode.threadId,
    episode.taskId,
    episode.startedAt,
    episode.endedAt,
    episode.summary,
    JSON.stringify(episode.entities),
    JSON.stringify(episode.messageIds),
    JSON.stringify(episode.toolNames),
    episode.importance,
    episode.embedding ? JSON.stringify(episode.embedding) : null,
    episode.createdAt,
  );
  insertChunk(
    episode.conversationId ? `conversation/episode/${episode.id}` : `episode/${episode.id}`,
    episode.summary,
    episode.endedAt,
    episode.embedding ?? undefined,
  );
  return episode;
}

export interface AddFactEvidenceInput {
  factId: string;
  episodeId?: string | null;
  messageId?: string | null;
  role?: string | null;
  quote?: string | null;
  now?: number;
}

export function addFactEvidence(input: AddFactEvidenceInput): MemoryFactEvidence | null {
  ensureFactSchema();
  if (!input.factId.trim()) return null;
  const now = input.now ?? Date.now();
  const evidence: MemoryFactEvidence = {
    id: newId('evidence'),
    factId: input.factId,
    episodeId: input.episodeId ?? null,
    messageId: input.messageId ?? null,
    role: input.role ?? null,
    quote: input.quote ? input.quote.trim().slice(0, 400) : null,
    createdAt: now,
  };
  getMemoryDb().runSync(
    `INSERT INTO memory_fact_evidence
       (id, fact_id, episode_id, message_id, role, quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    evidence.id,
    evidence.factId,
    evidence.episodeId,
    evidence.messageId,
    evidence.role,
    evidence.quote,
    evidence.createdAt,
  );
  return evidence;
}

export interface ListEpisodesOptions {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export function listEpisodes(options: ListEpisodesOptions = {}): MemoryEpisode[] {
  ensureFactSchema();
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }
  if (options.threadId) {
    clauses.push('thread_id = ?');
    params.push(options.threadId);
  }
  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const rows = getMemoryDb().getAllSync<EpisodeRow>(
    `SELECT * FROM memory_episodes ${where} ORDER BY ended_at DESC LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToEpisode);
}

export function listFactEvidence(factId: string): MemoryFactEvidence[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<EvidenceRow>(
    `SELECT * FROM memory_fact_evidence WHERE fact_id = ? ORDER BY created_at DESC`,
    factId,
  );
  return rows.map(rowToEvidence);
}
