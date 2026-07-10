import {
  evaluateExperienceLearning,
  type ExperienceAttemptEvidence,
  type ExperienceLearningPolicyInput,
} from '../../../src/services/memory/experienceLearningPolicy';

function attempt(
  index: number,
  outcome: ExperienceAttemptEvidence['outcome'],
  overrides: Partial<ExperienceAttemptEvidence> = {},
): ExperienceAttemptEvidence {
  return {
    runId: `run-${index}`,
    outcome,
    authority: 'tool_observed',
    confidence: 0.9,
    observedAt: index,
    ...overrides,
  };
}

function learningInput(
  attempts: ReadonlyArray<ExperienceAttemptEvidence>,
  overrides: Partial<ExperienceLearningPolicyInput> = {},
): ExperienceLearningPolicyInput {
  return {
    procedureId: 'procedure-settings',
    domainId: 'mobile',
    environmentId: 'android-reference',
    preconditionIds: ['signed-in'],
    attempts,
    ...overrides,
  };
}

describe('experience learning policy', () => {
  it('learns a preferred environment-bound procedure from repeated direct successes', () => {
    const decision = evaluateExperienceLearning(
      learningInput([
        attempt(1, 'success'),
        attempt(2, 'success'),
        attempt(3, 'success'),
        attempt(4, 'success'),
        attempt(5, 'failure'),
      ]),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        status: 'learned',
        recommendation: 'prefer',
        scope: {
          procedureId: 'procedure-settings',
          domainId: 'mobile',
          environmentId: 'android-reference',
          preconditionIds: ['signed-in'],
          generalization: 'environment_bound',
        },
        evidence: expect.objectContaining({ successCount: 4, failureCount: 1 }),
      }),
    );
  });

  it('never promotes one failed attempt into an avoidance rule', () => {
    expect(evaluateExperienceLearning(learningInput([attempt(1, 'failure')]))).toEqual({
      status: 'insufficient_evidence',
      reason: 'not_enough_direct_runs',
      directRunCount: 1,
      excludedInferredCount: 0,
    });
  });

  it('learns failure only from repeated direct evidence in the same declared scope', () => {
    expect(
      evaluateExperienceLearning(
        learningInput([attempt(1, 'failure'), attempt(2, 'failure'), attempt(3, 'failure')]),
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'learned',
        recommendation: 'avoid',
        evidence: expect.objectContaining({ failureCount: 3 }),
      }),
    );
  });

  it('excludes inferred summaries from support counts', () => {
    expect(
      evaluateExperienceLearning(
        learningInput([
          attempt(1, 'success'),
          attempt(2, 'success', { authority: 'assistant_inferred' }),
          attempt(3, 'success', { authority: 'assistant_inferred' }),
        ]),
      ),
    ).toEqual({
      status: 'insufficient_evidence',
      reason: 'not_enough_direct_runs',
      directRunCount: 1,
      excludedInferredCount: 2,
    });
  });

  it('does not learn from mixed outcomes below the dominant-rate bar', () => {
    expect(
      evaluateExperienceLearning(
        learningInput([
          attempt(1, 'success'),
          attempt(2, 'success'),
          attempt(3, 'failure'),
          attempt(4, 'failure'),
        ]),
      ),
    ).toEqual({
      status: 'insufficient_evidence',
      reason: 'mixed_outcomes',
      directRunCount: 4,
      excludedInferredCount: 0,
    });
  });

  it('deduplicates exact replay but rejects conflicting evidence for one run', () => {
    const first = attempt(1, 'success');
    expect(
      evaluateExperienceLearning(learningInput([first, { ...first }, attempt(2, 'success')])),
    ).toEqual({
      status: 'insufficient_evidence',
      reason: 'not_enough_direct_runs',
      directRunCount: 2,
      excludedInferredCount: 0,
    });
    expect(
      evaluateExperienceLearning(
        learningInput([first, { ...first, outcome: 'failure' }, attempt(2, 'success')]),
      ),
    ).toEqual({ status: 'invalid', reason: 'conflicting_run_evidence' });
  });

  it('fails closed on malformed identities, timestamps, bounds, or duplicate preconditions', () => {
    expect(
      evaluateExperienceLearning(
        learningInput([attempt(1, 'success')], { environmentId: ' android-reference' }),
      ),
    ).toEqual({ status: 'invalid', reason: 'invalid_input' });
    expect(
      evaluateExperienceLearning(learningInput([attempt(1, 'success', { observedAt: -1 })])),
    ).toEqual({ status: 'invalid', reason: 'invalid_input' });
    expect(
      evaluateExperienceLearning(
        learningInput([], { preconditionIds: ['signed-in', 'signed-in'] }),
      ),
    ).toEqual({ status: 'invalid', reason: 'invalid_input' });
  });
});
