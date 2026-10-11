import type { ForegroundScenarioMemoryItemRecord } from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryItemsEvidence';
import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { buildFixtureResult, buildFixtureTurnTrace } from '../helpers/e2eRunReportHarness';

function item(
  id: string,
  text: string,
  overrides: Partial<ForegroundScenarioMemoryItemRecord> = {},
): ForegroundScenarioMemoryItemRecord {
  return {
    id,
    text,
    scope: 'conversation',
    pinned: false,
    sensitive: false,
    supersededBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function result(input: {
  answer: string;
  items: ForegroundScenarioMemoryItemRecord[];
  selectedItemIds: string[];
  promptStatus?: 'recorded' | 'missing';
}): E2EScenarioResult {
  const status = input.promptStatus ?? 'recorded';
  return buildFixtureResult({
    fixtureId: 'memory-probe',
    memoryItems: { capturedAt: 10, items: input.items },
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
        memoryPrompt: {
          status,
          builds:
            status === 'recorded'
              ? [{ itemIds: input.selectedItemIds, turnIds: [], chars: 100, durationMs: 1 }]
              : [],
        },
      }),
    ],
  });
}

const CURRENT = item('current', 'memory-subject access_code is ACCESS-CURRENT');

describe('turn-scoped memory probe rubrics', () => {
  it('does not let a correct final database state mask a wrong probe answer', () => {
    const evidence = result({
      answer: 'I could not find it.',
      items: [CURRENT],
      selectedItemIds: ['current'],
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

  it('treats exact value presence as language-agnostic structural evidence', () => {
    for (const answer of [
      'I could not verify ACCESS-CURRENT.',
      'The value might be ACCESS-CURRENT.',
      'Unverified: ACCESS-CURRENT',
      'There is no evidence for ACCESS-CURRENT.',
      'القيمة الحالية هي ACCESS-CURRENT.',
    ]) {
      const evidence = result({ answer, items: [CURRENT], selectedItemIds: ['current'] });

      expect(
        evaluateE2ERubric(evidence, {
          kind: 'turn_memory_answer',
          turnIndex: 2,
          answer: { kind: 'fact_values', requiredValues: ['ACCESS-CURRENT'] },
        }),
      ).toMatchObject({ passed: true });
    }
  });

  it('accepts a direct assertion after a separate uncertainty sentence', () => {
    const evidence = result({
      answer:
        'I could not verify it against an external source. The remembered access code is ACCESS-CURRENT.',
      items: [CURRENT],
      selectedItemIds: ['current'],
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
    const evidence = result({ answer: 'ACCESS-CURRENT', items: [CURRENT], selectedItemIds: [] });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: ['memory-subject', 'ACCESS-CURRENT'] }],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 did not select a required memory item' });
  });

  it('requires the selected item to hold every token, in the named scope', () => {
    const evidence = result({
      answer: 'ACCESS-CURRENT',
      items: [CURRENT, item('other', 'other-subject access_code is ACCESS-OTHER')],
      selectedItemIds: ['other', 'current'],
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: ['MEMORY-SUBJECT', 'access-current'], scope: 'conversation' }],
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: ['memory-subject', 'ACCESS-CURRENT'], scope: 'global' }],
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: ['memory-subject', 'ACCESS-OTHER'] }],
      }),
    ).toMatchObject({ passed: false });
  });

  it('rejects a stale value in either the answer or selected prompt memory', () => {
    const items = [
      item('stale', 'memory-subject preferred_station is STATION-OLD', { supersededBy: 'current' }),
      item('current', 'memory-subject preferred_station is STATION-NEW, replacing STATION-OLD'),
    ];
    const staleSelected = result({
      answer: 'The current station is STATION-NEW (formerly STATION-OLD).',
      items,
      selectedItemIds: ['current', 'stale'],
    });
    const selection = {
      kind: 'turn_memory_selection',
      turnIndex: 2,
      requiredItems: [{ contains: ['memory-subject', 'STATION-NEW'] }],
      forbiddenItems: [{ contains: ['memory-subject', 'STATION-OLD'], excludes: ['STATION-NEW'] }],
    } as const;

    expect(
      evaluateE2ERubric(staleSelected, {
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
    expect(evaluateE2ERubric(staleSelected, selection)).toMatchObject({
      passed: false,
      detail: 'turn 2 selected a forbidden memory item',
    });
    // The correction mentions the old value; that alone is not the stale memory.
    expect(
      evaluateE2ERubric(
        result({ answer: 'STATION-NEW', items, selectedItemIds: ['current'] }),
        selection,
      ),
    ).toMatchObject({ passed: true });
  });

  it('requires an explicit exact abstention and zero selected items', () => {
    const known = item('known', 'memory-subject known_code is KNOWN-CODE');
    const abstain = {
      kind: 'turn_memory_selection',
      turnIndex: 2,
      requiredItems: [],
      forbiddenItems: [{ contains: ['KNOWN-CODE'] }],
      maxSelectedItems: 0,
    } as const;

    expect(
      evaluateE2ERubric(result({ answer: 'I am not sure.', items: [known], selectedItemIds: [] }), {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'abstention', exactText: 'UNKNOWN' },
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 did not return the explicit abstention' });
    expect(
      evaluateE2ERubric(
        result({ answer: 'UNKNOWN', items: [known], selectedItemIds: ['known'] }),
        abstain,
      ),
    ).toMatchObject({ passed: false, detail: 'turn 2 selected too many memory items' });

    const clean = result({ answer: ' UNKNOWN \n', items: [known], selectedItemIds: [] });
    expect(
      evaluateE2ERubric(clean, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'abstention', exactText: 'UNKNOWN' },
      }),
    ).toMatchObject({ passed: true });
    expect(evaluateE2ERubric(clean, abstain)).toMatchObject({ passed: true });
  });

  it('fails closed on missing instrumentation and malformed expectations', () => {
    const evidence = result({
      answer: 'ACCESS-CURRENT',
      items: [CURRENT],
      selectedItemIds: [],
      promptStatus: 'missing',
    });

    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: ['ACCESS-CURRENT'] }],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 prompt memory evidence is unavailable' });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_selection',
        turnIndex: 2,
        requiredItems: [{ contains: [' ACCESS-CURRENT'] }],
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 memory selection expectation is invalid' });
    expect(
      evaluateE2ERubric(evidence, {
        kind: 'turn_memory_answer',
        turnIndex: 2,
        answer: { kind: 'fact_values', requiredValues: [' ACCESS-CURRENT'] },
      }),
    ).toMatchObject({ passed: false, detail: 'turn 2 memory answer expectation is invalid' });
  });
});
