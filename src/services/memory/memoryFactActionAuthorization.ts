import type { MemoryFact } from './facts/types';
import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';

/**
 * Authorize an agent-originated fact mutation against every identity persisted
 * by that fact. Root-wide UI management is intentionally a separate API.
 */
export function canManageMemoryFactFromScope(
  fact: MemoryFact,
  current: RequiredMemoryAccessScopeIdentity,
): boolean {
  if (fact.memoryOwnerId !== current.memoryOwnerId) return false;

  if (fact.scope === 'global') {
    return (
      fact.personaId === null &&
      fact.originConversationId === null &&
      fact.originThreadId === null &&
      fact.originTaskId === null
    );
  }

  if (fact.scope === 'persona') {
    return (
      fact.personaId === current.personaId &&
      fact.originConversationId === null &&
      fact.originThreadId === null &&
      fact.originTaskId === null
    );
  }

  if (
    fact.personaId !== null ||
    fact.originConversationId !== current.memoryConversationId
  ) {
    return false;
  }

  if (fact.scope === 'conversation' || fact.scope === 'project') {
    return (
      fact.originTaskId === null &&
      (fact.originThreadId === null || fact.originThreadId === current.sourceThreadId)
    );
  }

  return (
    current.taskId !== null &&
    fact.originThreadId === current.sourceThreadId &&
    fact.originTaskId === current.taskId
  );
}
