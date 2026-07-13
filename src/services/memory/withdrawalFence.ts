import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import {
  hasAnyRetiredExactMemorySource,
  requireExactMemorySourceKind,
  type ExactMemorySourceKind,
} from './exactMemorySourceIdentity';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

export type MemoryWithdrawalSourceKind = ExactMemorySourceKind;

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

export class MemoryPersistenceSourceWithdrawnError extends Error {
  readonly code = 'memory_persistence_source_withdrawn' as const;

  constructor() {
    super('Memory persistence source withdrawn');
    this.name = 'MemoryPersistenceSourceWithdrawnError';
  }
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
  const sourceKind = requireExactMemorySourceKind(
    input.sourceKind,
    'memory_withdrawal_source_kind_invalid',
  );
  const sourceId = requireExactMemoryProvenanceId(
    input.sourceId,
    'memory_withdrawal_source_id_invalid',
  );
  ensureFactSchema();
  const db = getMemoryDb();
  return hasAnyRetiredExactMemorySource(db, [
    {
      memoryOwnerId: getLocalMemoryVaultOwnerId(db),
      memoryConversationId: scope.memoryConversationId,
      sourceThreadId: scope.sourceThreadId,
      taskId: scope.taskId === '' ? null : scope.taskId,
      sourceKind,
      sourceId,
    },
  ]);
}

export function assertMemoryPersistenceSourcesAreWritable(
  scope: MemoryPersistenceSourceScope,
  sources: ReadonlyArray<{
    sourceKind: MemoryWithdrawalSourceKind;
    sourceId: string | null | undefined;
  }>,
): void {
  const normalizedScope = requireSourceScope(scope);
  const exactSources = sources.flatMap((source) => {
    if (source.sourceId === null || source.sourceId === undefined) return [];
    return [
      {
        sourceKind: requireExactMemorySourceKind(
          source.sourceKind,
          'memory_withdrawal_source_kind_invalid',
        ),
        sourceId: requireExactMemoryProvenanceId(
          source.sourceId,
          'memory_withdrawal_source_id_invalid',
        ),
      },
    ];
  });
  if (exactSources.length === 0) return;
  ensureFactSchema();
  const db = getMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  if (
    hasAnyRetiredExactMemorySource(
      db,
      exactSources.map((source) => ({
        memoryOwnerId,
        memoryConversationId: normalizedScope.memoryConversationId,
        sourceThreadId: normalizedScope.sourceThreadId,
        taskId: normalizedScope.taskId === '' ? null : normalizedScope.taskId,
        ...source,
      })),
    )
  ) {
    throw new MemoryPersistenceSourceWithdrawnError();
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
