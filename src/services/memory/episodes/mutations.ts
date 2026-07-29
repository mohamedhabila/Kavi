import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { assertMemoryTransactionActive, runMemoryTransaction } from '../access/transaction';
import { newId } from '../schemaValues';
import { ensureEpisodeAccessPolicySchema } from './accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { bindEpisodeAccessPolicy } from './accessPolicyStore';
import { replaceEpisodeRetrievalTermsInTransaction } from './retrievalIndex';
import { deriveEpisodeSensitivity, maxEpisodeSensitivity } from './sensitivityPolicy';
import { closedEpisodeSensitivity, type EpisodeSensitivity } from './accessPolicyTypes';
import {
  advanceMemoryProjectionInTransaction,
  advanceRestrictiveMemoryAuthorityInTransaction,
} from '../memoryAuthority';
import {
  buildEpisodeSourceIdentityManifest,
  decodeEpisodeSourceIdentityManifest,
  encodeEpisodeSourceIdentityManifest,
  episodeSourceIdentityManifestsEqual,
} from './sourceIdentity';
import {
  clamp01,
  type AddFactEvidenceInput,
  type EvidenceRow,
  type EpisodeRow,
  type MemoryEpisode,
  type MemoryFactEvidence,
  type RecordEpisodeInput,
  type RecordScopedEpisodeInput,
  rowToEpisode,
  rowToEvidence,
} from './types';

export function recordThreadLocalEpisode(input: RecordEpisodeInput): MemoryEpisode | null {
  const now = input.now ?? Date.now();
  return runMemoryTransaction(() => recordEpisodeInTransaction({ ...input, now }));
}

export function recordEpisode(input: RecordScopedEpisodeInput): MemoryEpisode | null {
  if (!input.accessPolicy) throw new Error('episode_access_policy_required');
  const now = input.now ?? Date.now();
  return runMemoryTransaction(() => {
    const episode = recordEpisodeInTransaction({
      ...input,
      taskId: input.accessPolicy.taskId,
      now,
    });
    if (!episode) return episode;
    const db = getSchemaReadyMemoryDb();
    ensureEpisodeAccessPolicySchema(db, now);
    bindEpisodeAccessPolicy(
      db,
      {
        episodeId: episode.id,
        memoryOwnerId: getLocalMemoryVaultOwnerId(db),
        memoryConversationId: input.accessPolicy.memoryConversationId,
        sourceThreadId: input.accessPolicy.sourceThreadId,
        personaId: input.accessPolicy.personaId,
        taskId: input.accessPolicy.taskId,
        shareability: input.accessPolicy.shareability,
        ...(input.accessPolicy.expiresAt === undefined
          ? {}
          : { expiresAt: input.accessPolicy.expiresAt }),
        boundAt: now,
      },
      now,
    );
    return episode;
  });
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
  const current = existing ? rowToEpisode(existing) : null;
  const replayTaskId = input.taskId ?? null;
  if (
    current &&
    (current.taskId !== replayTaskId ||
      current.startedAt !== startedAt ||
      current.endedAt !== endedAt ||
      current.sourceStartMessageId !== sourceStartMessageId ||
      JSON.stringify(current.messageIds) !== JSON.stringify(messageIds))
  ) {
    throw new Error('episode_source_identity_conflict');
  }
  const priorSensitivity = existing
    ? maxEpisodeSensitivity(current!.sensitivity, readPersistedPolicySensitivity(db, existing.id))
    : undefined;
  const sensitivity = deriveEpisodeSensitivity({
    summary: normalizedSummary,
    messageIds,
    sourceStartMessageId,
    sourceEndMessageId,
    evidence: input.sensitivityEvidence,
    priorSensitivity,
  });
  if (sensitivity === 'restricted') return null;
  let sourceIdentityManifest: ReturnType<typeof buildEpisodeSourceIdentityManifest>;
  try {
    sourceIdentityManifest = buildEpisodeSourceIdentityManifest(
      input.sensitivityEvidence!.sourceMessages,
    );
  } catch {
    return null;
  }

  if (existing) {
    const persistedEpisode = current!;
    const existingSourceIdentityManifest = decodeEpisodeSourceIdentityManifest(
      existing.source_identity_manifest_json,
    );
    if (
      !existingSourceIdentityManifest ||
      !episodeSourceIdentityManifestsEqual(existingSourceIdentityManifest, sourceIdentityManifest)
    ) {
      throw new Error('episode_source_identity_conflict');
    }
    const episode = {
      ...persistedEpisode,
      summary: normalizedSummary,
      sensitivity,
      entities:
        input.entities === undefined
          ? persistedEpisode.entities
          : Array.from(new Set(input.entities)).slice(0, 24),
      toolNames:
        input.toolNames === undefined
          ? persistedEpisode.toolNames
          : Array.from(new Set(input.toolNames)).slice(0, 64),
      importance:
        input.importance === undefined ? persistedEpisode.importance : clamp01(input.importance),
      embedding: input.embedding === undefined ? persistedEpisode.embedding : input.embedding,
    } satisfies MemoryEpisode;
    const episodeChanged = JSON.stringify(episode) !== JSON.stringify(persistedEpisode);
    if (episodeChanged) {
      db.runSync(
        `UPDATE memory_episodes
            SET summary = ?,
                entities_json = ?,
                tool_names_json = ?,
                importance = ?,
                embedding = ?,
                sensitivity = ?
          WHERE id = ?`,
        episode.summary,
        JSON.stringify(episode.entities),
        JSON.stringify(episode.toolNames),
        episode.importance,
        episode.embedding ? JSON.stringify(episode.embedding) : null,
        episode.sensitivity,
        episode.id,
      );
      if (
        episode.summary !== persistedEpisode.summary ||
        JSON.stringify(episode.entities) !== JSON.stringify(persistedEpisode.entities) ||
        JSON.stringify(episode.toolNames) !== JSON.stringify(persistedEpisode.toolNames)
      ) {
        replaceEpisodeRetrievalTermsInTransaction(db, episode);
      }
      const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
      const embeddingChanged =
        JSON.stringify(episode.embedding) !== JSON.stringify(persistedEpisode.embedding);
      const restrictiveProjectionChanged =
        episode.summary !== persistedEpisode.summary ||
        JSON.stringify(episode.entities) !== JSON.stringify(persistedEpisode.entities) ||
        JSON.stringify(episode.toolNames) !== JSON.stringify(persistedEpisode.toolNames) ||
        episode.sensitivity !== persistedEpisode.sensitivity ||
        episode.importance < persistedEpisode.importance ||
        (embeddingChanged && persistedEpisode.embedding !== null);
      if (restrictiveProjectionChanged) {
        advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
      } else {
        advanceMemoryProjectionInTransaction(db, memoryOwnerId);
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
    sensitivity,
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
       (id, conversation_id, thread_id, task_id, started_at, ended_at, summary, sensitivity,
        entities_json, message_ids_json, tool_names_json, importance, embedding, created_at,
        deleted_at, source_start_message_id, source_end_message_id, source_identity_manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    episode.id,
    episode.conversationId,
    episode.threadId,
    episode.taskId,
    episode.startedAt,
    episode.endedAt,
    episode.summary,
    episode.sensitivity,
    JSON.stringify(episode.entities),
    JSON.stringify(episode.messageIds),
    JSON.stringify(episode.toolNames),
    episode.importance,
    episode.embedding ? JSON.stringify(episode.embedding) : null,
    episode.createdAt,
    episode.sourceStartMessageId,
    episode.sourceEndMessageId,
    encodeEpisodeSourceIdentityManifest(sourceIdentityManifest),
  );
  replaceEpisodeRetrievalTermsInTransaction(db, episode);
  advanceMemoryProjectionInTransaction(db, getLocalMemoryVaultOwnerId(db));
  return episode;
}

function readPersistedPolicySensitivity(
  db: ReturnType<typeof getSchemaReadyMemoryDb>,
  episodeId: string,
): EpisodeSensitivity {
  const row = db.getFirstSync<{ sensitivity: string }>(
    'SELECT sensitivity FROM memory_episode_access_policies WHERE episode_id = ? LIMIT 1',
    episodeId,
  );
  if (!row) return 'normal';
  return closedEpisodeSensitivity(row.sensitivity) ?? 'sensitive';
}

export function addFactEvidence(input: AddFactEvidenceInput): MemoryFactEvidence | null {
  return runMemoryTransaction(() => addFactEvidenceInTransaction(input));
}

/** Add evidence atomically; the primitive owns projection freshness for real changes. */
export function addFactEvidenceInTransaction(
  input: AddFactEvidenceInput,
): MemoryFactEvidence | null {
  assertMemoryTransactionActive('fact_evidence_transaction_required');
  const db = getSchemaReadyMemoryDb();
  if (!input.factId.trim()) return null;
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const fact = db.getFirstSync<{ invalid_at: number | null }>(
    `SELECT invalid_at
       FROM memory_facts
      WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL`,
    input.factId,
    memoryOwnerId,
  );
  if (!fact) return null;
  const promptVisible = fact.invalid_at === null;
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
        const updated = db.runSync(
          `UPDATE memory_fact_evidence
              SET episode_id = ?, role = ?, quote = ?
            WHERE id = ?`,
          episodeId,
          role,
          quote,
          existing.id,
        );
        if ((updated.changes ?? 0) > 0 && promptVisible) {
          advanceMemoryProjectionInTransaction(db, memoryOwnerId);
        }
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
  if ((inserted.changes ?? 0) > 0 && promptVisible) {
    advanceMemoryProjectionInTransaction(db, memoryOwnerId);
  }
  return evidence;
}
