import type { MemoryFact } from '../../src/services/memory/facts/types';
import type { ScoredFact } from '../../src/services/memory/factRecallTypes';

export function makeMemoryFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    subjectId: 'subject-1',
    predicate: 'note',
    objectText: 'Remember this detail.',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: 'message-1',
    sourceRunId: null,
    memoryOwnerId: 'vault-owner',
    personaId: null,
    factClass: 'unknown',
    sourceAuthority: 'unknown',
    scope: 'conversation',
    originConversationId: 'conversation-1',
    originThreadId: 'conversation-1',
    originTaskId: null,
    sourceTurnId: null,
    sourceSummary: null,
    importance: 0.8,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    expiresAt: null,
    contentHash: 'hash-1',
    localSimilarity: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    taskId: null,
    retrievability: 1,
    stability: 0.8,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'semantic_fact',
    ...overrides,
  };
}

export function makeScoredFact(
  overrides: Partial<Omit<ScoredFact, 'fact'>> & { fact?: Partial<MemoryFact> } = {},
): ScoredFact {
  const score = overrides.score ?? 0.9;
  return {
    fact: makeMemoryFact(overrides.fact),
    score,
    textScore: overrides.textScore ?? score,
    lexicalScore: overrides.lexicalScore ?? score,
    pinnedBoost: overrides.pinnedBoost ?? 0,
    decayMultiplier: overrides.decayMultiplier ?? 1,
    scopeBoost: overrides.scopeBoost ?? 1,
    reinforcementBoost: overrides.reinforcementBoost ?? 1,
    importanceScore: overrides.importanceScore ?? 0.8,
    retrievabilityScore: overrides.retrievabilityScore ?? 1,
    relevanceScore: overrides.relevanceScore ?? score,
    candidateRelevanceScore: overrides.candidateRelevanceScore ?? 0,
    candidateProvenance: overrides.candidateProvenance ?? {
      reasons: [],
      fusionScore: 0,
      semanticSimilarity: null,
    },
  };
}
