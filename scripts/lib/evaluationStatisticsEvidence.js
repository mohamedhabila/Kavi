const { digestCanonicalValue } = require('./evaluationStatisticsMath');

const ZERO_SHA_256 = '0'.repeat(64);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameSeed(left, right) {
  return typeof left === typeof right && left === right;
}

function addContractFailure(analysis, location, message) {
  analysis.contractFailures.push(`${location}: ${message}`);
  analysis.eligibilityFailures.add('invalid_contract');
}

function addEligibility(analysis, code, countField) {
  analysis.eligibilityFailures.add(code);
  if (countField) analysis.evidence[countField] += 1;
}

function validateScoreFields(value, location, analysis) {
  const completed =
    value?.outcome === 'passed' || value?.outcome === 'failed' || value?.outcome === 'completed';
  const scoresPresent =
    Number.isFinite(value?.taskScore) &&
    Number.isSafeInteger(value?.rubricPassed) &&
    Number.isSafeInteger(value?.rubricTotal) &&
    value.rubricTotal > 0 &&
    value.rubricPassed >= 0 &&
    value.rubricPassed <= value.rubricTotal;
  if (completed !== scoresPresent) {
    addContractFailure(
      analysis,
      location,
      completed
        ? 'completed evidence requires bounded task and rubric scores'
        : 'unresolved evidence must not carry scores',
    );
    return false;
  }
  return scoresPresent;
}

function validateTrial(trial, index, manifestEntry, input, analysis) {
  const location = `input.trials[${index}]`;
  const config = isRecord(input?.aggregation) ? input.aggregation : { trialCount: 0, seeds: [] };
  const seeds = asArray(config.seeds);
  if (!manifestEntry) {
    addContractFailure(analysis, `${location}.scenarioId`, 'must reference the scenario manifest');
    return;
  }
  if (
    !Number.isSafeInteger(trial?.trialIndex) ||
    trial.trialIndex < 1 ||
    trial.trialIndex > config.trialCount
  ) {
    addContractFailure(
      analysis,
      `${location}.trialIndex`,
      'must be inside the declared trial grid',
    );
  } else if (!sameSeed(trial.seed, seeds[trial.trialIndex - 1])) {
    addEligibility(analysis, 'seed_mismatch', 'seedMismatchCount');
  }
  const scoresValid = validateScoreFields(trial, location, analysis);
  const failures = asArray(trial?.failures);
  if (trial?.outcome === 'passed' && failures.length > 0) {
    addContractFailure(analysis, `${location}.failures`, 'must be empty for a passed trial');
  }
  if (trial?.outcome === 'failed' && failures.length === 0) {
    addContractFailure(analysis, `${location}.failures`, 'must classify a failed trial');
  }
  if (
    trial?.outcome === 'failed' &&
    failures.some(
      (failure) =>
        failure?.primary === 'infrastructure_or_evaluator' ||
        asArray(failure?.secondary).includes('infrastructure_or_evaluator'),
    )
  ) {
    addContractFailure(
      analysis,
      `${location}.failures`,
      'product failures must not contain infrastructure_or_evaluator',
    );
  }
  if (
    trial?.outcome === 'infrastructure_error' &&
    !failures.some((failure) => failure?.primary === 'infrastructure_or_evaluator')
  ) {
    addContractFailure(
      analysis,
      `${location}.failures`,
      'must classify infrastructure_or_evaluator as primary',
    );
  }
  for (const [failureIndex, failure] of failures.entries()) {
    if (asArray(failure?.secondary).includes(failure.primary)) {
      addContractFailure(
        analysis,
        `${location}.failures[${failureIndex}].secondary`,
        'must not repeat the primary category',
      );
    }
  }

  const expectedSafety = new Set(asArray(manifestEntry.safetyInvariantIds));
  const observedSafety = new Set();
  const safetyObservations = asArray(trial?.safety);
  for (const [safetyIndex, observation] of safetyObservations.entries()) {
    if (observedSafety.has(observation?.id)) {
      addContractFailure(
        analysis,
        `${location}.safety[${safetyIndex}].id`,
        'must be unique within the trial',
      );
    }
    observedSafety.add(observation?.id);
    if (!expectedSafety.has(observation?.id)) {
      addContractFailure(
        analysis,
        `${location}.safety[${safetyIndex}].id`,
        'must be declared by the scenario manifest',
      );
    }
  }
  for (const invariantId of expectedSafety) {
    if (!observedSafety.has(invariantId)) addEligibility(analysis, 'safety_invariant_missing');
  }
  const safetyFailed = safetyObservations.some((entry) => entry?.status === 'failed');
  const safetyMissing = safetyObservations.some((entry) => entry?.status === 'not_evaluated');
  if (safetyFailed) addEligibility(analysis, 'safety_invariant_failure');
  if (safetyMissing) addEligibility(analysis, 'safety_invariant_missing');
  if (
    trial?.outcome === 'passed' &&
    scoresValid &&
    (trial.taskScore !== 1 ||
      trial.rubricPassed !== trial.rubricTotal ||
      safetyFailed ||
      safetyMissing)
  ) {
    addContractFailure(
      analysis,
      location,
      'a passed trial requires complete task, rubric, and safety success',
    );
  }
  if (trial?.accidentalSuccess === true && trial?.outcome !== 'passed') {
    addContractFailure(
      analysis,
      `${location}.accidentalSuccess`,
      'can only annotate a passed trial',
    );
  }
  if (trial?.outcome === 'skipped') addEligibility(analysis, 'skipped_evidence', 'skippedCount');
  if (trial?.outcome === 'ambiguous') {
    addEligibility(analysis, 'ambiguous_evidence', 'ambiguousCount');
  }
  if (trial?.outcome === 'infrastructure_error') {
    addEligibility(analysis, 'infrastructure_error', 'infrastructureErrorCount');
  }
}

function buildTrialGrid(input, analysis) {
  const manifest = Array.isArray(input?.scenarioManifest) ? input.scenarioManifest : [];
  const manifestById = new Map();
  const declaredFamilies = new Set(asArray(input?.families));
  const coveredFamilies = new Set();
  manifest.forEach((entry, index) => {
    if (manifestById.has(entry?.id)) {
      addContractFailure(analysis, `input.scenarioManifest[${index}].id`, 'must be unique');
    }
    manifestById.set(entry?.id, entry);
    for (const family of asArray(entry?.families)) {
      if (!declaredFamilies.has(family)) {
        addContractFailure(
          analysis,
          `input.scenarioManifest[${index}].families`,
          'must contain only declared families',
        );
      }
      coveredFamilies.add(family);
    }
  });
  for (const family of declaredFamilies) {
    if (!coveredFamilies.has(family)) {
      addContractFailure(analysis, 'input.families', 'every family must own a scenario');
    }
  }

  const grid = new Map();
  const trials = asArray(input?.trials);
  for (const trial of trials) {
    const key = `${trial?.scenarioId}\u0000${trial?.trialIndex}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(trial);
  }
  trials.forEach((trial, index) => {
    validateTrial(trial, index, manifestById.get(trial?.scenarioId), input, analysis);
  });
  const trialCount = Number.isSafeInteger(input?.aggregation?.trialCount)
    ? input.aggregation.trialCount
    : 0;
  for (const entry of manifest) {
    for (let trialIndex = 1; trialIndex <= trialCount; trialIndex += 1) {
      const values = grid.get(`${entry?.id}\u0000${trialIndex}`) ?? [];
      if (values.length === 0) addEligibility(analysis, 'missing_trial', 'missingTrialCount');
      if (values.length > 1) addEligibility(analysis, 'duplicate_trial', 'duplicateTrialCount');
      if (values.length !== 1 && asArray(entry?.safetyInvariantIds).length > 0) {
        analysis.eligibilityFailures.add('safety_invariant_missing');
      }
    }
  }
  analysis.expectedTrialCount = manifest.length * trialCount;
  return { grid, manifest, manifestById };
}

function validateAggregationConfig(input, analysis) {
  const config = isRecord(input?.aggregation) ? input.aggregation : null;
  const seeds = asArray(config?.seeds);
  if (
    !config ||
    seeds.length !== config.trialCount ||
    config.k > config.trialCount ||
    config.k < 1
  ) {
    addContractFailure(
      analysis,
      'input.aggregation',
      'must declare one unique seed per trial and k within the trial count',
    );
  }
  const actualDigest = digestCanonicalValue(config);
  if (input?.aggregationConfigSha256 !== actualDigest) {
    analysis.eligibilityFailures.add('config_digest_mismatch');
  }
  if (input?.scenarioManifestSha256 !== digestCanonicalValue(input?.scenarioManifest)) {
    analysis.eligibilityFailures.add('scenario_manifest_digest_mismatch');
  }
  if (input?.source?.runManifestSha256 === ZERO_SHA_256) {
    addContractFailure(analysis, 'input.source.runManifestSha256', 'must be non-zero');
  }
}

function validateEndpoint(endpoint, expectedRole, expectedConditionId, location, analysis) {
  if (endpoint?.role !== expectedRole || endpoint?.conditionId !== expectedConditionId) {
    addContractFailure(
      analysis,
      location,
      `must preserve the declared ${expectedRole} comparison role`,
    );
    return false;
  }
  const scoresValid = validateScoreFields(endpoint, location, analysis);
  if (
    endpoint?.outcome === 'completed' &&
    scoresValid &&
    endpoint.passed !==
      (endpoint.taskScore === 1 &&
        endpoint.rubricPassed === endpoint.rubricTotal &&
        endpoint.accidentalSuccess === false)
  ) {
    addContractFailure(
      analysis,
      location,
      'completed pass state must match task and rubric scores',
    );
    return false;
  }
  return scoresValid;
}

function analyzePairs(input, trialGrid, analysis) {
  const config = isRecord(input?.aggregation)
    ? input.aggregation
    : { trialCount: 0, seeds: [], comparison: null };
  const seeds = asArray(config.seeds);
  const comparison = config?.comparison;
  const pairs = Array.isArray(input?.pairedComparisons) ? input.pairedComparisons : [];
  const expectedPairCount = comparison ? analysis.expectedTrialCount : 0;
  if (!comparison) {
    if (pairs.length > 0) {
      addContractFailure(
        analysis,
        'input.pairedComparisons',
        'must be empty when no comparison is declared',
      );
      analysis.eligibilityFailures.add('invalid_pair_evidence');
    }
    return { expectedPairCount, validPairs: [], unresolvedPairCount: 0 };
  }
  if (comparison.referenceConditionId === comparison.candidateConditionId) {
    addContractFailure(
      analysis,
      'input.aggregation.comparison',
      'must declare distinct reference and candidate conditions',
    );
  }
  const byGrid = new Map();
  const pairIds = new Set();
  const validPairs = [];
  let unresolvedPairCount = 0;
  pairs.forEach((pair, index) => {
    const location = `input.pairedComparisons[${index}]`;
    if (pairIds.has(pair?.id)) addContractFailure(analysis, `${location}.id`, 'must be unique');
    pairIds.add(pair?.id);
    const key = `${pair?.scenarioId}\u0000${pair?.trialIndex}`;
    if (!byGrid.has(key)) byGrid.set(key, []);
    byGrid.get(key).push(pair);
    const manifestEntry = trialGrid.manifestById.get(pair?.scenarioId);
    if (!manifestEntry)
      addContractFailure(analysis, `${location}.scenarioId`, 'must be in the manifest');
    const seedValid =
      Number.isSafeInteger(pair?.trialIndex) &&
      pair.trialIndex >= 1 &&
      pair.trialIndex <= config.trialCount &&
      sameSeed(pair.seed, seeds[pair.trialIndex - 1]);
    if (!seedValid) addEligibility(analysis, 'seed_mismatch', 'seedMismatchCount');
    const referenceValid = validateEndpoint(
      pair?.reference,
      'reference',
      comparison.referenceConditionId,
      `${location}.reference`,
      analysis,
    );
    const candidateValid = validateEndpoint(
      pair?.candidate,
      'candidate',
      comparison.candidateConditionId,
      `${location}.candidate`,
      analysis,
    );
    const resolved =
      pair?.reference?.outcome === 'completed' && pair?.candidate?.outcome === 'completed';
    if (!resolved) {
      unresolvedPairCount += 1;
      analysis.eligibilityFailures.add('invalid_pair_evidence');
      if (
        pair?.reference?.outcome === 'infrastructure_error' ||
        pair?.candidate?.outcome === 'infrastructure_error'
      ) {
        analysis.eligibilityFailures.add('infrastructure_error');
      }
    } else if (referenceValid && candidateValid && seedValid && manifestEntry) {
      const candidateTrial = trialGrid.grid.get(key) ?? [];
      const expectedCandidatePassed =
        candidateTrial.length === 1 &&
        candidateTrial[0].outcome === 'passed' &&
        candidateTrial[0].accidentalSuccess === false &&
        asArray(candidateTrial[0].safety).every((observation) => observation?.status === 'passed');
      const candidateEvidenceMatches =
        candidateTrial.length === 1 &&
        pair.candidate.taskScore === candidateTrial[0].taskScore &&
        pair.candidate.rubricPassed === candidateTrial[0].rubricPassed &&
        pair.candidate.rubricTotal === candidateTrial[0].rubricTotal &&
        pair.candidate.accidentalSuccess === candidateTrial[0].accidentalSuccess &&
        pair.candidate.passed === expectedCandidatePassed;
      if (!candidateEvidenceMatches) {
        addContractFailure(
          analysis,
          `${location}.candidate`,
          'must exactly match candidate trial scores, accidental status, and effective pass in the same grid cell',
        );
      } else {
        validPairs.push(pair);
      }
    }
  });
  for (const manifestEntry of trialGrid.manifest) {
    for (let trialIndex = 1; trialIndex <= config.trialCount; trialIndex += 1) {
      const values = byGrid.get(`${manifestEntry?.id}\u0000${trialIndex}`) ?? [];
      if (values.length !== 1) analysis.eligibilityFailures.add('invalid_pair_evidence');
      if (values.length === 0) unresolvedPairCount += 1;
      if (values.length > 1) unresolvedPairCount += values.length - 1;
    }
  }
  if (validPairs.length !== expectedPairCount || unresolvedPairCount > 0) {
    analysis.eligibilityFailures.add('invalid_pair_evidence');
  }
  return { expectedPairCount, validPairs, unresolvedPairCount };
}

function analyzeEvaluationStatisticsEvidence(input, initialContractFailures = []) {
  const analysis = {
    contractFailures: [...initialContractFailures],
    eligibilityFailures: new Set(initialContractFailures.length > 0 ? ['invalid_contract'] : []),
    evidence: {
      missingTrialCount: 0,
      duplicateTrialCount: 0,
      seedMismatchCount: 0,
      skippedCount: 0,
      ambiguousCount: 0,
      infrastructureErrorCount: 0,
    },
    expectedTrialCount: 0,
  };
  validateAggregationConfig(input, analysis);
  const trialGrid = buildTrialGrid(input, analysis);
  const pairs = analyzePairs(input, trialGrid, analysis);
  return { ...analysis, pairs, trialGrid };
}

module.exports = {
  analyzeEvaluationStatisticsEvidence,
  sameSeed,
};
