jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  buildScopedMemoryEvidenceDelta,
  captureScopedMemoryEvidence,
} from '../../../src/services/memory/evidenceSnapshot';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { resetE2EMemorySandbox } from '../../../src/acceptance/e2eAgent/sandboxMemory';

const SCOPE = {
  memoryConversationId: 'memory-evidence-conversation',
  sourceThreadId: 'memory-evidence-thread',
};

describe('scoped memory evidence', () => {
  beforeEach(() => {
    resetE2EMemorySandbox();
  });

  it('captures every scoped fact without the presentation-query cap', () => {
    for (let index = 0; index < 501; index += 1) {
      recordFact({
        subjectId: 'memory-evidence-subject',
        predicate: `evidence_predicate_${index}`,
        objectText: `evidence-value-${index}`,
        scope: 'conversation',
        originConversationId: SCOPE.memoryConversationId,
        originThreadId: SCOPE.sourceThreadId,
        now: index + 1,
      });
    }
    recordFact({
      subjectId: 'sibling-subject',
      predicate: 'sibling_predicate',
      objectText: 'must-not-cross-thread-boundary',
      scope: 'conversation',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: 'sibling-thread',
      now: 600,
    });

    const snapshot = captureScopedMemoryEvidence(SCOPE, 1_000);

    expect(snapshot.facts).toHaveLength(501);
    expect(
      snapshot.facts.some((fact) => fact.objectText === 'must-not-cross-thread-boundary'),
    ).toBe(false);
    expect(snapshot).toMatchObject({ capturedAt: 1_000, scope: SCOPE });
    expect(snapshot.facts[0]).not.toHaveProperty('embedding');
    expect(snapshot.facts[0]).not.toHaveProperty('attributes');
  });

  it('classifies created and invalidated facts from bounded snapshots', () => {
    const original = recordFact({
      subjectId: 'preference-subject',
      predicate: 'preferred_channel',
      objectText: 'email',
      scope: 'conversation',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: SCOPE.sourceThreadId,
      now: 10,
    });
    const before = captureScopedMemoryEvidence(SCOPE, 20);

    const replacement = recordFact({
      subjectId: 'preference-subject',
      predicate: 'preferred_channel',
      objectText: 'sms',
      scope: 'conversation',
      originConversationId: SCOPE.memoryConversationId,
      originThreadId: SCOPE.sourceThreadId,
      supersedePrior: true,
      now: 30,
    });
    const after = captureScopedMemoryEvidence(SCOPE, 40);
    const delta = buildScopedMemoryEvidenceDelta(before, after);

    expect(delta.facts.createdIds).toEqual([replacement.fact.id]);
    expect(delta.facts.updatedIds).toEqual([original.fact.id]);
    expect(delta.invalidatedFactIds).toEqual([original.fact.id]);
    expect(after.facts.find((fact) => fact.id === original.fact.id)?.invalidAt).toBe(30);
    expect(after.facts.find((fact) => fact.id === replacement.fact.id)?.objectText).toBe('sms');
  });

  it('rejects ambiguous or mismatched snapshot scopes', () => {
    expect(() =>
      captureScopedMemoryEvidence({ memoryConversationId: ' ', sourceThreadId: 'thread' }),
    ).toThrow('memoryConversationId must not be empty.');

    const before = captureScopedMemoryEvidence(SCOPE, 1);
    const after = captureScopedMemoryEvidence({ ...SCOPE, sourceThreadId: 'other-thread' }, 2);
    expect(() => buildScopedMemoryEvidenceDelta(before, after)).toThrow(
      'Memory evidence snapshots must target the same scope.',
    );
  });
});
