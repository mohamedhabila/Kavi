import {
  isImmediateActionResultContinuation,
  rankWorkflowSupportEntries,
  type WorkflowSupportEntry,
} from '../../../src/services/memory/factRecallSupport';
import type { ScoredSelectionFact } from '../../../src/services/memory/ranking/selection';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(
  id: string,
  memoryKind: MemoryFact['memoryKind'],
  objectText = '{}',
  attributes: MemoryFact['attributes'] = { stateIndex: '4' },
): MemoryFact {
  return {
    id,
    subjectId: 'subject',
    subjectName: 'subject',
    predicate: memoryKind === 'outcome' ? 'ui_action_result' : memoryKind,
    objectText,
    confidence: 1,
    importance: 0,
    source: 'observed',
    scope: 'session',
    attributes,
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

  it('keeps action outcomes over same-state UI support for action-flow continuity', () => {
    const ranked = rankWorkflowSupportEntries({
      entries: [
        entry('field', 'ui_field'),
        entry('outcome', 'outcome', JSON.stringify({ stateIndex: '4' })),
      ],
      sourceRunSupportRank: new Map([['run-local-state', 0]]),
    });

    expect(ranked.map((item) => item.fact.id)).toEqual(['outcome']);
  });
});

describe('isImmediateActionResultContinuation', () => {
  it('allows only structurally adjacent action outcomes from the same source run', () => {
    const selected = [
      fact('selected', 'outcome', '{}', { stateIndex: '2', previousStateIndex: '1' }),
    ];
    const adjacent = fact('adjacent', 'outcome', '{}', {
      stateIndex: '3',
      previousStateIndex: '2',
    });
    const distant = fact('distant', 'outcome', '{}', {
      stateIndex: '8',
      previousStateIndex: '7',
    });

    expect(isImmediateActionResultContinuation(adjacent, selected)).toBe(true);
    expect(isImmediateActionResultContinuation(distant, selected)).toBe(false);
  });
});
