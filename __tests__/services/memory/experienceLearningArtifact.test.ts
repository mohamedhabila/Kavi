import {
  buildExperienceLearningArtifact,
  retrieveExperienceLearnings,
  sanitizeExperienceLearningArtifact,
  type ExperienceProcedureObservation,
} from '../../../src/services/memory/experienceLearningArtifact';

function observation(
  runId: string,
  overrides: Partial<ExperienceProcedureObservation> = {},
): ExperienceProcedureObservation {
  return {
    runId,
    domainId: 'travel',
    environmentId: 'state-bench-v0.8.0',
    procedureId: 'transition:get_booking>cancel_booking',
    preconditionIds: ['tool:get_booking'],
    outcome: 'success',
    authority: 'tool_observed',
    confidence: 0.9,
    observedAt: 100,
    evidenceTerms: ['cancellation_fee', 'refund_amount'],
    ...overrides,
  };
}

describe('experience learning artifacts', () => {
  it('learns only after independent direct runs corroborate one scoped procedure', () => {
    const result = buildExperienceLearningArtifact([
      observation('run-1'),
      observation('run-2'),
      observation('run-3'),
      observation('run-inferred', { authority: 'assistant_inferred' }),
    ]);

    expect(result.diagnostics).toEqual({
      observationCount: 4,
      invalidObservationCount: 0,
      groupCount: 1,
      learnedGroupCount: 1,
      insufficientGroupCount: 0,
      invalidGroupCount: 0,
    });
    expect(result.artifact.records).toEqual([
      expect.objectContaining({
        domainId: 'travel',
        environmentId: 'state-bench-v0.8.0',
        procedureId: 'transition:get_booking>cancel_booking',
        recommendation: 'prefer',
        commonEvidenceTerms: ['cancellation_fee', 'refund_amount'],
        evidence: {
          runIds: ['run-1', 'run-2', 'run-3'],
          successCount: 3,
          failureCount: 0,
        },
      }),
    ]);
  });

  it('does not promote a one-off or mixed procedure into a learning', () => {
    const oneOff = buildExperienceLearningArtifact([observation('run-1'), observation('run-2')]);
    const mixed = buildExperienceLearningArtifact([
      observation('run-1'),
      observation('run-2'),
      observation('run-3', { outcome: 'failure' }),
      observation('run-4', { outcome: 'failure' }),
    ]);

    expect(oneOff.artifact.records).toEqual([]);
    expect(oneOff.diagnostics.insufficientGroupCount).toBe(1);
    expect(mixed.artifact.records).toEqual([]);
    expect(mixed.diagnostics.insufficientGroupCount).toBe(1);
  });

  it('learns an avoid recommendation from repeated directly observed failures', () => {
    const result = buildExperienceLearningArtifact([
      observation('run-1', { outcome: 'failure' }),
      observation('run-2', { outcome: 'failure' }),
      observation('run-3', { outcome: 'failure' }),
      observation('run-4', { outcome: 'failure' }),
    ]);

    expect(result.artifact.records[0].recommendation).toBe('avoid');
    expect(result.artifact.records[0].confidence).toBeCloseTo(0.72);
  });

  it('keeps only evidence terms corroborated across the dominant runs', () => {
    const result = buildExperienceLearningArtifact([
      observation('run-1', { evidenceTerms: ['refund_amount', 'one_off_value'] }),
      observation('run-2', { evidenceTerms: ['refund_amount'] }),
      observation('run-3', { evidenceTerms: ['refund_amount'] }),
      observation('run-4', { evidenceTerms: ['refund_amount'] }),
      observation('run-5', { evidenceTerms: ['refund_amount'] }),
    ]);

    expect(result.artifact.records[0].commonEvidenceTerms).toEqual(['refund_amount']);
  });

  it('retrieves within the requested domain using bounded lexical ranking', () => {
    const travel = [observation('travel-1'), observation('travel-2'), observation('travel-3')];
    const support = ['support-1', 'support-2', 'support-3'].map((runId) =>
      observation(runId, {
        domainId: 'customer_support',
        procedureId: 'transition:get_order>create_return',
        preconditionIds: ['tool:get_order'],
        evidenceTerms: ['return_window'],
      }),
    );
    const artifact = buildExperienceLearningArtifact([...travel, ...support]).artifact;

    expect(
      retrieveExperienceLearnings({
        artifact,
        query: 'Cancel the booking and calculate the refund amount',
        domainId: 'travel',
        topK: 3,
      }),
    ).toEqual([expect.stringContaining('transition:get_booking>cancel_booking')]);
    expect(
      retrieveExperienceLearnings({
        artifact,
        query: 'Create a return',
        domainId: 'travel',
      }).join('\n'),
    ).not.toContain('create_return');
  });

  it('rejects malformed persisted artifacts instead of partially loading them', () => {
    const artifact = buildExperienceLearningArtifact([
      observation('run-1'),
      observation('run-2'),
      observation('run-3'),
    ]).artifact;
    const malformed = {
      ...artifact,
      records: [
        { ...artifact.records[0], evidence: { ...artifact.records[0].evidence, runIds: [] } },
      ],
    };

    expect(sanitizeExperienceLearningArtifact(malformed)).toBeUndefined();
    expect(retrieveExperienceLearnings({ artifact: malformed, query: 'cancel booking' })).toEqual(
      [],
    );
  });

  it('counts malformed observations without producing a partial learned rule', () => {
    const result = buildExperienceLearningArtifact([
      observation('run-1'),
      observation('run-2'),
      observation(' invalid run '),
    ]);

    expect(result.diagnostics.invalidObservationCount).toBe(1);
    expect(result.artifact.records).toEqual([]);
  });
});
