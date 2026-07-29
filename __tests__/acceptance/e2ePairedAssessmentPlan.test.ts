import { buildE2EPairedAssessmentPlan } from '../../src/acceptance/e2eAgent/e2ePairedAssessmentPlan';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';
import type { LlmProviderConfig } from '../../src/types/provider';

const PROVIDER: LlmProviderConfig = {
  id: 'provider',
  name: 'Provider',
  enabled: true,
  kind: 'remote',
  protocol: 'openai-chat',
  providerFamily: 'custom',
  apiKey: 'secret-not-retained',
  model: 'model',
  baseUrl: 'https://example.com/v1',
};

const SCENARIO: E2EScenario = {
  id: 'paired-plan',
  conversationId: 'paired-plan-conversation',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'chitchat', route: 'production_auto' },
  prompt: 'Remember and use the preference.',
  userTurns: [{ content: 'Remember the preference.' }, { content: 'Use the preference.' }],
  rubrics: [{ kind: 'min_user_turns', min: 2 }],
};

describe('paired assessment plan', () => {
  it('freezes identical product inputs around the two declared treatments', () => {
    const plan = buildE2EPairedAssessmentPlan({
      pairId: 'memory-control-vs-product',
      provider: PROVIDER,
      scenario: SCENARIO,
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
      seed: 42,
    });

    expect(plan.comparison).toEqual({
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
    });
    expect(plan.conditions.map((condition) => condition.condition)).toEqual([
      'memory_off',
      'production_auto',
    ]);
    expect(plan.conditions[0]?.invariantConfigHash).toBe(plan.conditions[1]?.invariantConfigHash);
    expect(plan.conditions[0]?.invariantConfig).toMatchObject({
      seed: 42,
      provider: { modelLocatorHash: expect.stringMatching(/^sha256:/u) },
      scenarioInput: { fixtureId: 'paired-plan' },
    });
    expect(JSON.stringify(plan)).not.toContain('secret-not-retained');
  });

  it.each(['oracle_evidence', 'unsupported'])(
    'rejects %s without a declared product treatment',
    (condition) => {
      expect(() =>
        buildE2EPairedAssessmentPlan({
          pairId: 'invalid-treatment',
          provider: PROVIDER,
          scenario: SCENARIO,
          referenceCondition: condition,
          candidateCondition: 'production_auto',
          seed: 1,
        }),
      ).toThrow('not an executable paired assessment condition');
    },
  );
});
