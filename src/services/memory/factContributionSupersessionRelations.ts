import type { MemoryFactScope } from './facts/types';

interface SupersessionScopeEvidence {
  scope: MemoryFactScope;
  personaId: string | null;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
}

/** Match SQLite's built-in ASCII-only NOCASE collation without locale-dependent behavior. */
export function sqliteNoCaseEquals(left: string, right: string): boolean {
  const fold = (value: string): string =>
    value.replace(/[A-Z]/g, (character) => character.toLowerCase());
  return fold(left) === fold(right);
}

/** Prove that a supersession predecessor and successor share one exact memory scope. */
export function hasMatchingFactSupersessionScope(
  predecessor: SupersessionScopeEvidence,
  successor: SupersessionScopeEvidence,
): boolean {
  if (successor.scope === 'global') {
    return (
      predecessor.personaId === null &&
      successor.personaId === null &&
      predecessor.originConversationId === null &&
      successor.originConversationId === null &&
      predecessor.originThreadId === null &&
      successor.originThreadId === null &&
      predecessor.originTaskId === null &&
      successor.originTaskId === null
    );
  }
  if (successor.scope === 'persona') {
    return (
      successor.personaId !== null &&
      predecessor.personaId === successor.personaId &&
      predecessor.originConversationId === null &&
      successor.originConversationId === null &&
      predecessor.originThreadId === null &&
      successor.originThreadId === null &&
      predecessor.originTaskId === null &&
      successor.originTaskId === null
    );
  }
  if (successor.scope === 'conversation' || successor.scope === 'project') {
    return (
      successor.originConversationId !== null &&
      predecessor.personaId === null &&
      successor.personaId === null &&
      predecessor.originConversationId === successor.originConversationId &&
      predecessor.originTaskId === null &&
      successor.originTaskId === null
    );
  }
  return (
    successor.scope === 'session' &&
    successor.originConversationId !== null &&
    successor.originThreadId !== null &&
    successor.originTaskId !== null &&
    predecessor.personaId === null &&
    successor.personaId === null &&
    predecessor.originConversationId === successor.originConversationId &&
    predecessor.originThreadId === successor.originThreadId &&
    predecessor.originTaskId === successor.originTaskId
  );
}
