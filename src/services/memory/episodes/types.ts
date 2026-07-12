import { safeParseArray } from '../schema';
import type { MemorySensitivityInput } from '../memorySensitivityPolicy';
import { closedEpisodeSensitivity } from './accessPolicyTypes';
import type { EpisodeSensitivity, EpisodeShareability } from './accessPolicyTypes';

export interface MemoryEpisode {
  id: string;
  conversationId: string | null;
  threadId: string | null;
  taskId: string | null;
  startedAt: number;
  endedAt: number;
  summary: string;
  sensitivity: EpisodeSensitivity;
  entities: string[];
  messageIds: string[];
  toolNames: string[];
  importance: number;
  embedding: number[] | null;
  createdAt: number;
  deletedAt: number | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
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

export interface EpisodeRow {
  id: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  started_at: number;
  ended_at: number;
  summary: string;
  sensitivity: string;
  entities_json: string;
  message_ids_json: string;
  tool_names_json: string;
  importance: number;
  embedding: string | null;
  created_at: number;
  deleted_at: number | null;
  source_start_message_id: string | null;
  source_end_message_id: string | null;
}

export interface EvidenceRow {
  id: string;
  fact_id: string;
  episode_id: string | null;
  message_id: string | null;
  role: string | null;
  quote: string | null;
  created_at: number;
}

export function clamp01(value: number | undefined): number {
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

export function rowToEpisode(row: EpisodeRow): MemoryEpisode {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    sensitivity: closedEpisodeSensitivity(row.sensitivity) ?? 'sensitive',
    entities: safeParseArray<string>(row.entities_json),
    messageIds: safeParseArray<string>(row.message_ids_json),
    toolNames: safeParseArray<string>(row.tool_names_json),
    importance: clamp01(row.importance),
    embedding: parseEmbedding(row.embedding),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
  };
}

export function rowToEvidence(row: EvidenceRow): MemoryFactEvidence {
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
  sourceStartMessageId?: string | null;
  sourceEndMessageId?: string | null;
  /** Raw, code-owned evidence used to derive sensitivity. Missing evidence fails closed. */
  sensitivityEvidence?: EpisodeSensitivityEvidence;
  now?: number;
}

export interface EpisodeSensitivitySourceMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** True when any source field exceeded the bounded classifier input. */
  truncated?: boolean;
}

export interface EpisodeSensitivityEvidence {
  sourceMessages: ReadonlyArray<EpisodeSensitivitySourceMessage>;
  facts: ReadonlyArray<MemorySensitivityInput>;
}

export interface RecordScopedEpisodeInput extends RecordEpisodeInput {
  accessPolicy: RecordEpisodeAccessPolicyInput;
}

export interface RecordEpisodeAccessPolicyInput {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
  shareability: EpisodeShareability;
  expiresAt?: number | null;
}

export interface AddFactEvidenceInput {
  factId: string;
  episodeId?: string | null;
  messageId?: string | null;
  role?: string | null;
  quote?: string | null;
  now?: number;
}

export interface ListEpisodesOptions {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  includeDeleted?: boolean;
  limit?: number;
}
