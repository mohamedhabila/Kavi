import { evaluateE2EPairedCausalMemoryAssessment } from '../../src/acceptance/e2eAgent/e2ePairedCausalMemoryAssessment';
import { buildE2EPairedAssessmentPlan } from '../../src/acceptance/e2eAgent/e2ePairedAssessmentPlan';
import { validateE2EPairedCausalMemoryContract } from '../../src/acceptance/e2eAgent/e2ePairedCausalMemoryContract';
import { lookupE2EScenarioBenchmarkMeta } from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import {
  E2E_AGENT_SCENARIOS,
  E2E_PAIRED_ONLY_SCENARIOS,
  PAIRED_CAUSAL_GLOBAL_PREFERENCE_SCENARIO,
} from '../../src/acceptance/e2eAgent/scenarios';
import type { E2EScenario, E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildPairedRetrievalEvent } from '../helpers/e2ePairedRunHarness';
import { completedCondition, runtime } from '../helpers/e2ePairedPublicReportHarness';
import { buildFixtureResult, buildFixtureTurnTrace } from '../helpers/e2eRunReportHarness';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const MINI_SCENARIO: E2EScenario = {
  id: 'causal-memory-contract-test',
  conversationId: 'causal-memory-contract-test-conversation',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'chitchat', route: 'production_auto' },
  prompt: 'Use remembered context in a fresh conversation.',
  rubrics: [
    { kind: 'min_user_turns', min: 1 },
    { kind: 'turn_lifecycle_boundary', turnIndex: 0, boundary: 'new_conversation' },
    {
      kind: 'turn_memory_selection',
      turnIndex: 0,
      requiredFacts: [{ subject: 'user', predicate: 'duration', value: '45', scope: 'global' }],
    },
    { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '1' },
  ],
  pairedEvaluation: {
    kind: 'causal_memory',
    referenceCondition: 'memory_off',
    candidateCondition: 'production_auto',
    neutralRubricIndexes: [0, 1],
    causalRubricIndexes: [2, 3],
  },
};

const PROVIDER: LlmProviderConfig = {
  id: 'causal-provider',
  name: 'Causal provider',
  enabled: true,
  kind: 'remote',
  protocol: 'openai-chat',
  providerFamily: 'custom',
  apiKey: 'private-key',
  model: 'causal-model',
  baseUrl: 'https://causal.example.com/v1',
};

function conditionResult(product: boolean): E2EScenarioResult {
  const baseTurn = buildFixtureTurnTrace();
  const stateAfter = JSON.parse(JSON.stringify(baseTurn.native.stateAfter));
  stateAfter.calendar.createdEventCount = product ? 1 : 0;
  const fact = {
    id: 'private-fact-id',
    subject: 'user',
    predicate: 'duration',
    objectText: '45',
    scope: 'global',
  } as E2EScenarioResult['memoryFinalState']['facts'][number];
  return buildFixtureResult({
    fixtureId: MINI_SCENARIO.id,
    userTurnCount: 1,
    memoryFinalState: {
      ...buildFixtureResult().memoryFinalState,
      facts: product ? [fact] : [],
    },
    turnTraces: [
      buildFixtureTurnTrace({
        lifecycleBefore: {
          boundary: 'new_conversation',
          chatStore: 'fresh_conversation',
          memoryStore: 'shared_global',
          previousConversationMessageCount: 2,
          newConversationInitialMessageCount: 0,
        },
        native: { ...baseTurn.native, stateAfter },
        retrieval: product
          ? {
              sourceThreadIdHash: 'a'.repeat(64),
              instrumentationStatus: 'recorded',
              events: [buildPairedRetrievalEvent()],
            }
          : { sourceThreadIdHash: null, instrumentationStatus: 'opt_out', events: [] },
      }),
    ],
  });
}

function pairedRuntime(referenceResult: E2EScenarioResult, candidateResult: E2EScenarioResult) {
  const reference = completedCondition({
    condition: 'memory_off',
    rubricPassed: 0,
    rubricTotal: 1,
  });
  const candidate = completedCondition({
    condition: 'production_auto',
    rubricPassed: 1,
    rubricTotal: 1,
  });
  return runtime([
    { ...reference, result: referenceResult },
    { ...candidate, result: candidateResult },
  ]);
}

describe('paired causal-memory scenario and contract', () => {
  it('registers a natural paired-only kavi-core scenario with a fresh-conversation boundary', () => {
    const scenario = PAIRED_CAUSAL_GLOBAL_PREFERENCE_SCENARIO;
    expect(E2E_PAIRED_ONLY_SCENARIOS).toContain(scenario);
    expect(E2E_AGENT_SCENARIOS).not.toContain(scenario);
    expect(lookupE2EScenarioBenchmarkMeta(scenario.id).benchmarkFamilies).toEqual(['kavi-core']);
    expect(scenario.userTurns?.[2]).toMatchObject({
      lifecycleBefore: 'new_conversation',
      selectedMode: 'agentic',
    });
    const prompt = scenario.userTurns?.map((turn) => turn.content).join('\n') ?? '';
    expect(prompt).not.toContain('default_meeting_duration_minutes');
    expect(prompt).not.toContain('subject `');
    expect(validateE2EPairedCausalMemoryContract(scenario)).toEqual(scenario.pairedEvaluation);
    expect(scenario.pairedEvaluation).toMatchObject({
      neutralRubricIndexes: Array.from({ length: 25 }, (_value, index) => index),
      causalRubricIndexes: Array.from({ length: 11 }, (_value, index) => index + 25),
    });
    const neutralRubrics = scenario.pairedEvaluation!.neutralRubricIndexes.map(
      (index) => scenario.rubrics[index],
    );
    expect(neutralRubrics).toEqual(
      expect.arrayContaining([
        {
          kind: 'turn_native_invocation_count',
          turnIndex: 0,
          expectedCount: 0,
        },
        {
          kind: 'turn_native_invocation_count',
          turnIndex: 1,
          expectedCount: 0,
        },
      ]),
    );
    expect(scenario.initialMessages).toBeUndefined();
  });

  it('freezes the causal roles and fresh boundary identically across paired treatments', () => {
    const scenario = PAIRED_CAUSAL_GLOBAL_PREFERENCE_SCENARIO;
    const plan = buildE2EPairedAssessmentPlan({
      pairId: 'causal-memory-frozen-inputs',
      provider: PROVIDER,
      scenario,
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
      seed: 42,
    });

    expect(plan.conditions[0]?.invariantConfigHash).toBe(plan.conditions[1]?.invariantConfigHash);
    expect(plan.conditions[0]?.invariantConfig.scenarioInput).toMatchObject({
      pairedEvaluation: scenario.pairedEvaluation,
      userTurns: expect.arrayContaining([
        expect.objectContaining({ lifecycleBefore: 'new_conversation' }),
      ]),
    });
    expect(
      plan.conditions.every((condition) => condition.conditionConfig.oracleEvidenceCount === 0),
    ).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('private-key');
  });

  it('accepts only a clean product-only causal outcome with neutral parity', () => {
    const reference = conditionResult(false);
    const candidate = conditionResult(true);
    expect(
      evaluateE2EPairedCausalMemoryAssessment({
        runtime: pairedRuntime(reference, candidate),
        scenario: MINI_SCENARIO,
      }),
    ).toMatchObject({
      claimEligible: true,
      status: 'eligible',
      neutral: { referencePassed: 2, candidatePassed: 2, total: 2 },
      causal: { referencePassed: 0, candidatePassed: 2, total: 2 },
    });
  });

  it('fails closed for product failure, accidental control success, or neutral regression', () => {
    const control = conditionResult(false);
    const product = conditionResult(true);
    expect(
      evaluateE2EPairedCausalMemoryAssessment({
        runtime: pairedRuntime(control, control),
        scenario: MINI_SCENARIO,
      }),
    ).toMatchObject({ claimEligible: false, status: 'product_causal_failure' });
    expect(
      evaluateE2EPairedCausalMemoryAssessment({
        runtime: pairedRuntime(product, product),
        scenario: MINI_SCENARIO,
      }),
    ).toMatchObject({ claimEligible: false, status: 'control_causal_success' });
    const regressed = {
      ...product,
      turnTraces: [{ ...product.turnTraces[0]!, lifecycleBefore: null }],
    };
    expect(
      evaluateE2EPairedCausalMemoryAssessment({
        runtime: pairedRuntime(control, regressed),
        scenario: MINI_SCENARIO,
      }),
    ).toMatchObject({ claimEligible: false, status: 'neutral_regression' });

    const reversed = pairedRuntime(control, product);
    expect(
      evaluateE2EPairedCausalMemoryAssessment({
        runtime: { ...reversed, conditions: [...reversed.conditions].reverse() },
        scenario: MINI_SCENARIO,
      }),
    ).toMatchObject({ claimEligible: false, status: 'invalid_infrastructure' });
  });

  it('rejects overlapping or incomplete rubric role declarations', () => {
    expect(() =>
      validateE2EPairedCausalMemoryContract({
        ...MINI_SCENARIO,
        pairedEvaluation: {
          ...MINI_SCENARIO.pairedEvaluation!,
          neutralRubricIndexes: [0, 1, 2],
        },
      }),
    ).toThrow('exact non-overlapping partition');

    expect(() =>
      validateE2EPairedCausalMemoryContract({
        ...MINI_SCENARIO,
        pairedEvaluation: {
          ...MINI_SCENARIO.pairedEvaluation!,
          neutralRubricIndexes: [0, 1, 2],
          causalRubricIndexes: [3],
        },
      }),
    ).toThrow('neutral guards must not contain positive memory claims');

    expect(() =>
      validateE2EPairedCausalMemoryContract({
        ...MINI_SCENARIO,
        rubrics: [
          MINI_SCENARIO.rubrics[0]!,
          MINI_SCENARIO.rubrics[1]!,
          { kind: 'min_user_turns', min: 1 },
          MINI_SCENARIO.rubrics[3]!,
        ],
      }),
    ).toThrow('causal roles contain a non-causal rubric kind');
  });
});
