import { findEntityByName } from '../entities';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { listCurrentFactsForReplacement } from './exactReplacementQueries';
import { hasCurrentFactForSubjectPredicate } from './queries';
import type { MemoryFact, MemoryFactScope } from './types';

export interface CurrentReplacementResolutionInput {
  subject: string;
  predicate: string;
  scope: MemoryFactScope;
}

export interface CurrentReplacementResolutionContext {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
  personaId?: string | null;
}

export interface CurrentReplacementResolution {
  currentFacts: MemoryFact[];
  hasAnyCurrentFact: boolean;
}

function hasRequiredScopeIdentity(
  scope: MemoryFactScope,
  context: CurrentReplacementResolutionContext,
): boolean {
  if (scope === 'global') return true;
  if (scope === 'persona') return isExactMemoryScopeId(context.personaId);
  if (!isExactMemoryScopeId(context.memoryConversationId)) return false;
  if (scope !== 'session') return true;
  return isExactMemoryScopeId(context.sourceThreadId) && isExactMemoryScopeId(context.taskId);
}

/**
 * Resolve the exact current key that a grounded write may replace. The broad
 * existence bit prevents an incompatible namespace from being treated as an
 * unambiguous current target.
 */
export function resolveCurrentFactsForReplacement(
  input: CurrentReplacementResolutionInput,
  context: CurrentReplacementResolutionContext,
): CurrentReplacementResolution {
  const subject = input.subject.trim();
  const predicate = input.predicate.trim();
  if (!subject || !predicate) return { currentFacts: [], hasAnyCurrentFact: false };

  const entity = findEntityByName(subject);
  if (!entity) return { currentFacts: [], hasAnyCurrentFact: false };

  const hasAnyCurrentFact = hasCurrentFactForSubjectPredicate(entity.id, predicate);
  if (!hasRequiredScopeIdentity(input.scope, context)) {
    return { currentFacts: [], hasAnyCurrentFact: true };
  }

  const currentFacts = listCurrentFactsForReplacement({
    subjectId: entity.id,
    predicate,
    scope: input.scope,
    ...(input.scope === 'persona' ? { personaId: context.personaId } : {}),
    ...(input.scope === 'project' || input.scope === 'conversation' || input.scope === 'session'
      ? {
          originConversationId: context.memoryConversationId,
          ...(isExactMemoryScopeId(context.sourceThreadId)
            ? { originThreadId: context.sourceThreadId }
            : {}),
        }
      : {}),
    ...(input.scope === 'session' ? { originTaskId: context.taskId } : {}),
  });
  return {
    currentFacts,
    hasAnyCurrentFact: currentFacts.length > 0 || hasAnyCurrentFact,
  };
}
