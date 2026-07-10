import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const { aggregateEvaluationStatistics } = require('../../scripts/lib/evaluationStatistics');
const {
  loadEvaluationStatisticsSchema,
  validateEvaluationStatisticsReport,
} = require('../../scripts/lib/evaluationStatisticsContract');
const { digestCanonicalValue } = require('../../scripts/lib/evaluationStatisticsMath');
const {
  loadEvaluationContract,
  loadEvaluationSchema,
} = require('../../scripts/lib/evaluationContract');

const projectRoot = path.resolve(__dirname, '../..');
const evaluationSchema = loadEvaluationSchema(projectRoot);
const statisticsSchema = loadEvaluationStatisticsSchema(projectRoot);
const contract = loadEvaluationContract(projectRoot);

function removeEmptyDirectory(directory: string): void {
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error;
  }
}

function buildInput() {
  const aggregation = {
    trialCount: 3,
    seeds: [11, 22, 33],
    k: 3,
    bootstrap: {
      method: 'paired_scenario_cluster_percentile_v1',
      seed: 90210,
      samples: 1000,
    },
    comparison: {
      referenceConditionId: 'memory_off',
      candidateConditionId: 'production_auto',
    },
  };
  const scenarioManifest = [
    { id: 'scenario-1', families: ['memory'], safetyInvariantIds: ['no_scope_leak'] },
    { id: 'scenario-2', families: ['memory'], safetyInvariantIds: ['no_false_memory'] },
    { id: 'scenario-3', families: ['task_completion'], safetyInvariantIds: [] },
    { id: 'scenario-4', families: ['task_completion'], safetyInvariantIds: [] },
  ];
  const outcomes = [
    ['passed', 'passed', 'passed'],
    ['failed', 'passed', 'passed'],
    ['failed', 'failed', 'failed'],
    ['passed', 'passed', 'passed'],
  ];
  const trials = scenarioManifest.flatMap((scenario, scenarioIndex) =>
    outcomes[scenarioIndex].map((outcome, trialOffset) => {
      const passed = outcome === 'passed';
      return {
        scenarioId: scenario.id,
        trialIndex: trialOffset + 1,
        seed: aggregation.seeds[trialOffset],
        outcome,
        taskScore: passed ? 1 : 0,
        rubricPassed: passed ? 2 : 1,
        rubricTotal: 2,
        failures: passed
          ? []
          : [
              {
                primary:
                  scenarioIndex === 2 ? 'premature_completion' : 'memory_utilization_failure',
                secondary: [],
              },
            ],
        safety: scenario.safetyInvariantIds.map((id) => ({ id, status: 'passed' })),
        accidentalSuccess: scenarioIndex === 3 && trialOffset === 0,
      };
    }),
  );
  const pairedComparisons = trials.map((trial) => {
    const referencePassed = trial.scenarioId === 'scenario-4';
    return {
      id: `pair-${trial.scenarioId}-${trial.trialIndex}`,
      scenarioId: trial.scenarioId,
      trialIndex: trial.trialIndex,
      seed: trial.seed,
      reference: {
        role: 'reference',
        conditionId: 'memory_off',
        outcome: 'completed',
        passed: referencePassed,
        taskScore: referencePassed ? 1 : 0,
        rubricPassed: referencePassed ? 2 : 0,
        rubricTotal: 2,
        accidentalSuccess: false,
      },
      candidate: {
        role: 'candidate',
        conditionId: 'production_auto',
        outcome: 'completed',
        passed: trial.outcome === 'passed' && !trial.accidentalSuccess,
        taskScore: trial.taskScore,
        rubricPassed: trial.rubricPassed,
        rubricTotal: trial.rubricTotal,
        accidentalSuccess: trial.accidentalSuccess,
      },
    };
  });
  return {
    $schema:
      'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/statistics.schema.json',
    kind: 'evaluation_trial_set',
    schemaVersion: '1.0.0',
    id: 'private-product-trials-v1',
    source: {
      runManifestSchemaVersion: '1.0.0',
      runManifestSha256: 'a'.repeat(64),
      lane: 'product_native',
      protocolConformance: 'product_native',
      splitKind: 'locked_validation',
    },
    aggregationConfigSha256: digestCanonicalValue(aggregation),
    scenarioManifestSha256: digestCanonicalValue(scenarioManifest),
    aggregation,
    families: ['memory', 'task_completion'],
    scenarioManifest,
    trials,
    pairedComparisons,
  };
}

function aggregate(input: ReturnType<typeof buildInput>) {
  return aggregateEvaluationStatistics(input, {
    contract,
    evaluationSchema,
    generatedAt: '2025-01-10T00:00:00.000Z',
    inputSha256: 'b'.repeat(64),
    statisticsSchema,
  });
}

describe('deterministic evaluation statistics', () => {
  it('computes manifest-denominated reliability, Wilson intervals, and paired deltas', () => {
    const result = aggregate(buildInput());

    expect(result.contractFailures).toEqual([]);
    expect(result.reportFailures).toEqual([]);
    expect(result.report).toMatchObject({
      claimEligible: true,
      eligibilityFailures: [],
      evidence: {
        expectedTrialCount: 12,
        observedTrialCount: 12,
        missingTrialCount: 0,
        duplicateTrialCount: 0,
        seedMismatchCount: 0,
      },
      overall: {
        passAt1: { passed: 1, total: 4, rate: 0.25 },
        passAtK: { passed: 3, total: 4, rate: 0.75 },
        allPass: { passed: 1, total: 4, rate: 0.25 },
      },
      paired: {
        status: 'valid',
        expectedPairCount: 12,
        resolvedPairCount: 12,
        qualifiedPairCount: 12,
        accidentalEndpointCount: 1,
        unresolvedPairCount: 0,
        referenceOnlyPassCount: 1,
        bootstrap: {
          method: 'paired_scenario_cluster_percentile_v1',
          seed: 90210,
          samples: 1000,
        },
      },
      accidentalSuccessCount: 1,
    });
    expect(result.report.overall.passAtK.wilson95.low).toBeCloseTo(0.30064, 4);
    expect(result.report.overall.passAtK.wilson95.high).toBeCloseTo(0.95441, 4);
    expect(result.report.paired.taskDelta.mean).toBeCloseTo(1 / 3, 12);
    expect(result.report.paired.rubricDelta.mean).toBeCloseTo(0.5, 12);
    expect(result.report.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 'memory',
          scenarioCount: 2,
          metrics: expect.objectContaining({
            passAt1: expect.objectContaining({ passed: 1, total: 2, rate: 0.5 }),
          }),
        }),
      ]),
    );
    expect(result.report.failureTaxonomy).toHaveLength(20);
    expect(result.report.failureTaxonomy).toEqual(
      expect.arrayContaining([
        {
          category: 'premature_completion',
          primaryCount: 3,
          secondaryCount: 0,
        },
      ]),
    );
    expect(
      validateEvaluationStatisticsReport(result.report, evaluationSchema, statisticsSchema),
    ).toEqual([]);
  });

  it('is byte-deterministic for a frozen input, bootstrap seed, and generated time', () => {
    const input = buildInput();
    const first = aggregate(input).report;
    const second = aggregate(input).report;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.paired.taskDelta.bootstrap95).toEqual(second.paired.taskDelta.bootstrap95);
    expect(first.paired.rubricDelta.bootstrap95).toEqual(second.paired.rubricDelta.bootstrap95);
  });

  it('does not let accidental success inflate pass-at-k or paired deltas', () => {
    const input = buildInput();
    const accidentalTrials = input.trials.filter((trial) => trial.scenarioId === 'scenario-3');
    const accidentalPairs = input.pairedComparisons.filter(
      (pair) => pair.scenarioId === 'scenario-3',
    );
    if (accidentalTrials.length !== 3 || accidentalPairs.length !== 3) {
      throw new Error('fixture must include the complete scenario-3 trial grid');
    }
    accidentalTrials.forEach((trial) => {
      trial.outcome = 'passed';
      trial.taskScore = 1;
      trial.rubricPassed = 2;
      trial.failures = [];
      trial.accidentalSuccess = true;
    });
    accidentalPairs.forEach((pair) => {
      pair.candidate.passed = false;
      pair.candidate.taskScore = 1;
      pair.candidate.rubricPassed = 2;
      pair.candidate.accidentalSuccess = true;
    });

    const report = aggregate(input).report;
    expect(report.overall.passAtK).toMatchObject({ passed: 3, total: 4, rate: 0.75 });
    expect(report.accidentalSuccessCount).toBe(4);
    expect(report.paired).toMatchObject({
      resolvedPairCount: 12,
      qualifiedPairCount: 12,
      accidentalEndpointCount: 4,
    });
  });

  it('keeps missing and duplicate trials visible while excluding unresolved scenarios from rates', () => {
    const input = buildInput();
    input.trials.pop();
    input.trials.push({ ...input.trials[0] });
    const result = aggregate(input).report;

    expect(result.claimEligible).toBe(false);
    expect(result.eligibilityFailures).toEqual(
      expect.arrayContaining(['missing_trial', 'duplicate_trial']),
    );
    expect(result.evidence).toMatchObject({
      expectedTrialCount: 12,
      observedTrialCount: 12,
      missingTrialCount: 1,
      duplicateTrialCount: 1,
    });
    expect(result.overall.passAt1.total).toBe(2);
    expect(result.families.reduce((sum, family) => sum + family.scenarioCount, 0)).toBe(4);
  });

  it('invalidates denominator edits and unknown families or failure categories', () => {
    const denominatorEdit = buildInput();
    denominatorEdit.scenarioManifest.pop();
    expect(aggregate(denominatorEdit).report).toMatchObject({
      claimEligible: false,
      eligibilityFailures: expect.arrayContaining(['scenario_manifest_digest_mismatch']),
    });

    const unknowns = buildInput();
    unknowns.scenarioManifest[0].families = ['undeclared-family'];
    const failedTrial = unknowns.trials.find((trial) => trial.outcome === 'failed');
    if (!failedTrial) throw new Error('fixture must include a failed trial');
    failedTrial.failures[0].primary = 'unknown_failure_category';
    const result = aggregate(unknowns);
    expect(result.report.claimEligible).toBe(false);
    expect(result.report.eligibilityFailures).toContain('invalid_contract');
    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('families: must contain only declared families'),
        expect.stringContaining('primary: must be equal to one of the allowed values'),
      ]),
    );
    expect(result.report.failureTaxonomy).toHaveLength(20);
  });

  it('rejects infrastructure failures disguised as product failures', () => {
    const input = buildInput();
    const failedTrial = input.trials.find((trial) => trial.outcome === 'failed');
    if (!failedTrial) throw new Error('fixture must include a failed trial');
    failedTrial.failures = [{ primary: 'infrastructure_or_evaluator', secondary: [] }];

    const result = aggregate(input);
    expect(result.report.claimEligible).toBe(false);
    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('product failures must not contain infrastructure_or_evaluator'),
      ]),
    );
  });

  it('rejects reversed comparison roles and bootstrap seed drift', () => {
    const reversed = buildInput();
    reversed.pairedComparisons[0].reference.role = 'candidate';
    reversed.pairedComparisons[0].candidate.role = 'reference';
    const reversedResult = aggregate(reversed);
    expect(reversedResult.report.claimEligible).toBe(false);
    expect(reversedResult.report.paired.status).toBe('invalid');
    expect(reversedResult.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must preserve the declared reference comparison role'),
        expect.stringContaining('must preserve the declared candidate comparison role'),
      ]),
    );

    const seedDrift = buildInput();
    seedDrift.aggregation.bootstrap.seed += 1;
    expect(aggregate(seedDrift).report).toMatchObject({
      claimEligible: false,
      eligibilityFailures: expect.arrayContaining(['config_digest_mismatch']),
    });
  });

  it('enforces the exact trial seed grid, k bound, and pair outcome fields', () => {
    const input = buildInput();
    input.trials[0].seed = 999;
    input.aggregation.k = 4;
    input.aggregationConfigSha256 = digestCanonicalValue(input.aggregation);
    input.pairedComparisons[0].candidate.outcome = 'ambiguous';
    const result = aggregate(input);

    expect(result.report.claimEligible).toBe(false);
    expect(result.report.eligibilityFailures).toEqual(
      expect.arrayContaining(['invalid_contract', 'seed_mismatch', 'invalid_pair_evidence']),
    );
    expect(result.report.evidence.seedMismatchCount).toBeGreaterThan(0);
    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'must declare one unique seed per trial and k within the trial count',
        ),
        expect.stringContaining('unresolved evidence must not carry scores'),
      ]),
    );

    const forgedCandidateScores = buildInput();
    const forgedPair = forgedCandidateScores.pairedComparisons.find(
      (pair) => pair.scenarioId === 'scenario-3',
    );
    if (!forgedPair) throw new Error('fixture must include a failed candidate pair');
    forgedPair.candidate.taskScore = 0.75;
    const forgedResult = aggregate(forgedCandidateScores);
    expect(forgedResult.report.claimEligible).toBe(false);
    expect(forgedResult.report.paired.status).toBe('invalid');
    expect(forgedResult.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'must exactly match candidate trial scores, accidental status, and effective pass',
        ),
      ]),
    );
  });

  it('keeps skipped, ambiguous, infrastructure, accidental, and safety evidence distinct', () => {
    const input = buildInput();
    const [skipped, ambiguous, infrastructure, safetyFailure] = input.trials;
    for (const trial of [skipped, ambiguous, infrastructure]) {
      trial.taskScore = null;
      trial.rubricPassed = null;
      trial.rubricTotal = null;
      trial.accidentalSuccess = false;
      trial.failures = [];
    }
    skipped.outcome = 'skipped';
    ambiguous.outcome = 'ambiguous';
    infrastructure.outcome = 'infrastructure_error';
    infrastructure.failures = [{ primary: 'infrastructure_or_evaluator', secondary: [] }];
    safetyFailure.outcome = 'failed';
    safetyFailure.taskScore = 0;
    safetyFailure.rubricPassed = 1;
    safetyFailure.failures = [{ primary: 'memory_utilization_failure', secondary: [] }];
    safetyFailure.safety[0].status = 'failed';
    const report = aggregate(input).report;

    expect(report.claimEligible).toBe(false);
    expect(report.eligibilityFailures).toEqual(
      expect.arrayContaining([
        'skipped_evidence',
        'ambiguous_evidence',
        'infrastructure_error',
        'safety_invariant_failure',
      ]),
    );
    expect(report.evidence).toMatchObject({
      skippedCount: 1,
      ambiguousCount: 1,
      infrastructureErrorCount: 1,
    });
    expect(report.safety).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no_false_memory', failed: 1, invariantSatisfied: false }),
      ]),
    );
    expect(report.accidentalSuccessCount).toBe(1);
  });

  it('never publishes private trial text, scenario ids, or unresolved labels', () => {
    const input = buildInput() as ReturnType<typeof buildInput> & { privateText?: string };
    input.privateText = 'SECRET PRIVATE TRIAL TRANSCRIPT';
    const result = aggregate(input);
    const serialized = JSON.stringify(result.report);

    expect(result.report.claimEligible).toBe(false);
    expect(serialized).not.toContain('SECRET PRIVATE TRIAL TRANSCRIPT');
    expect(serialized).not.toContain('scenario-1');
    expect(serialized).not.toContain('private-product-trials-v1');
    expect(serialized).not.toContain('ambiguousLabel');
    expect(serialized).not.toContain('"seeds"');
  });

  it('uses null rates and intervals when every scenario is unresolved', () => {
    const input = buildInput();
    input.trials = [];
    input.pairedComparisons = [];
    const result = aggregate(input);

    expect(result.report.claimEligible).toBe(false);
    expect(result.report.overall).toEqual({
      passAt1: { passed: 0, total: 0, rate: null, wilson95: null },
      passAtK: { passed: 0, total: 0, rate: null, wilson95: null },
      allPass: { passed: 0, total: 0, rate: null, wilson95: null },
    });
    expect(result.reportFailures).toEqual([]);
  });

  it('returns a bounded failed report for malformed arrays and aggregation configs', () => {
    const malformed = buildInput() as unknown as {
      aggregation: object;
      aggregationConfigSha256: string;
      scenarioManifest: object;
      trials: object;
      pairedComparisons: object;
      [key: string]: unknown;
    };
    malformed.aggregation = {};
    malformed.aggregationConfigSha256 = '0'.repeat(64);
    malformed.scenarioManifest = {};
    malformed.trials = {};
    malformed.pairedComparisons = {};

    const result = aggregateEvaluationStatistics(malformed, {
      contract,
      evaluationSchema,
      generatedAt: '2025-01-10T00:00:00.000Z',
      inputSha256: 'b'.repeat(64),
      statisticsSchema,
    });
    expect(result.reportFailures).toEqual([]);
    expect(result.report).toMatchObject({
      claimEligible: false,
      eligibilityFailures: expect.arrayContaining([
        'invalid_contract',
        'config_digest_mismatch',
        'scenario_manifest_digest_mismatch',
      ]),
      overall: {
        passAt1: { passed: 0, total: 0, rate: null, wilson95: null },
        passAtK: { passed: 0, total: 0, rate: null, wilson95: null },
        allPass: { passed: 0, total: 0, rate: null, wilson95: null },
      },
    });

    const nullResult = aggregateEvaluationStatistics(null, {
      contract,
      evaluationSchema,
      generatedAt: '2025-01-10T00:00:00.000Z',
      inputSha256: 'b'.repeat(64),
      statisticsSchema,
    });
    expect(nullResult.reportFailures).toEqual([]);
    expect(nullResult.report).toMatchObject({
      claimEligible: false,
      overall: {
        passAt1: { total: 0, rate: null, wilson95: null },
      },
    });

    const nestedMalformed = buildInput();
    (nestedMalformed.scenarioManifest[0] as unknown as { families: object }).families = {};
    (nestedMalformed.trials[0] as unknown as { failures: object; safety: object }).failures = {};
    (nestedMalformed.trials[0] as unknown as { failures: object; safety: object }).safety = {};
    const nestedResult = aggregate(nestedMalformed);
    expect(nestedResult.reportFailures).toEqual([]);
    expect(nestedResult.report.claimEligible).toBe(false);
  });

  it('rejects forged, internally inconsistent aggregate reports', () => {
    const report = aggregate(buildInput()).report;
    report.claimEligible = false;
    report.overall.passAt1.passed = report.overall.passAt1.total + 1;
    report.overall.passAt1.rate = 0.123;
    report.failureTaxonomy.reverse();
    report.families.reverse();
    report.paired.qualifiedPairCount = report.paired.resolvedPairCount + 1;
    report.paired.candidateOnlyPassCount = 8;
    report.paired.referenceOnlyPassCount = 7;
    report.safety[0].invariantSatisfied = false;

    expect(validateEvaluationStatisticsReport(report, evaluationSchema, statisticsSchema)).toEqual(
      expect.arrayContaining([
        'report.claimEligible: must equal absence of eligibility failures',
        expect.stringContaining('report.overall.passAt1.passed: must not exceed total'),
        expect.stringContaining('report.overall.passAt1.rate: must equal passed divided by total'),
        'report.failureTaxonomy: must exactly match the canonical failure taxonomy',
        'report.families: must be sorted by family',
        'report.paired.qualifiedPairCount: must not exceed resolvedPairCount',
        'report.paired: qualified pass diagnostics must not exceed qualified pairs',
        expect.stringContaining('invariantSatisfied: must reflect failures and missing evidence'),
      ]),
    );
  });

  it('runs one private-input CLI and writes a content-free aggregate', () => {
    const privateRoot = path.join(projectRoot, '.private', 'evals');
    fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(privateRoot, 'statistics-test-'));
    const inputPath = path.join(directory, 'trials.json');
    const outputRelativePath = path.join('.artifacts', `statistics-test-${process.pid}.json`);
    const outputPath = path.join(projectRoot, outputRelativePath);
    try {
      fs.writeFileSync(inputPath, `${JSON.stringify(buildInput())}\n`, { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        [
          './scripts/evaluation-statistics.js',
          '--input',
          inputPath,
          '--output',
          outputRelativePath,
        ],
        { cwd: projectRoot, encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('claimEligible=true');
      expect(result.stdout).not.toContain(inputPath);
      expect(result.stderr).toBe('');
      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      expect(report.claimEligible).toBe(true);
      expect(JSON.stringify(report)).not.toContain(inputPath);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(outputPath, { force: true });
      removeEmptyDirectory(path.dirname(outputPath));
    }
  });
});
