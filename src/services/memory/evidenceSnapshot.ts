import { getMany } from './access/crud';
import { runMemoryTransaction } from './access/transaction';
import type {
  IngestionJobReason,
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from './ingestionQueueStore';
import { ensureFactSchema } from './schema';
import type { MemoryFactKind, MemoryFactScope } from './facts/types';
import type { WorkingBlockLabel } from './workingBlocks';

export type MemoryEvidenceScope = {
  memoryConversationId: string;
  sourceThreadId: string;
};

export type MemoryFactEvidenceRecord = {
  id: string;
  subjectId: string;
  subject: string;
  predicate: string;
  objectText: string;
  contentHash: string;
  confidence: number;
  scope: MemoryFactScope;
  memoryKind: MemoryFactKind;
  personaId: string | null;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  sourceTurnId: string | null;
  validAt: number;
  invalidAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  pinned: boolean;
  reviewState: string;
  sensitivity: string;
};

export type MemoryEpisodeEvidenceRecord = {
  id: string;
  conversationId: string;
  threadId: string | null;
  taskId: string | null;
  summary: string;
  messageIds: string[];
  toolNames: string[];
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
  startedAt: number;
  endedAt: number;
  createdAt: number;
  deletedAt: number | null;
};

export type WorkingBlockEvidenceRecord = {
  id: string;
  label: WorkingBlockLabel;
  scopeKey: string;
  conversationId: string;
  threadId: string | null;
  taskId: string | null;
  content: string;
  updatedAt: number;
};

export type IngestionJobEvidenceRecord = {
  id: string;
  threadId: string;
  memoryConversationId: string;
  taskId: string | null;
  sourceRunId: string | null;
  priorUserMessageId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  sourceAt: number;
  reason: IngestionJobReason;
  status: IngestionJobStatus;
  attemptCount: number;
  providerEnrichment: boolean;
  providerOutcome: IngestionProviderOutcome | null;
  outcomeCode: IngestionOutcomeCode | null;
  nextAttemptAt: number | null;
  structuralCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type ScopedMemoryEvidenceSnapshot = {
  capturedAt: number;
  scope: MemoryEvidenceScope;
  facts: MemoryFactEvidenceRecord[];
  episodes: MemoryEpisodeEvidenceRecord[];
  workingBlocks: WorkingBlockEvidenceRecord[];
  ingestionJobs: IngestionJobEvidenceRecord[];
};

export type MemoryEvidenceCollectionDelta = {
  createdIds: string[];
  updatedIds: string[];
  removedIds: string[];
};

export type ScopedMemoryEvidenceDelta = {
  capturedAt: number;
  facts: MemoryEvidenceCollectionDelta;
  episodes: MemoryEvidenceCollectionDelta;
  workingBlocks: MemoryEvidenceCollectionDelta;
  ingestionJobs: MemoryEvidenceCollectionDelta;
  invalidatedFactIds: string[];
  deletedFactIds: string[];
  deletedEpisodeIds: string[];
  clearedWorkingBlockIds: string[];
  completedIngestionJobIds: string[];
};

type FactEvidenceRow = Omit<MemoryFactEvidenceRecord, 'pinned'> & { pinned: number };
type JobEvidenceRow = Omit<IngestionJobEvidenceRecord, 'providerEnrichment'> & {
  providerEnrichment: number;
};

function requireId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function normalizeScope(scope: MemoryEvidenceScope): MemoryEvidenceScope {
  return {
    memoryConversationId: requireId(scope.memoryConversationId, 'memoryConversationId'),
    sourceThreadId: requireId(scope.sourceThreadId, 'sourceThreadId'),
  };
}

function selectFactEvidence(whereClause: string, params: string[]): MemoryFactEvidenceRecord[] {
  return getMany<FactEvidenceRow>(
    `SELECT fact.id,
            fact.subject_id AS subjectId,
            COALESCE(subject.canonical_name, fact.subject_id) AS subject,
            fact.predicate,
            fact.object_text AS objectText,
            fact.content_hash AS contentHash,
            fact.confidence,
            fact.scope,
            fact.memory_kind AS memoryKind,
            fact.persona_id AS personaId,
            fact.origin_conversation_id AS originConversationId,
            fact.origin_thread_id AS originThreadId,
            fact.origin_task_id AS originTaskId,
            fact.source_message_id AS sourceMessageId,
            fact.source_run_id AS sourceRunId,
            fact.source_turn_id AS sourceTurnId,
            fact.valid_at AS validAt,
            fact.invalid_at AS invalidAt,
            fact.expires_at AS expiresAt,
            fact.created_at AS createdAt,
            fact.updated_at AS updatedAt,
            fact.deleted_at AS deletedAt,
            fact.pinned,
            fact.review_state AS reviewState,
            fact.sensitivity
       FROM memory_facts AS fact
       LEFT JOIN memory_entities AS subject ON subject.id = fact.subject_id
      WHERE ${whereClause}
      ORDER BY fact.id ASC`,
    ...params,
  ).map((row) => ({ ...row, pinned: row.pinned !== 0 }));
}

function listScopedFactEvidence(scope: MemoryEvidenceScope): MemoryFactEvidenceRecord[] {
  return selectFactEvidence(
    `fact.origin_conversation_id = ?
      AND COALESCE(fact.origin_thread_id, fact.origin_conversation_id) = ?
      AND fact.deleted_at IS NULL`,
    [scope.memoryConversationId, scope.sourceThreadId],
  );
}

/** Isolated evaluation evidence is forensic and intentionally retains canonical tombstones. */
function listCompleteFactEvidence(): MemoryFactEvidenceRecord[] {
  return selectFactEvidence('1 = 1', []);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function listEpisodeEvidence(scope: MemoryEvidenceScope): MemoryEpisodeEvidenceRecord[] {
  const rows = getMany<{
    id: string;
    conversationId: string;
    threadId: string | null;
    taskId: string | null;
    summary: string;
    messageIdsJson: string;
    toolNamesJson: string;
    sourceStartMessageId: string | null;
    sourceEndMessageId: string | null;
    startedAt: number;
    endedAt: number;
    createdAt: number;
    deletedAt: number | null;
  }>(
    `SELECT id,
            conversation_id AS conversationId,
            thread_id AS threadId,
            task_id AS taskId,
            summary,
            message_ids_json AS messageIdsJson,
            tool_names_json AS toolNamesJson,
            source_start_message_id AS sourceStartMessageId,
            source_end_message_id AS sourceEndMessageId,
            started_at AS startedAt,
            ended_at AS endedAt,
            created_at AS createdAt,
            deleted_at AS deletedAt
       FROM memory_episodes
      WHERE conversation_id = ?
        AND COALESCE(thread_id, conversation_id) = ?
      ORDER BY id ASC`,
    scope.memoryConversationId,
    scope.sourceThreadId,
  );
  return rows.map(({ messageIdsJson, toolNamesJson, ...row }) => ({
    ...row,
    messageIds: parseStringArray(messageIdsJson),
    toolNames: parseStringArray(toolNamesJson),
  }));
}

function listWorkingBlockEvidence(scope: MemoryEvidenceScope): WorkingBlockEvidenceRecord[] {
  return getMany<WorkingBlockEvidenceRecord>(
    `SELECT label || ':' || scope_key AS id,
            label,
            scope_key AS scopeKey,
            conversation_id AS conversationId,
            thread_id AS threadId,
            task_id AS taskId,
            content,
            updated_at AS updatedAt
       FROM memory_working_blocks
      WHERE conversation_id = ?
        AND COALESCE(thread_id, conversation_id) = ?
      ORDER BY label ASC, scope_key ASC`,
    scope.memoryConversationId,
    scope.sourceThreadId,
  );
}

function listIngestionJobEvidence(scope: MemoryEvidenceScope): IngestionJobEvidenceRecord[] {
  return getMany<JobEvidenceRow>(
    `SELECT id,
            thread_id AS threadId,
            memory_conversation_id AS memoryConversationId,
            task_id AS taskId,
            source_run_id AS sourceRunId,
            prior_user_message_id AS priorUserMessageId,
            source_start_message_id AS sourceStartMessageId,
            source_end_message_id AS sourceEndMessageId,
            source_at AS sourceAt,
            reason,
            status,
            attempt_count AS attemptCount,
            provider_enrichment AS providerEnrichment,
            provider_outcome AS providerOutcome,
            outcome_code AS outcomeCode,
            next_attempt_at AS nextAttemptAt,
            structural_completed_at AS structuralCompletedAt,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt
       FROM memory_ingestion_jobs
      WHERE memory_conversation_id = ? AND thread_id = ?
      ORDER BY id ASC`,
    scope.memoryConversationId,
    scope.sourceThreadId,
  ).map((row) => ({ ...row, providerEnrichment: row.providerEnrichment !== 0 }));
}

/** Production-scoped evidence exports active memory only and never expose canonical tombstones. */
export function captureScopedMemoryEvidence(
  scopeInput: MemoryEvidenceScope,
  now = Date.now(),
): ScopedMemoryEvidenceSnapshot {
  ensureFactSchema();
  const scope = normalizeScope(scopeInput);
  return runMemoryTransaction(() => ({
    capturedAt: now,
    scope,
    facts: listScopedFactEvidence(scope),
    episodes: listEpisodeEvidence(scope),
    workingBlocks: listWorkingBlockEvidence(scope),
    ingestionJobs: listIngestionJobEvidence(scope),
  }));
}

/**
 * Captures the complete fact store for an evaluation-owned, freshly reset
 * memory vault. Production diagnostics and withdrawal checks must use the
 * scoped collector above so unrelated user memory never enters their evidence.
 */
export function captureCompleteMemoryEvidenceForIsolatedEvaluation(
  scopeInput: MemoryEvidenceScope,
  now = Date.now(),
): ScopedMemoryEvidenceSnapshot {
  ensureFactSchema();
  const scope = normalizeScope(scopeInput);
  return runMemoryTransaction(() => ({
    capturedAt: now,
    scope,
    facts: listCompleteFactEvidence(),
    episodes: listEpisodeEvidence(scope),
    workingBlocks: listWorkingBlockEvidence(scope),
    ingestionJobs: listIngestionJobEvidence(scope),
  }));
}

function comparisonJson(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
  const record = { ...(value as Record<string, unknown>) };
  delete record.updatedAt;
  return JSON.stringify(record);
}

function collectionDelta<T extends { id: string }>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
): MemoryEvidenceCollectionDelta {
  const beforeById = new Map(before.map((value) => [value.id, value]));
  const afterById = new Map(after.map((value) => [value.id, value]));
  return {
    createdIds: Array.from(afterById.keys()).filter((key) => !beforeById.has(key)),
    updatedIds: Array.from(afterById.entries())
      .filter(([key, value]) => {
        const previous = beforeById.get(key);
        return previous !== undefined && comparisonJson(previous) !== comparisonJson(value);
      })
      .map(([key]) => key),
    removedIds: Array.from(beforeById.keys()).filter((key) => !afterById.has(key)),
  };
}

export function buildScopedMemoryEvidenceDelta(
  before: ScopedMemoryEvidenceSnapshot,
  after: ScopedMemoryEvidenceSnapshot,
): ScopedMemoryEvidenceDelta {
  if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) {
    throw new Error('Memory evidence snapshots must target the same scope.');
  }
  const beforeFacts = new Map(before.facts.map((fact) => [fact.id, fact]));
  const beforeEpisodes = new Map(before.episodes.map((episode) => [episode.id, episode]));
  const beforeBlocks = new Map(before.workingBlocks.map((block) => [block.id, block]));
  const beforeJobs = new Map(before.ingestionJobs.map((job) => [job.id, job]));
  return {
    capturedAt: after.capturedAt,
    facts: collectionDelta(before.facts, after.facts),
    episodes: collectionDelta(before.episodes, after.episodes),
    workingBlocks: collectionDelta(before.workingBlocks, after.workingBlocks),
    ingestionJobs: collectionDelta(before.ingestionJobs, after.ingestionJobs),
    invalidatedFactIds: after.facts
      .filter((fact) => fact.invalidAt !== null && beforeFacts.get(fact.id)?.invalidAt === null)
      .map((fact) => fact.id),
    deletedFactIds: after.facts
      .filter((fact) => fact.deletedAt !== null && beforeFacts.get(fact.id)?.deletedAt === null)
      .map((fact) => fact.id),
    deletedEpisodeIds: after.episodes
      .filter(
        (episode) =>
          episode.deletedAt !== null && beforeEpisodes.get(episode.id)?.deletedAt === null,
      )
      .map((episode) => episode.id),
    clearedWorkingBlockIds: after.workingBlocks
      .filter((block) => !block.content && Boolean(beforeBlocks.get(block.id)?.content))
      .map((block) => block.id),
    completedIngestionJobIds: after.ingestionJobs
      .filter(
        (job) =>
          ['completed_structural', 'completed_enriched'].includes(job.status) &&
          !['completed_structural', 'completed_enriched'].includes(
            beforeJobs.get(job.id)?.status ?? '',
          ),
      )
      .map((job) => job.id),
  };
}
