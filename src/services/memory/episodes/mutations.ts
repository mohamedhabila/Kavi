import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { newId } from '../schema';
import { insertChunk } from '../sqlite-store';
import {
  clamp01,
  type AddFactEvidenceInput,
  type MemoryEpisode,
  type MemoryFactEvidence,
  type RecordEpisodeInput,
} from './types';

export function recordEpisode(input: RecordEpisodeInput): MemoryEpisode | null {
  const db = getSchemaReadyMemoryDb();
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
  db.runSync(
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
    episode.conversationId
      ? `conversation/${episode.conversationId}/episode/${episode.id}`
      : `episode/${episode.id}`,
    episode.summary,
    episode.endedAt,
    episode.embedding ?? undefined,
    {
      scope: episode.conversationId ? 'conversation' : 'global',
      conversationId: episode.conversationId,
      taskId: episode.taskId,
      sourceKey: episode.conversationId
        ? `conversation:${episode.conversationId}:episode:${episode.id}`
        : `global:episode:${episode.id}`,
      sourceKind: 'episode',
    },
  );
  return episode;
}

export function addFactEvidence(input: AddFactEvidenceInput): MemoryFactEvidence | null {
  const db = getSchemaReadyMemoryDb();
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
  db.runSync(
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
