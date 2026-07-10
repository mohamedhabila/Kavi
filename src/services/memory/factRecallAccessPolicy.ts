import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
} from './facts/applicabilityProvenance';
import { isMemoryFactScope, type MemoryFact } from './facts/types';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';
import type { MemoryApplicabilityUseIntent } from './memoryApplicabilityTypes';

export interface FactRecallAccessContext {
  scope: RequiredMemoryAccessScopeIdentity;
  useIntent: MemoryApplicabilityUseIntent;
  asOf: number;
}

export type FactRecallCandidateLane = 'direct_use' | 'resolution';

function hasDirectUseAuthority(fact: MemoryFact): boolean {
  const factClass = closedMemoryFactClass(fact.factClass);
  const sourceAuthority = closedMemorySourceAuthority(fact.sourceAuthority);
  if (!factClass || factClass === 'unknown' || !sourceAuthority || sourceAuthority === 'unknown') {
    return false;
  }
  if (factClass === 'subjective_user') return sourceAuthority === 'grounded_user';
  if (factClass === 'objective') {
    return (
      sourceAuthority === 'grounded_user' ||
      sourceAuthority === 'tool_observed' ||
      sourceAuthority === 'external_source'
    );
  }
  return (
    sourceAuthority !== 'assistant_inferred' ||
    closedMemoryFactReviewState(fact.reviewState) === 'verified'
  );
}

export function requireFactRecallAccessContext(input: {
  memoryScope: MemoryAccessScopeIdentity;
  useIntent: MemoryApplicabilityUseIntent;
  asOf: number;
}): FactRecallAccessContext {
  if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) {
    throw new Error('memory_recall_access_timestamp_invalid');
  }
  if (input.useIntent !== 'automatic_prompt' && input.useIntent !== 'explicit_user_request') {
    throw new Error('memory_recall_access_intent_invalid');
  }
  return {
    scope: requireMemoryAccessScopeIdentity(input.memoryScope),
    useIntent: input.useIntent,
    asOf: input.asOf,
  };
}

function validRequiredTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validOptionalTimestamp(value: unknown): value is number | null {
  return value === null || validRequiredTimestamp(value);
}

/**
 * Content-independent access gate used before scoring, entity lanes, similarity
 * selection, or any provider-visible candidate projection.
 */
export function canFactEnterRecallCandidates(
  fact: MemoryFact,
  context: FactRecallAccessContext,
  lane: FactRecallCandidateLane,
): boolean {
  if (lane !== 'direct_use' && lane !== 'resolution') return false;
  const factClass = closedMemoryFactClass(fact.factClass);
  const sourceAuthority = closedMemorySourceAuthority(fact.sourceAuthority);
  if (
    !isMemoryFactScope(fact.scope) ||
    fact.memoryOwnerId !== context.scope.memoryOwnerId ||
    !factClass ||
    factClass === 'unknown' ||
    !sourceAuthority ||
    sourceAuthority === 'unknown' ||
    !validRequiredTimestamp(fact.validAt) ||
    !validRequiredTimestamp(fact.createdAt) ||
    !validOptionalTimestamp(fact.invalidAt) ||
    !validOptionalTimestamp(fact.expiresAt) ||
    fact.deletedAt !== null ||
    fact.validAt > context.asOf ||
    fact.createdAt > context.asOf ||
    (fact.invalidAt !== null && fact.invalidAt <= context.asOf) ||
    (fact.expiresAt !== null && fact.expiresAt <= context.asOf)
  ) {
    return false;
  }

  const reviewState = closedMemoryFactReviewState(fact.reviewState);
  if (!reviewState || reviewState === 'rejected') return false;
  const sensitivity = closedMemoryFactSensitivity(fact.sensitivity);
  if (!sensitivity || sensitivity === 'restricted') return false;
  if (sensitivity === 'sensitive' && context.useIntent === 'automatic_prompt') return false;
  const directUseAuthority = hasDirectUseAuthority(fact);
  if (
    (lane === 'direct_use' && !directUseAuthority) ||
    (lane === 'resolution' && directUseAuthority)
  ) {
    return false;
  }

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
      fact.personaId === context.scope.personaId &&
      fact.originConversationId === null &&
      fact.originThreadId === null &&
      fact.originTaskId === null
    );
  }
  if (fact.scope !== 'conversation' && fact.scope !== 'project' && fact.scope !== 'session') {
    return false;
  }
  if (fact.personaId !== null) return false;
  if (fact.originConversationId !== context.scope.memoryConversationId) return false;
  if (fact.scope === 'conversation' || fact.scope === 'project') {
    return fact.originTaskId === null;
  }
  return (
    context.scope.taskId !== null &&
    fact.originThreadId === context.scope.sourceThreadId &&
    fact.originTaskId === context.scope.taskId
  );
}
