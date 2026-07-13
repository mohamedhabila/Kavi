import type { getMemoryDb } from './database';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export const EXACT_MEMORY_SOURCE_KINDS = ['message', 'turn', 'run'] as const;
export type ExactMemorySourceKind = (typeof EXACT_MEMORY_SOURCE_KINDS)[number];

/** The complete, non-fuzzy identity of one memory-producing source. */
export interface ExactMemorySourceIdentity {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  sourceKind: ExactMemorySourceKind;
  sourceId: string;
}

export interface PersistedExactMemorySourceIdentity {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string;
  sourceKind: ExactMemorySourceKind;
  sourceId: string;
}

interface ExactMemorySourceIdentityErrorCodes {
  ownerId: string;
  conversationId: string;
  threadId: string;
  taskId: string;
  sourceKind: string;
  sourceId: string;
}

const DEFAULT_ERROR_CODES: ExactMemorySourceIdentityErrorCodes = {
  ownerId: 'memory_exact_source_owner_scope_invalid',
  conversationId: 'memory_exact_source_conversation_scope_invalid',
  threadId: 'memory_exact_source_thread_scope_invalid',
  taskId: 'memory_exact_source_task_scope_invalid',
  sourceKind: 'memory_exact_source_kind_invalid',
  sourceId: 'memory_exact_source_id_invalid',
};

export function requireExactMemorySourceKind(
  value: unknown,
  code = DEFAULT_ERROR_CODES.sourceKind,
): ExactMemorySourceKind {
  if (value !== 'message' && value !== 'turn' && value !== 'run') {
    throw new Error(code);
  }
  return value;
}

export function requireExactMemorySourceIdentity(
  input: unknown,
  errorCodes: ExactMemorySourceIdentityErrorCodes = DEFAULT_ERROR_CODES,
): ExactMemorySourceIdentity {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(errorCodes.sourceId);
  }
  const source = input as Record<string, unknown>;
  if (!Object.hasOwn(source, 'taskId')) throw new Error(errorCodes.taskId);
  const taskId = source.taskId;
  if (taskId !== null && typeof taskId !== 'string') throw new Error(errorCodes.taskId);
  return {
    memoryOwnerId: requireExactMemoryScopeId(source.memoryOwnerId, errorCodes.ownerId),
    memoryConversationId: requireExactMemoryScopeId(
      source.memoryConversationId,
      errorCodes.conversationId,
    ),
    sourceThreadId: requireExactMemoryScopeId(source.sourceThreadId, errorCodes.threadId),
    taskId:
      taskId === null ? null : requireExactMemoryScopeId(taskId, errorCodes.taskId),
    sourceKind: requireExactMemorySourceKind(source.sourceKind, errorCodes.sourceKind),
    sourceId: requireExactMemoryProvenanceId(source.sourceId, errorCodes.sourceId),
  };
}

export function persistExactMemorySourceIdentity(
  input: ExactMemorySourceIdentity,
): PersistedExactMemorySourceIdentity {
  const source = requireExactMemorySourceIdentity(input);
  return { ...source, taskId: source.taskId ?? '' };
}

function persistedScopeKey(source: PersistedExactMemorySourceIdentity): string {
  return JSON.stringify([
    source.memoryOwnerId,
    source.memoryConversationId,
    source.sourceThreadId,
    source.taskId,
  ]);
}

/** Check exact retirement tuples in bounded batches; source values are never normalized. */
export function hasAnyRetiredExactMemorySource(
  db: MemoryDb,
  sources: readonly ExactMemorySourceIdentity[],
): boolean {
  const grouped = new Map<string, PersistedExactMemorySourceIdentity[]>();
  for (const input of sources) {
    const source = persistExactMemorySourceIdentity(input);
    const key = persistedScopeKey(source);
    const group = grouped.get(key);
    if (group) group.push(source);
    else grouped.set(key, [source]);
  }

  for (const group of grouped.values()) {
    const scope = group[0];
    for (let offset = 0; offset < group.length; offset += 100) {
      const batch = group.slice(offset, offset + 100);
      const sourcePredicate = batch
        .map(() => '(source_kind = ? AND source_id = ?)')
        .join(' OR ');
      const sourceBindings = batch.flatMap((source) => [source.sourceKind, source.sourceId]);
      if (
        db.getFirstSync<{ present: number }>(
          `SELECT 1 AS present
             FROM memory_retired_sources
            WHERE memory_owner_id = ?
              AND memory_conversation_id = ?
              AND source_thread_id = ?
              AND task_id = ?
              AND (${sourcePredicate})
            LIMIT 1`,
          scope.memoryOwnerId,
          scope.memoryConversationId,
          scope.sourceThreadId,
          scope.taskId,
          ...sourceBindings,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
