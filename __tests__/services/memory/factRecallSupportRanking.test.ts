import { rankWorkflowSupportEntries, type WorkflowSupportEntry } from '../../../src/services/memory/factRecallSupport';
import type { ScoredSelectionFact } from '../../../src/services/memory/ranking/selection';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(
  id: string,
  memoryKind: MemoryFact['memoryKind'],
  objectText = '{}',
): MemoryFact {
  return {
    id,
    subjectId: 'subject',
    subjectName: 'subject',
    predicate: memoryKind,
    objectText,
    confidence: 1,
    importance: 0,
    source: 'observed',
    scope: 'session',
    attributes: { stateIndex: '4' },
    originConversationId: 'conversation',
    originThreadId: 'thread',
    originTaskId: undefined,
    sourceRunId: 'run-local-state',
    sourceTurnId: undefined,
    validFrom: 0,
    validTo: undefined,
    invalidatedAt: undefined,
    invalidationReason: undefined,
    supersedes: undefined,
    createdAt: 0,
    updatedAt: 0,
    lastRecalledAt: undefined,
    recallCount: 0,
    decayAt: undefined,
    memoryKind,
    retrievability: 1,
    stability: 1,
  };
}

function entry(
  id: string,
  memoryKind: MemoryFact['memoryKind'],
  objectText?: string,
): WorkflowSupportEntry {
  const supportFact = fact(id, memoryKind, objectText);
  return {
    exactContext: true,
    fact: supportFact,
    queryEvidenceScore: 1,
    scored: {
      fact: supportFact,
      score: 1,
      textScore: 1,
      lexicalScore: 1,
      relevanceScore: 1,
      pinnedBoost: 0,
      decayMultiplier: 1,
      scopeBoost: 0,
      reinforcementBoost: 0,
      importanceScore: 0,
      retrievabilityScore: 1,
      quotedUiControlBoost: 0,
      surfaceLabelBoost: 0,
      surfaceIdentityScore: 0,
      visibleTextEvidenceBoost: 0,
    } satisfies ScoredSelectionFact,
  };
}

describe('rankWorkflowSupportEntries', () => {
  it('keeps the complete UI state over a single field for same-state support', () => {
    const ranked = rankWorkflowSupportEntries({
      entries: [
        entry('field', 'ui_field'),
        entry('inventory', 'ui_inventory', JSON.stringify({ fields: [{ checked: 'true' }] })),
      ],
      sourceRunSupportRank: new Map([['run-local-state', 0]]),
    });

    expect(ranked.map((item) => item.fact.id)).toEqual(['inventory']);
  });
});
