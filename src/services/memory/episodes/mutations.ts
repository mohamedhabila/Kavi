import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryTransaction } from '../access/transaction';
import { newId } from '../schema';
import { replaceChunksForSource } from '../sqlite-store';
import {
  clamp01,
  type AddFactEvidenceInput,
  type EvidenceRow,
  type EpisodeRow,
  type MemoryEpisode,
  type MemoryFactEvidence,
  type RecordEpisodeInput,
  rowToEpisode,
  rowToEvidence,
} from './types';

export function recordEpisode(input: RecordEpisodeInput): MemoryEpisode | null {
  return runMemoryTransaction(() => recordEpisodeInTransaction(input));
}

function episodeSource(episode: MemoryEpisode): string {
  return episode.conversationId
    ? `conversation/${episode.conversationId}/episode/${episode.id}`
    : `episode/${episode.id}`;
}

function replaceEpisodeChunk(episode: MemoryEpisode): void {
  const source = episodeSource(episode);
  replaceChunksForSource(
    source,
    [
      {
        content: episode.summary,
        timestamp: episode.endedAt,
        embedding: episode.embedding ?? undefined,
      },
    ],
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
}

function recordEpisodeInTransaction(input: RecordEpisodeInput): MemoryEpisode | null {
  const db = getSchemaReadyMemoryDb();
  const summary = input.summary.trim();
  if (!summary) return null;
  const now = input.now ?? Date.now();
  const startedAt = input.startedAt ?? input.endedAt ?? now;
  const endedAt = input.endedAt ?? startedAt;
  const messageIds = Array.from(new Set(input.messageIds ?? [])).slice(0, 128);
  const sourceStartMessageId = input.sourceStartMessageId ?? messageIds[0] ?? null;
  const sourceEndMessageId = input.sourceEndMessageId ?? messageIds[messageIds.length - 1] ?? null;
  const conversationId = input.conversationId ?? null;
  const threadId = input.threadId ?? input.conversationId ?? null;
  const normalizedSummary =
    summary.length > 1200 ? `${summary.slice(0, 1199).trimEnd()}…` : summary;
  const existing = sourceEndMessageId
    ? db.getFirstSync<EpisodeRow>(
        `SELECT * FROM memory_episodes
          WHERE COALESCE(conversation_id, '') = COALESCE(?, '')
            AND COALESCE(thread_id, '') = COALESCE(?, '')
            AND source_end_message_id = ?
            AND deleted_at IS NULL
          LIMIT 1`,
        conversationId,
        threadId,
        sourceEndMessageId,
      )
    : null;

  if (existing) {
    const current = rowToEpisode(existing);
    const episode = {
      ...current,
      taskId: input.taskId === undefined ? current.taskId : input.taskId,
      startedAt: input.startedAt ?? input.endedAt ?? current.startedAt,
      endedAt: input.endedAt ?? input.startedAt ?? current.endedAt,
      summary: normalizedSummary,
      entities:
        input.entities === undefined
          ? current.entities
          : Array.from(new Set(input.entities)).slice(0, 24),
      messageIds: input.messageIds === undefined ? current.messageIds : messageIds,
      toolNames:
        input.toolNames === undefined
          ? current.toolNames
          : Array.from(new Set(input.toolNames)).slice(0, 64),
      importance: input.importance === undefined ? current.importance : clamp01(input.importance),
      embedding: input.embedding === undefined ? current.embedding : input.embedding,
      sourceStartMessageId: sourceStartMessageId ?? current.sourceStartMessageId,
      sourceEndMessageId,
    } satisfies MemoryEpisode;
    if (JSON.stringify(episode) !== JSON.stringify(current)) {
      db.runSync(
        `UPDATE memory_episodes
            SET task_id = ?,
                started_at = ?,
                ended_at = ?,
                summary = ?,
                entities_json = ?,
                message_ids_json = ?,
                tool_names_json = ?,
                importance = ?,
                embedding = ?,
                source_start_message_id = ?
          WHERE id = ?`,
        episode.taskId,
        episode.startedAt,
        episode.endedAt,
        episode.summary,
        JSON.stringify(episode.entities),
        JSON.stringify(episode.messageIds),
        JSON.stringify(episode.toolNames),
        episode.importance,
        episode.embedding ? JSON.stringify(episode.embedding) : null,
        episode.sourceStartMessageId,
        episode.id,
      );
      if (
        episode.summary !== current.summary ||
        episode.endedAt !== current.endedAt ||
        episode.taskId !== current.taskId ||
        JSON.stringify(episode.embedding) !== JSON.stringify(current.embedding)
      ) {
        replaceEpisodeChunk(episode);
      }
    }
    return episode;
  }

  const episode: MemoryEpisode = {
    id: newId('episode'),
    conversationId,
    threadId,
    taskId: input.taskId ?? null,
    startedAt,
    endedAt,
    summary: normalizedSummary,
    entities: Array.from(new Set(input.entities ?? [])).slice(0, 24),
    messageIds,
    toolNames: Array.from(new Set(input.toolNames ?? [])).slice(0, 64),
    importance: clamp01(input.importance),
    embedding: input.embedding ?? null,
    createdAt: now,
    deletedAt: null,
    sourceStartMessageId,
    sourceEndMessageId,
  };
  db.runSync(
    `INSERT INTO memory_episodes
       (id, conversation_id, thread_id, task_id, started_at, ended_at, summary,
        entities_json, message_ids_json, tool_names_json, importance, embedding, created_at,
        deleted_at, source_start_message_id, source_end_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
    episode.sourceStartMessageId,
    episode.sourceEndMessageId,
  );
  replaceEpisodeChunk(episode);
  return episode;
}

export function addFactEvidence(input: AddFactEvidenceInput): MemoryFactEvidence | null {
  const db = getSchemaReadyMemoryDb();
  if (!input.factId.trim()) return null;
  const now = input.now ?? Date.now();
  const messageId = input.messageId ?? null;
  if (messageId) {
    const existing = db.getFirstSync<EvidenceRow>(
      `SELECT * FROM memory_fact_evidence
        WHERE fact_id = ? AND message_id = ?
        LIMIT 1`,
      input.factId,
      messageId,
    );
    if (existing) {
      const episodeId = existing.episode_id ?? input.episodeId ?? null;
      const role = existing.role ?? input.role ?? null;
      const quote = existing.quote ?? (input.quote ? input.quote.trim().slice(0, 400) : null);
      if (episodeId !== existing.episode_id || role !== existing.role || quote !== existing.quote) {
        db.runSync(
          `UPDATE memory_fact_evidence
              SET episode_id = ?, role = ?, quote = ?
            WHERE id = ?`,
          episodeId,
          role,
          quote,
          existing.id,
        );
      }
      return rowToEvidence({
        ...existing,
        episode_id: episodeId,
        role,
        quote,
      });
    }
  }
  const evidence: MemoryFactEvidence = {
    id: newId('evidence'),
    factId: input.factId,
    episodeId: input.episodeId ?? null,
    messageId,
    role: input.role ?? null,
    quote: input.quote ? input.quote.trim().slice(0, 400) : null,
    createdAt: now,
  };
  const inserted = db.runSync(
    `INSERT OR IGNORE INTO memory_fact_evidence
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
  if ((inserted.changes ?? 0) === 0 && messageId) {
    const existing = db.getFirstSync<EvidenceRow>(
      `SELECT * FROM memory_fact_evidence
        WHERE fact_id = ? AND message_id = ?
        LIMIT 1`,
      input.factId,
      messageId,
    );
    if (existing) return rowToEvidence(existing);
  }
  return evidence;
}
