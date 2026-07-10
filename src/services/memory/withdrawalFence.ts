import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';

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

const OPAQUE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,512}$/u;

function normalizedOpaqueId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return OPAQUE_ID_PATTERN.test(normalized) ? normalized : null;
}

/** Exact scope + source-kind replay fence. It never matches memory value text. */
export function isMemorySourceWithdrawn(input: MemoryWithdrawalSourceIdentity): boolean {
  const sourceId = normalizedOpaqueId(input.sourceId);
  if (!sourceId) return false;
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
      input.memoryConversationId.trim(),
      input.sourceThreadId.trim(),
      input.taskId?.trim() ?? '',
      input.sourceKind,
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
    if (!source.sourceId) continue;
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
      input.sourceStartMessageId &&
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'message',
        sourceId: input.sourceStartMessageId,
      }),
    ) ||
    Boolean(
      input.sourceRunId &&
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'run',
        sourceId: input.sourceRunId,
      }),
    )
  );
}
