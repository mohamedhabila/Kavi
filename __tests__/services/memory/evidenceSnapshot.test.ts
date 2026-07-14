jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  buildScopedMemoryEvidenceDelta,
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  captureScopedMemoryEvidence,
} from '../../../src/services/memory/evidenceSnapshot';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { resetE2EMemorySandbox } from '../../../src/acceptance/e2eAgent/sandboxMemory';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { recordContributionBackedFact } from '../../helpers/memoryRetirementTestFixtures';

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

  it('captures unscoped facts only for a freshly isolated evaluation vault', () => {
    const global = recordFact({
      subjectId: 'profile-owner',
      predicate: 'home_city',
      objectText: 'Utrecht',
      scope: 'global',
      now: 10,
    });
    const sibling = recordFact({
      subjectId: 'sibling-subject',
      predicate: 'sibling_fact',
      objectText: 'scenario-owned',
      scope: 'conversation',
      originConversationId: 'sibling-conversation',
      originThreadId: 'sibling-thread',
      now: 20,
    });

    expect(captureScopedMemoryEvidence(SCOPE, 30).facts).toEqual([]);
    expect(captureCompleteMemoryEvidenceForIsolatedEvaluation(SCOPE, 30).facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: global.fact.id,
          personaId: null,
          originConversationId: null,
        }),
        expect.objectContaining({ id: sibling.fact.id }),
      ]),
    );
  });

  it('excludes canonical tombstones from scoped exports while retaining isolated forensic evidence', () => {
    const recorded = recordContributionBackedFact(
      {
        subjectId: 'retired-evidence-subject',
        predicate: 'retired_evidence',
        objectText: 'must-not-leave-the-active-vault',
        scope: 'conversation',
        originConversationId: SCOPE.memoryConversationId,
        originThreadId: SCOPE.sourceThreadId,
        sourceMessageId: 'retired-evidence-message',
        sourceTurnId: 'retired-evidence-turn',
        now: 100,
      },
      {
        memoryConversationId: SCOPE.memoryConversationId,
        sourceThreadId: SCOPE.sourceThreadId,
        producerEventId: 'retired-evidence-event',
      },
    );

    expect(withdrawMemoryFact(recorded.fact.id, 200)).toMatchObject({ status: 'withdrawn' });
    expect(captureScopedMemoryEvidence(SCOPE, 300).facts).toEqual([]);
    expect(captureCompleteMemoryEvidenceForIsolatedEvaluation(SCOPE, 300).facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: recorded.fact.id, deletedAt: 200 })]),
    );
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
