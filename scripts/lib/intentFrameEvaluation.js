const {
  INTENT_FRAME_ELIGIBILITY_FAILURES,
  INTENT_FRAME_FIELDS,
  INTENT_FRAME_SCHEMA_URL,
  loadIntentFrameSchema,
  validateIntentFrameInput,
  validateIntentFrameReport,
} = require('./intentFrameContract');
const { digestCanonicalValue, mean } = require('./evaluationStatisticsMath');
const { readPrivateJsonFile } = require('./privateEvaluationFiles');

const ZERO_SHA_256 = '0'.repeat(64);
const ATOM_FIELDS = new Set([
  'goal',
  'entities',
  'constraints',
  'preferences',
  'missingInformation',
  'temporalRequirements',
  'successCriteria',
]);
const PRODUCT_AREAS = new Set([
  'chat',
  'memory',
  'mobile_native',
  'agentic_workflow',
  'long_task',
  'privacy_safety',
]);
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

function safeDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : ZERO_SHA_256;
}

function nonZeroDigest(value) {
  return safeDigest(value) !== ZERO_SHA_256;
}

function digestIntentFrameProjection(cases, kind) {
  if (kind !== 'candidate' && kind !== 'gold') {
    throw new Error('Intent-frame projection kind must be candidate or gold.');
  }
  const projection = {
    schemaVersion: `intent-frame-${kind}-projection-v1`,
    cases: (Array.isArray(cases) ? [...cases] : [])
      .sort((left, right) => {
        const leftId = String(left?.id);
        const rightId = String(right?.id);
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      })
      .map((caseEntry) => ({
        id: caseEntry?.id,
        requestSha256: caseEntry?.requestSha256,
        language: caseEntry?.language,
        productArea: caseEntry?.productArea,
        [kind]: caseEntry?.[kind],
      })),
  };
  return digestCanonicalValue(projection);
}

function hasExclusiveNone(values) {
  return !Array.isArray(values) || !values.includes('none') || values.length === 1;
}

function validateInputSemantics(input) {
  const failures = [];
  const duplicateIds = new Set();
  const seenIds = new Set();
  let invalidNoneAtom = false;
  const cases = Array.isArray(input?.cases) ? input.cases : [];
  for (const [caseIndex, caseEntry] of cases.entries()) {
    if (seenIds.has(caseEntry?.id)) {
      duplicateIds.add(caseEntry?.id);
      failures.push(`input.cases[${caseIndex}].id: must be unique`);
    }
    seenIds.add(caseEntry?.id);
    for (const field of ATOM_FIELDS) {
      if (!hasExclusiveNone(caseEntry?.candidate?.[field])) {
        invalidNoneAtom = true;
        failures.push(`input.cases[${caseIndex}].candidate.${field}: none must be the only atom`);
      }
      const goldField = caseEntry?.gold?.[field];
      if (goldField?.status === 'scorable' && !hasExclusiveNone(goldField.values)) {
        invalidNoneAtom = true;
        failures.push(`input.cases[${caseIndex}].gold.${field}: none must be the only atom`);
      }
    }
  }
  return {
    duplicateCase: duplicateIds.size > 0,
    failures,
    invalidNoneAtom,
  };
}

function configurationValid(input) {
  const frozenAt = Date.parse(input?.frozenAt);
  const evaluator = input?.evaluator;
  return (
    Number.isFinite(frozenAt) &&
    input?.frozenAt !== '1970-01-01T00:00:00.000Z' &&
    evaluator?.kind === 'deterministic_structural' &&
    nonZeroDigest(evaluator?.implementationSha256) &&
    nonZeroDigest(evaluator?.rubricSha256) &&
    Number.isFinite(evaluator?.minimumScorableCoverage) &&
    evaluator.minimumScorableCoverage >= 0.5 &&
    evaluator.minimumScorableCoverage <= 1
  );
}

function candidateValues(frame, field) {
  if (ATOM_FIELDS.has(field)) return Array.isArray(frame?.[field]) ? frame[field] : [];
  return typeof frame?.[field] === 'string' ? [frame[field]] : [];
}

function goldValues(goldField, field) {
  if (ATOM_FIELDS.has(field)) return Array.isArray(goldField?.values) ? goldField.values : [];
  return typeof goldField?.value === 'string' ? [goldField.value] : [];
}

function confusionCounts(candidate, gold) {
  const candidateSet = new Set(candidate);
  const goldSet = new Set(gold);
  let truePositive = 0;
  for (const value of candidateSet) {
    if (goldSet.has(value)) truePositive += 1;
  }
  return {
    truePositive,
    falsePositive: candidateSet.size - truePositive,
    falseNegative: goldSet.size - truePositive,
  };
}

function canonicalRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function scoreField(cases, field) {
  const score = {
    field,
    scorable: 0,
    ambiguous: 0,
    unscorable: 0,
    coverageRate: cases.length > 0 ? 0 : null,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    precision: null,
    recall: null,
    f1: null,
  };
  for (const caseEntry of cases) {
    const goldField = caseEntry?.gold?.[field];
    if (goldField?.status === 'ambiguous') {
      score.ambiguous += 1;
      continue;
    }
    if (goldField?.status !== 'scorable') {
      score.unscorable += 1;
      continue;
    }
    score.scorable += 1;
    const counts = confusionCounts(
      candidateValues(caseEntry?.candidate, field),
      goldValues(goldField, field),
    );
    score.truePositive += counts.truePositive;
    score.falsePositive += counts.falsePositive;
    score.falseNegative += counts.falseNegative;
  }
  score.coverageRate = cases.length > 0 ? score.scorable / cases.length : null;
  if (score.scorable > 0) {
    score.precision = canonicalRate(score.truePositive, score.truePositive + score.falsePositive);
    score.recall = canonicalRate(score.truePositive, score.truePositive + score.falseNegative);
    score.f1 = canonicalRate(
      2 * score.truePositive,
      2 * score.truePositive + score.falsePositive + score.falseNegative,
    );
  }
  return score;
}

function coverageEntries(cases, field) {
  const counts = new Map();
  for (const caseEntry of cases) {
    let id;
    if (field === 'language') {
      id =
        typeof caseEntry?.language === 'string' && LANGUAGE_PATTERN.test(caseEntry.language)
          ? caseEntry.language
          : 'invalid';
    } else {
      id = PRODUCT_AREAS.has(caseEntry?.productArea) ? caseEntry.productArea : 'invalid';
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, caseCount]) => ({ id, caseCount }));
}

function reportEvaluator(evaluator) {
  const minimumScorableCoverage =
    Number.isFinite(evaluator?.minimumScorableCoverage) &&
    evaluator.minimumScorableCoverage >= 0.5 &&
    evaluator.minimumScorableCoverage <= 1
      ? evaluator.minimumScorableCoverage
      : 1;
  return {
    kind: 'deterministic_structural',
    implementationSha256: safeDigest(evaluator?.implementationSha256),
    rubricSha256: safeDigest(evaluator?.rubricSha256),
    minimumScorableCoverage,
  };
}

function aggregateIntentFrameEvaluation(input, options) {
  const schemaFailures = validateIntentFrameInput(input, options.schema);
  const semantic = validateInputSemantics(input);
  const contractFailures = [...schemaFailures, ...semantic.failures];
  const cases = Array.isArray(input?.cases) ? input.cases : [];
  const candidateDigest = digestIntentFrameProjection(cases, 'candidate');
  const goldDigest = digestIntentFrameProjection(cases, 'gold');
  const failures = new Set();
  if (contractFailures.length > 0) failures.add('invalid_contract');
  if (!configurationValid(input)) failures.add('invalid_configuration');
  if (candidateDigest !== input?.source?.candidateArtifactSha256) {
    failures.add('candidate_digest_mismatch');
  }
  if (goldDigest !== input?.source?.goldLabelsSha256) failures.add('gold_digest_mismatch');
  if (semantic.duplicateCase) failures.add('duplicate_case');
  if (semantic.invalidNoneAtom) failures.add('invalid_none_atom');

  const fields = INTENT_FRAME_FIELDS.map((field) => scoreField(cases, field));
  const evaluator = reportEvaluator(input?.evaluator);
  if (
    fields.some(
      (field) =>
        !Number.isFinite(field.coverageRate) ||
        field.coverageRate < evaluator.minimumScorableCoverage,
    )
  ) {
    failures.add('incomplete_field_coverage');
  }
  const eligibilityFailures = INTENT_FRAME_ELIGIBILITY_FAILURES.filter((failure) =>
    failures.has(failure),
  );
  const evidenceCounts = fields.reduce(
    (summary, field) => ({
      scorable: summary.scorable + field.scorable,
      ambiguous: summary.ambiguous + field.ambiguous,
      unscorable: summary.unscorable + field.unscorable,
    }),
    { scorable: 0, ambiguous: 0, unscorable: 0 },
  );
  const counts = {
    cases: cases.length,
    fieldLabels: cases.length * INTENT_FRAME_FIELDS.length,
    ...evidenceCounts,
  };
  const report = {
    $schema: INTENT_FRAME_SCHEMA_URL,
    kind: 'intent_frame_evaluation_report',
    schemaVersion: '1.0.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    inputSha256: safeDigest(options.inputSha256),
    evaluator,
    source: {
      candidateArtifactSha256: safeDigest(input?.source?.candidateArtifactSha256),
      goldLabelsSha256: safeDigest(input?.source?.goldLabelsSha256),
    },
    claimEligible: eligibilityFailures.length === 0,
    eligibilityFailures,
    counts,
    macroF1: mean(fields.filter((field) => field.f1 !== null).map((field) => field.f1)),
    fields,
    coverage: {
      languages: coverageEntries(cases, 'language'),
      productAreas: coverageEntries(cases, 'productArea'),
    },
    leakageControls: {
      closedCandidateFrame: true,
      rawRequestExcluded: true,
      executionEvidenceExcluded: true,
      finalAnswerExcluded: true,
      goldAppRuntimeAccess: false,
      candidateCapturePhase: 'pre_execution',
    },
  };
  return {
    contractFailures,
    report,
    reportFailures: validateIntentFrameReport(report, options.schema),
  };
}

function aggregatePrivateIntentFrameFile(projectRoot, requestedPath, options = {}) {
  const input = readPrivateJsonFile(projectRoot, requestedPath, 'intent-frame.input');
  return aggregateIntentFrameEvaluation(input.value, {
    generatedAt: options.generatedAt,
    inputSha256: input.sha256,
    schema: loadIntentFrameSchema(projectRoot),
  });
}

module.exports = {
  aggregateIntentFrameEvaluation,
  aggregatePrivateIntentFrameFile,
  digestIntentFrameProjection,
};
