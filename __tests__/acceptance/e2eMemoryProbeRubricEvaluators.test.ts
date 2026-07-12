import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import type { MemoryFactEvidenceRecord } from '../../src/services/memory/evidenceSnapshot';
import type { MemoryRetrievalEvent } from '../../src/services/memory/retrievalEventTypes';
import { buildFixtureResult, buildFixtureTurnTrace } from '../helpers/e2eRunReportHarness';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

function fact(
  id: string,
  predicate: string,
  value: string,
  overrides: Partial<MemoryFactEvidenceRecord> = {},
): MemoryFactEvidenceRecord {
  return {
    id,
    subjectId: 'memory-subject',
    subject: 'memory-subject',
    predicate,
    objectText: value,
    contentHash: `hash-${id}`,
    confidence: 1,
    scope: 'conversation',
    memoryKind: 'semantic_fact',
    personaId: null,
    originConversationId: 'memory-conversation',
    originThreadId: 'memory-thread',
    originTaskId: null,
    sourceMessageId: 'source-message',
    sourceRunId: null,
    sourceTurnId: null,
    validAt: 1,
    invalidAt: null,
    expiresAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    reviewState: 'auto',
    sensitivity: 'normal',
    ...overrides,
  };
}

function retrievalEvent(selectedFactIds: string[]): MemoryRetrievalEvent {
  return {
    id: 'retrieval-event',
    operation: 'prompt_assembly',
    mode: 'query',
    outcome: 'completed',
    queryFingerprint: { hashAlgorithm: 'sha256', hash: 'a'.repeat(64), length: 10, unitCount: 2 },
    scope: {
      memoryConversationIdHash: 'b'.repeat(64),
      sourceThreadIdHash: 'c'.repeat(64),
      taskScopePresent: false,
    },
    counts: {
      candidateFactCount: selectedFactIds.length,
      selectedFactCount: selectedFactIds.length,
      selectedFactIds,
      candidateEpisodeCount: 0,
      selectedEpisodeCount: 0,
      selectedEpisodeIds: [],
    },
    timings: {
      planMs: 0,
      factRecallMs: 0,
      episodeRecallMs: 0,
      candidateFetchMs: 0,
      scoreMs: 0,
      selectorMs: 0,
      evidenceExpansionMs: 0,
      totalMs: 0,
    },
    candidates: {
      strategy: 'lexical',
      localSimilarityOutcome: 'not_requested',
      eligibleScanCount: 0,
      pinnedCount: 0,
      exactQuotedCount: 0,
      lexicalCount: selectedFactIds.length,
      entityCount: 0,
      temporalCount: 0,
      localSimilarityCount: 0,
      unionCount: selectedFactIds.length,
      diversifiedCount: selectedFactIds.length,
      unionMs: 0,
    },
    expansion: {
      outcome: 'not_requested',
      requestedSourceCount: 0,
      acceptedSourceCount: 0,
      sourceWithEvidenceCount: 0,
      emittedEvidenceCount: 0,
      promptBudgetDroppedCount: 0,
      promptChars: 0,
      durationMs: 0,
    },
    selector: { mode: 'deterministic', outcome: 'not_requested' },
    barrier: null,
    createdAt: 2,
  };
}

function result(input: {
  answer: string;
  facts: MemoryFactEvidenceRecord[];
  selectedFactIds: string[];
  retrievalStatus?: 'recorded' | 'missing';
}): E2EScenarioResult {
  return buildFixtureResult({
    fixtureId: 'memory-probe',
    memoryFinalState: {
      capturedAt: 10,
      scope: { memoryConversationId: 'memory-conversation', sourceThreadId: 'memory-thread' },
      facts: input.facts,
      episodes: [],
      workingBlocks: [],
      ingestionJobs: [],
    },
    turnTraces: [
      buildFixtureTurnTrace({
        turnIndex: 2,
        finalAssistant: {
          messageId: 'assistant-probe',
          text: input.answer,
          timestamp: 9,
          completionStatus: 'complete',
          finishReason: 'stop',
          terminalReason: null,
        },
        retrieval: {
          sourceThreadIdHash: 'c'.repeat(64),
          instrumentationStatus: input.retrievalStatus ?? 'recorded',
          events:
            (input.retrievalStatus ?? 'recorded') === 'recorded'
              ? [retrievalEvent(input.selectedFactIds)]
              : [],
        },
      }),
    ],
  });
}

describe('turn-scoped memory probe rubrics', () => {
  it('does not let a correct final database state mask a wrong probe answer', () => {
    const evidence = result({
      answer: 'I could not find it.',
      facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
      selectedFactIds: ['current'],
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'fact_values', requiredValues: ['ACCESS-CURRENT'] },
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 2 final response omitted required memory value',
    });
  });

  it('rejects exact values that appear only inside denial or uncertainty', () => {
    for (const answer of [
      'I could not verify ACCESS-CURRENT.',
      'The value might be ACCESS-CURRENT.',
      'Unverified: ACCESS-CURRENT',
      'There is no evidence for ACCESS-CURRENT.',
    ]) {
      const evidence = result({
        answer,
        facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
        selectedFactIds: ['current'],
      });

      expect(
        evaluateE2ERubric(evidence, {
          kind: 'turn_memory_answer',
          turnIndex: 2,
          answer: { kind: 'fact_values', requiredValues: ['ACCESS-CURRENT'] },
        }),
      ).toMatchObject({
        passed: false,
        detail: 'turn 2 final response omitted required memory value',
      });
    }
  });

  it('accepts a direct assertion after a separate uncertainty sentence', () => {
    const evidence = result({
      answer:
        'I could not verify it against an external source. The remembered access code is ACCESS-CURRENT.',
      facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
      selectedFactIds: ['current'],
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'fact_values', requiredValues: ['ACCESS-CURRENT'] },
      }),
    ).toMatchObject({ passed: true });
  });

  it('does not let a correct answer mask a prompt-retrieval miss', () => {
    const evidence = result({
      answer: 'ACCESS-CURRENT',
      facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
      selectedFactIds: [],
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [
          {
            subject: 'memory-subject',
            predicate: 'access_code',
            value: 'ACCESS-CURRENT',
            scope: 'conversation',
          },
        ],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 did not select a required memory fact' });
  });

  it('requires the selected fact to match the canonical subject and scope', () => {
    const evidence = result({
      answer: 'ACCESS-CURRENT',
      facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
      selectedFactIds: ['current'],
    });
    const expectation = {
      predicate: 'access_code',
      value: 'ACCESS-CURRENT',
      scope: 'conversation' as const,
    };

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [{ subject: 'wrong-subject', ...expectation }],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 did not select a required memory fact' });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [{ subject: 'memory-subject', ...expectation, scope: 'global' }],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 did not select a required memory fact' });
  });

  it('rejects a stale value in either the answer or selected prompt memory', () => {
    const facts = [
      fact('stale', 'preferred_station', 'STATION-OLD', { invalidAt: 5 }),
      fact('current', 'preferred_station', 'STATION-NEW'),
    ];
    const evidence = result({
      answer: 'The current station is STATION-NEW (formerly STATION-OLD).',
      facts,
      selectedFactIds: ['current', 'stale'],
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: {
          kind: 'fact_values',
          requiredValues: ['STATION-NEW'],
          forbiddenValues: ['STATION-OLD'],
        },
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 2 final response surfaced forbidden memory value',
    });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [
          {
            subject: 'memory-subject',
            predicate: 'preferred_station',
            value: 'STATION-NEW',
            scope: 'conversation',
          },
        ],
        forbiddenFacts: [
          {
            subject: 'memory-subject',
            predicate: 'preferred_station',
            value: 'STATION-OLD',
            scope: 'conversation',
          },
        ],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 selected a forbidden memory fact' });
  });

  it('requires an explicit exact abstention and zero selected facts', () => {
    const known = fact('known', 'known_code', 'KNOWN-CODE');
    const vague = result({ answer: 'I am not sure.', facts: [known], selectedFactIds: [] });
    expect(
      evaluateE2ERubric(vague, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'abstention', exactText: 'UNKNOWN' },
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 2 did not return the explicit abstention',
    });

    const polluted = result({ answer: 'UNKNOWN', facts: [known], selectedFactIds: ['known'] });
    expect(
      evaluateE2ERubric(polluted, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [],
        forbiddenFacts: [
          {
            subject: 'memory-subject',
            predicate: 'known_code',
            value: 'KNOWN-CODE',
            scope: 'conversation',
          },
        ],
        maxSelectedFacts: 0,
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 selected too many memory facts' });

    const clean = result({ answer: ' UNKNOWN \n', facts: [known], selectedFactIds: [] });
    expect(
      evaluateE2ERubric(clean, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'abstention', exactText: 'UNKNOWN' },
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(clean, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [],
        forbiddenFacts: [
          {
            subject: 'memory-subject',
            predicate: 'known_code',
            value: 'KNOWN-CODE',
            scope: 'conversation',
          },
        ],
        maxSelectedFacts: 0,
      }),
    ).toMatchObject({ passed: true });
  });

  it('fails closed on missing instrumentation and malformed expectations', () => {
    const evidence = result({
      answer: 'ACCESS-CURRENT',
      facts: [fact('current', 'access_code', 'ACCESS-CURRENT')],
      selectedFactIds: [],
      retrievalStatus: 'missing',
    });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredFacts: [
          {
            subject: 'memory-subject',
            predicate: 'access_code',
            value: 'ACCESS-CURRENT',
            scope: 'conversation',
          },
        ],
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 2 prompt retrieval evidence is unavailable',
    });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'fact_values', requiredValues: [' ACCESS-CURRENT'] },
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 2 memory answer expectation is invalid',
    });
  });
});
