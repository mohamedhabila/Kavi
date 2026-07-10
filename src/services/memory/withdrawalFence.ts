import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';

export type MemoryWithdrawalSourceKind = 'message' | 'turn' | 'run';

export interface MemoryWithdrawalSourceIdentity {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
  sourceKind: MemoryWithdrawalSourceKind;
  sourceId: string;
}

export interface MemoryPersistenceSourceScope {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
}

export interface MemoryIngestionSourceIdentity extends MemoryPersistenceSourceScope {
  sourceStartMessageId?: string | null;
  sourceEndMessageId: string;
  sourceRunId?: string | null;
}

function requireSourceKind(value: unknown): MemoryWithdrawalSourceKind {
  if (value !== 'message' && value !== 'turn' && value !== 'run') {
    throw new Error('memory_withdrawal_source_kind_invalid');
  }
  return value;
}

function requireSourceScope(input: MemoryPersistenceSourceScope): {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string;
} {
  return {
    memoryConversationId: requireExactMemoryScopeId(
      input.memoryConversationId,
      'memory_withdrawal_conversation_scope_invalid',
    ),
    sourceThreadId: requireExactMemoryScopeId(
      input.sourceThreadId,
      'memory_withdrawal_thread_scope_invalid',
    ),
    taskId:
      input.taskId === null || input.taskId === undefined
        ? ''
        : requireExactMemoryScopeId(input.taskId, 'memory_withdrawal_task_scope_invalid'),
  };
}

/** Exact scope + source-kind replay fence. It never matches memory value text. */
export function isMemorySourceWithdrawn(input: MemoryWithdrawalSourceIdentity): boolean {
  const scope = requireSourceScope(input);
  const sourceKind = requireSourceKind(input.sourceKind);
  const sourceId = requireExactMemoryProvenanceId(
    input.sourceId,
    'memory_withdrawal_source_id_invalid',
  );
  ensureFactSchema();
  return Boolean(
    getMemoryDb().getFirstSync<{ present: number }>(
      `SELECT 1 AS present
         FROM memory_withdrawal_sources
        WHERE memory_conversation_id = ?
          AND source_thread_id = ?
          AND task_id = ?
          AND source_kind = ?
          AND source_id = ?
        LIMIT 1`,
      scope.memoryConversationId,
      scope.sourceThreadId,
      scope.taskId,
      sourceKind,
      sourceId,
    ),
  );
}

export function assertMemoryPersistenceSourcesAreWritable(
  scope: MemoryPersistenceSourceScope,
  sources: ReadonlyArray<{
    sourceKind: MemoryWithdrawalSourceKind;
    sourceId: string | null | undefined;
  }>,
): void {
  for (const source of sources) {
    if (source.sourceId === null || source.sourceId === undefined) continue;
    if (isMemorySourceWithdrawn({ ...scope, ...source, sourceId: source.sourceId })) {
      throw new Error('Memory persistence source withdrawn');
    }
  }
}

export function isMemoryIngestionSourceWithdrawn(input: MemoryIngestionSourceIdentity): boolean {
  const scope = {
    memoryConversationId: input.memoryConversationId,
    sourceThreadId: input.sourceThreadId,
    taskId: input.taskId,
  };
  return (
    isMemorySourceWithdrawn({
      ...scope,
      sourceKind: 'turn',
      sourceId: input.sourceEndMessageId,
    }) ||
    Boolean(
      input.sourceStartMessageId !== null &&
      input.sourceStartMessageId !== undefined &&
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'message',
        sourceId: input.sourceStartMessageId,
      }),
    ) ||
    Boolean(
      input.sourceRunId !== null &&
      input.sourceRunId !== undefined &&
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'run',
        sourceId: input.sourceRunId,
      }),
    )
  );
}
