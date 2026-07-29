import type { getMemoryDb } from './database';
import {
  persistExactMemorySourceIdentity,
  requireExactMemorySourceIdentity,
  type ExactMemorySourceIdentity,
  type ExactMemorySourceKind,
} from './exactMemorySourceIdentity';
import type { IngestionJobRow } from './ingestionQueueIdentity';
import type { IngestionSourceSnapshotV1 } from './ingestionSourceSnapshot';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface IngestionJobSourceScope {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  sourceEndMessageId: string;
  sourceRunId: string | null;
}

interface PersistedIngestionJobSourceRow {
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

function exactSourceKey(source: ExactMemorySourceIdentity): string {
  const persisted = persistExactMemorySourceIdentity(source);
  return JSON.stringify([
    persisted.memoryOwnerId,
    persisted.memoryConversationId,
    persisted.sourceThreadId,
    persisted.taskId,
    persisted.sourceKind,
    persisted.sourceId,
  ]);
}

function buildSources(
  scopeInput: IngestionJobSourceScope,
  messageIds: readonly string[],
): ExactMemorySourceIdentity[] {
  const scope = {
    memoryOwnerId: requireExactMemoryScopeId(
      scopeInput.memoryOwnerId,
      'memory_ingestion_job_source_owner_invalid',
    ),
    memoryConversationId: requireExactMemoryScopeId(
      scopeInput.memoryConversationId,
      'memory_ingestion_job_source_conversation_invalid',
    ),
    sourceThreadId: requireExactMemoryScopeId(
      scopeInput.sourceThreadId,
      'memory_ingestion_job_source_thread_invalid',
    ),
    taskId:
      scopeInput.taskId === null
        ? null
        : requireExactMemoryScopeId(scopeInput.taskId, 'memory_ingestion_job_source_task_invalid'),
  };
  const byKey = new Map<string, ExactMemorySourceIdentity>();
  const add = (sourceKind: ExactMemorySourceKind, sourceIdInput: string): void => {
    const sourceId = requireExactMemoryProvenanceId(
      sourceIdInput,
      'memory_ingestion_job_source_id_invalid',
    );
    const source = requireExactMemorySourceIdentity({ ...scope, sourceKind, sourceId });
    byKey.set(exactSourceKey(source), source);
  };

  for (const messageId of messageIds) add('message', messageId);
  add('message', scopeInput.sourceEndMessageId);
  add('turn', scopeInput.sourceEndMessageId);
  if (scopeInput.sourceRunId !== null) add('run', scopeInput.sourceRunId);
  return Array.from(byKey.values()).sort((left, right) => {
    const leftKey = exactSourceKey(left);
    const rightKey = exactSourceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/** Canonical source set for new jobs and active legacy jobs with a retained snapshot. */
export function buildIngestionJobSourcesFromSnapshot(
  scope: IngestionJobSourceScope,
  snapshot: IngestionSourceSnapshotV1,
): ExactMemorySourceIdentity[] {
  const messageIds = snapshot.turnMessages.map((message) => message.id);
  if (snapshot.priorUserMessageId !== null) messageIds.push(snapshot.priorUserMessageId);
  return buildSources(scope, messageIds);
}

/**
 * One-way bootstrap for terminal legacy rows whose content snapshot was already removed.
 * Intermediate message ids cannot be reconstructed here; later history backfills own that gap.
 */
export function buildProvableLegacyIngestionJobSources(
  memoryOwnerId: string,
  row: IngestionJobRow,
): ExactMemorySourceIdentity[] {
  const messageIds = [
    row.prior_user_message_id,
    row.source_start_message_id,
    row.source_end_message_id,
  ].filter((value): value is string => value !== null);
  return buildSources(
    {
      memoryOwnerId,
      memoryConversationId: row.memory_conversation_id,
      sourceThreadId: row.thread_id,
      taskId: row.task_id,
      sourceEndMessageId: row.source_end_message_id,
      sourceRunId: row.source_run_id,
    },
    messageIds,
  );
}

export function insertIngestionJobSources(
  db: MemoryDb,
  jobId: string,
  sources: readonly ExactMemorySourceIdentity[],
): void {
  const exactJobId = requireExactMemoryScopeId(jobId, 'memory_ingestion_job_source_job_invalid');
  for (const input of sources) {
    const source = persistExactMemorySourceIdentity(input);
    db.runSync(
      `INSERT INTO memory_ingestion_job_sources(
         job_id, memory_owner_id, memory_conversation_id, source_thread_id,
         task_id, source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      exactJobId,
      source.memoryOwnerId,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      source.sourceKind,
      source.sourceId,
    );
  }
}

export function requireMatchingIngestionJobSources(
  db: MemoryDb,
  jobId: string,
  expectedSources: readonly ExactMemorySourceIdentity[],
): void {
  const rows = db.getAllSync<PersistedIngestionJobSourceRow>(
    `SELECT memory_owner_id, memory_conversation_id, source_thread_id,
            task_id, source_kind, source_id
       FROM memory_ingestion_job_sources
      WHERE job_id = ?`,
    jobId,
  );
  const persistedKeys = rows.map((row) =>
    exactSourceKey(
      requireExactMemorySourceIdentity({
        memoryOwnerId: row.memory_owner_id,
        memoryConversationId: row.memory_conversation_id,
        sourceThreadId: row.source_thread_id,
        taskId: row.task_id === '' ? null : row.task_id,
        sourceKind: row.source_kind,
        sourceId: row.source_id,
      }),
    ),
  );
  const expectedKeys = expectedSources.map(exactSourceKey);
  persistedKeys.sort();
  expectedKeys.sort();
  if (
    persistedKeys.length !== expectedKeys.length ||
    persistedKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error('memory_ingestion_job_sources_conflict');
  }
}
