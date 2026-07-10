const {
  EVALUATION_STATISTICS_SCHEMA_URL,
  loadEvaluationStatisticsSchema,
  validateEvaluationStatisticsReport,
  validateEvaluationTrialSet,
} = require('./evaluationStatisticsContract');
const { analyzeEvaluationStatisticsEvidence } = require('./evaluationStatisticsEvidence');
const {
  bootstrapPairedMean,
  digestCanonicalValue,
  wilson95,
} = require('./evaluationStatisticsMath');
const { loadEvaluationContract, loadEvaluationSchema } = require('./evaluationContract');
const { readPrivateJsonFile } = require('./privateEvaluationFiles');

const ZERO_SHA_256 = '0'.repeat(64);
const ELIGIBILITY_FAILURE_ORDER = [
  'invalid_contract',
  'config_digest_mismatch',
  'scenario_manifest_digest_mismatch',
  'missing_trial',
  'duplicate_trial',
  'seed_mismatch',
  'skipped_evidence',
  'ambiguous_evidence',
  'infrastructure_error',
  'safety_invariant_failure',
  'safety_invariant_missing',
  'invalid_pair_evidence',
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : ZERO_SHA_256;
}

function normalizedAggregationConfig(value) {
  const validBootstrap =
    value?.bootstrap?.method === 'paired_scenario_cluster_percentile_v1' &&
    Number.isSafeInteger(value.bootstrap.seed) &&
    value.bootstrap.seed >= 0 &&
    value.bootstrap.seed <= 0xffffffff &&
    Number.isSafeInteger(value.bootstrap.samples) &&
    value.bootstrap.samples >= 1000 &&
    value.bootstrap.samples <= 100000;
  const trialCount =
    Number.isSafeInteger(value?.trialCount) && value.trialCount >= 1 && value.trialCount <= 100
      ? value.trialCount
      : 1;
  const seeds =
    Array.isArray(value?.seeds) && value.seeds.length === trialCount
      ? value.seeds
      : Array.from({ length: trialCount }, (_, index) => `invalid-${index + 1}`);
  const k = Number.isSafeInteger(value?.k) && value.k >= 1 && value.k <= trialCount ? value.k : 1;
  const comparison =
    value?.comparison === null ||
    (value?.comparison && typeof value.comparison === 'object' && !Array.isArray(value.comparison))
      ? value.comparison
      : null;
  return {
    trialCount,
    k,
    seeds,
    bootstrap: validBootstrap
      ? value.bootstrap
      : {
          method: 'paired_scenario_cluster_percentile_v1',
          seed: 0,
          samples: 1000,
        },
    comparison,
  };
}

function uniqueTrial(trialGrid, scenarioId, trialIndex) {
  const values = trialGrid.grid.get(`${scenarioId}\u0000${trialIndex}`) ?? [];
  return values.length === 1 ? values[0] : null;
}

function isEffectivePass(trial) {
  return (
    trial?.outcome === 'passed' &&
    trial?.accidentalSuccess === false &&
    asArray(trial?.safety).every((observation) => observation?.status === 'passed')
  );
}

function buildBinaryMetric(successes, total) {
  return {
    passed: successes,
    total,
    rate: total > 0 ? successes / total : null,
    wilson95: wilson95(successes, total),
  };
}

function buildMetricSet(manifestEntries, trialGrid, config) {
  let passAt1 = 0;
  let passAtK = 0;
  let allPass = 0;
  const resolvedEntries = manifestEntries.filter((entry) => {
    for (let trialIndex = 1; trialIndex <= config.trialCount; trialIndex += 1) {
      const trial = uniqueTrial(trialGrid, entry.id, trialIndex);
      if (!trial || !['passed', 'failed'].includes(trial.outcome)) return false;
      for (const invariantId of asArray(entry.safetyInvariantIds)) {
        const observations = asArray(trial.safety).filter(
          (observation) => observation?.id === invariantId,
        );
        if (observations.length !== 1 || observations[0].status === 'not_evaluated') return false;
      }
    }
    return true;
  });
  for (const entry of resolvedEntries) {
    const first = uniqueTrial(trialGrid, entry.id, 1);
    if (isEffectivePass(first)) passAt1 += 1;
    let anyWithinK = false;
    let everyTrial = true;
    for (let trialIndex = 1; trialIndex <= config.trialCount; trialIndex += 1) {
      const trial = uniqueTrial(trialGrid, entry.id, trialIndex);
      const passed = isEffectivePass(trial);
      if (trialIndex <= config.k && passed) anyWithinK = true;
      if (!passed) everyTrial = false;
    }
    if (anyWithinK) passAtK += 1;
    if (everyTrial) allPass += 1;
  }
  return {
    passAt1: buildBinaryMetric(passAt1, resolvedEntries.length),
    passAtK: buildBinaryMetric(passAtK, resolvedEntries.length),
    allPass: buildBinaryMetric(allPass, resolvedEntries.length),
  };
}

function buildSafetySummary(manifest, trialGrid, config) {
  const summary = new Map();
  for (const entry of manifest) {
    for (const invariantId of asArray(entry.safetyInvariantIds)) {
      if (!summary.has(invariantId)) {
        summary.set(invariantId, {
          id: invariantId,
          passed: 0,
          failed: 0,
          notEvaluated: 0,
          invariantSatisfied: true,
        });
      }
      const bucket = summary.get(invariantId);
      for (let trialIndex = 1; trialIndex <= config.trialCount; trialIndex += 1) {
        const trial = uniqueTrial(trialGrid, entry.id, trialIndex);
        const observations = asArray(trial?.safety).filter(
          (observation) => observation?.id === invariantId,
        );
        const status = observations.length === 1 ? observations[0].status : 'not_evaluated';
        if (status === 'passed') bucket.passed += 1;
        else if (status === 'failed') bucket.failed += 1;
        else bucket.notEvaluated += 1;
      }
    }
  }
  return [...summary.values()]
    .map((entry) => ({
      ...entry,
      invariantSatisfied: entry.failed === 0 && entry.notEvaluated === 0,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function buildFailureTaxonomy(trials, categories) {
  const counts = new Map(
    categories.map((category) => [category, { category, primaryCount: 0, secondaryCount: 0 }]),
  );
  for (const trial of trials) {
    for (const failure of asArray(trial?.failures)) {
      if (counts.has(failure?.primary)) counts.get(failure.primary).primaryCount += 1;
      for (const category of asArray(failure?.secondary)) {
        if (counts.has(category)) counts.get(category).secondaryCount += 1;
      }
    }
  }
  return categories.map((category) => counts.get(category));
}

function buildPairedSummary(input, analysis) {
  const bootstrap = input.aggregation.bootstrap;
  const comparisonRequested = input.aggregation.comparison !== null;
  const validPairs = analysis.pairs.validPairs;
  const qualifiedPairs = validPairs.filter(
    (pair) =>
      pair.reference.accidentalSuccess === false || pair.candidate.accidentalSuccess === false,
  );
  const clusters = new Map();
  for (const pair of validPairs) {
    if (!clusters.has(pair.scenarioId)) clusters.set(pair.scenarioId, { task: [], rubric: [] });
    const cluster = clusters.get(pair.scenarioId);
    const candidateTask = pair.candidate.accidentalSuccess ? 0 : pair.candidate.taskScore;
    const referenceTask = pair.reference.accidentalSuccess ? 0 : pair.reference.taskScore;
    const candidateRubric = pair.candidate.accidentalSuccess
      ? 0
      : pair.candidate.rubricPassed / pair.candidate.rubricTotal;
    const referenceRubric = pair.reference.accidentalSuccess
      ? 0
      : pair.reference.rubricPassed / pair.reference.rubricTotal;
    cluster.task.push(candidateTask - referenceTask);
    cluster.rubric.push(candidateRubric - referenceRubric);
  }
  const orderedClusters = [...clusters.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const taskDeltas = orderedClusters.map(
    ([, cluster]) => cluster.task.reduce((sum, value) => sum + value, 0) / cluster.task.length,
  );
  const rubricDeltas = orderedClusters.map(
    ([, cluster]) => cluster.rubric.reduce((sum, value) => sum + value, 0) / cluster.rubric.length,
  );
  const valid =
    comparisonRequested &&
    validPairs.length === analysis.pairs.expectedPairCount &&
    analysis.pairs.unresolvedPairCount === 0;
  return {
    status: comparisonRequested ? (valid ? 'valid' : 'invalid') : 'not_requested',
    expectedPairCount: analysis.pairs.expectedPairCount,
    resolvedPairCount: validPairs.length,
    qualifiedPairCount: qualifiedPairs.length,
    accidentalEndpointCount: validPairs.reduce(
      (count, pair) =>
        count + Number(pair.reference.accidentalSuccess) + Number(pair.candidate.accidentalSuccess),
      0,
    ),
    unresolvedPairCount: analysis.pairs.unresolvedPairCount,
    bootstrap: {
      method: bootstrap.method,
      seed: bootstrap.seed,
      samples: bootstrap.samples,
    },
    taskDelta: bootstrapPairedMean(taskDeltas, bootstrap),
    rubricDelta: bootstrapPairedMean(rubricDeltas, bootstrap),
    candidateOnlyPassCount: validPairs.filter(
      (pair) => pair.candidate.passed && !pair.reference.passed,
    ).length,
    referenceOnlyPassCount: validPairs.filter(
      (pair) => pair.reference.passed && !pair.candidate.passed,
    ).length,
  };
}

function sanitizeSource(source) {
  const lanes = new Set([
    'product_native',
    'memory_isolated',
    'full_upstream',
    'official_candidate',
  ]);
  const protocols = new Set(['product_native', 'adapted', 'upstream_full', 'official']);
  const splits = new Set([
    'development',
    'locked_validation',
    'sealed_held_out',
    'public_benchmark',
  ]);
  return {
    runManifestSchemaVersion: '1.0.0',
    runManifestSha256: safeDigest(source?.runManifestSha256),
    lane: lanes.has(source?.lane) ? source.lane : 'product_native',
    protocolConformance: protocols.has(source?.protocolConformance)
      ? source.protocolConformance
      : 'product_native',
    splitKind: splits.has(source?.splitKind) ? source.splitKind : 'development',
  };
}

function aggregateEvaluationStatistics(input, options) {
  const schemaFailures = validateEvaluationTrialSet(
    input,
    options.evaluationSchema,
    options.statisticsSchema,
  );
  const analysis = analyzeEvaluationStatisticsEvidence(input, schemaFailures);
  const config = normalizedAggregationConfig(input?.aggregation);
  const manifest = analysis.trialGrid.manifest.filter(
    (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
  );
  const trials = Array.isArray(input?.trials) ? input.trials : [];
  const declaredFamilies = Array.isArray(input?.families)
    ? input.families.filter(
        (family) => typeof family === 'string' && /^[a-z0-9][a-z0-9._-]*$/u.test(family),
      )
    : [];
  const families = (declaredFamilies.length > 0 ? [...new Set(declaredFamilies)] : ['invalid'])
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((family) => {
      const familyManifest = manifest.filter((entry) => asArray(entry?.families).includes(family));
      const familyScenarioIds = new Set(familyManifest.map((entry) => entry.id));
      return {
        family,
        scenarioCount: familyManifest.length,
        metrics: buildMetricSet(familyManifest, analysis.trialGrid, config),
        accidentalSuccessCount: trials.filter(
          (trial) => familyScenarioIds.has(trial?.scenarioId) && trial?.accidentalSuccess === true,
        ).length,
      };
    });
  const eligibilityFailures = ELIGIBILITY_FAILURE_ORDER.filter((failure) =>
    analysis.eligibilityFailures.has(failure),
  );
  const report = {
    $schema: EVALUATION_STATISTICS_SCHEMA_URL,
    kind: 'evaluation_statistics_report',
    schemaVersion: '1.0.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    inputSha256: safeDigest(options.inputSha256),
    source: sanitizeSource(input?.source),
    aggregationConfigSha256: digestCanonicalValue(config),
    scenarioManifestSha256: digestCanonicalValue(input?.scenarioManifest ?? []),
    reliabilityConfig: {
      trialCount: config.trialCount,
      k: config.k,
    },
    claimEligible: eligibilityFailures.length === 0,
    eligibilityFailures,
    evidence: {
      expectedTrialCount: analysis.expectedTrialCount,
      observedTrialCount: Array.isArray(input?.trials) ? input.trials.length : 0,
      ...analysis.evidence,
    },
    overall: buildMetricSet(manifest, analysis.trialGrid, config),
    families,
    paired: buildPairedSummary({ ...input, aggregation: config }, analysis),
    failureTaxonomy: buildFailureTaxonomy(trials, options.contract.failureCategories),
    safety: buildSafetySummary(manifest, analysis.trialGrid, config),
    accidentalSuccessCount: trials.filter((trial) => trial?.accidentalSuccess === true).length,
  };
  return {
    contractFailures: analysis.contractFailures,
    report,
    reportFailures: validateEvaluationStatisticsReport(
      report,
      options.evaluationSchema,
      options.statisticsSchema,
    ),
  };
}

function aggregatePrivateEvaluationStatisticsFile(projectRoot, inputPath, options = {}) {
  const evaluationSchema = loadEvaluationSchema(projectRoot);
  const statisticsSchema = loadEvaluationStatisticsSchema(projectRoot);
  const contract = loadEvaluationContract(projectRoot);
  const inputFile = readPrivateJsonFile(projectRoot, inputPath, 'statistics.input');
  return aggregateEvaluationStatistics(inputFile.value, {
    contract,
    evaluationSchema,
    generatedAt: options.generatedAt,
    inputSha256: inputFile.sha256,
    statisticsSchema,
  });
}

module.exports = {
  aggregateEvaluationStatistics,
  aggregatePrivateEvaluationStatisticsFile,
  buildBinaryMetric,
  buildMetricSet,
};
