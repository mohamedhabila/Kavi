const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { readPrivateJsonFile } = require('./privateEvaluationFiles');

const JUDGE_CALIBRATION_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/judge-calibration.schema.json';
const JUDGE_CALIBRATION_SCHEMA_FILE = path.join('evaluation', 'judge-calibration.schema.json');
const MINIMUM_RESOLVED_EXAMPLES = 100;
const MINIMUM_RESOLVED_PER_FAMILY = 5;
const MINIMUM_CLASS_FRACTION = 0.2;
const DISAGREEMENT_FAILURE_THRESHOLD = 0.05;
const ZERO_SHA_256 = '0'.repeat(64);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadJudgeCalibrationSchema(projectRoot) {
  return readJson(path.join(projectRoot, JUDGE_CALIBRATION_SCHEMA_FILE));
}

function formatInstancePath(instancePath, root) {
  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce(
      (location, segment) =>
        /^[0-9]+$/u.test(segment) ? `${location}[${segment}]` : `${location}.${segment}`,
      root,
    );
}

function buildValidator(schema, definitionName) {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validator = ajv.getSchema(`${schema.$id}#/$defs/${definitionName}`);
  if (!validator) throw new Error(`Missing judge calibration definition: ${definitionName}`);
  return validator;
}

function validateCalibrationDefinition(value, schema, definitionName, root) {
  try {
    const validator = buildValidator(schema, definitionName);
    if (validator(value)) return [];
    return (validator.errors ?? []).map(
      (error) => `${formatInstancePath(error.instancePath, root)}: ${error.message}`,
    );
  } catch (error) {
    return [
      `calibrationSchema.$defs.${definitionName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function validateJudgeCalibrationInput(value, schema) {
  return validateCalibrationDefinition(value, schema, 'calibrationInput', 'input');
}

function validateJudgeCalibrationReport(value, schema) {
  return validateCalibrationDefinition(value, schema, 'calibrationReport', 'report');
}

function checkPublicJudgeCalibrationContract(projectRoot) {
  let schema;
  try {
    schema = loadJudgeCalibrationSchema(projectRoot);
  } catch (error) {
    return [
      `${JUDGE_CALIBRATION_SCHEMA_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const failures = [];
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push('calibrationSchema.$schema: must use JSON Schema draft 2020-12');
  }
  if (schema?.$id !== JUDGE_CALIBRATION_SCHEMA_URL) {
    failures.push(`calibrationSchema.$id: must be ${JUDGE_CALIBRATION_SCHEMA_URL}`);
  }
  for (const definitionName of ['calibrationInput', 'calibrationReport']) {
    if (!schema?.$defs?.[definitionName]) {
      failures.push(`calibrationSchema.$defs.${definitionName}: is required`);
    }
    if (!(schema?.oneOf ?? []).some((entry) => entry?.$ref === `#/$defs/${definitionName}`)) {
      failures.push(`calibrationSchema.oneOf: must include #/$defs/${definitionName}`);
    }
    try {
      buildValidator(schema, definitionName);
    } catch (error) {
      failures.push(
        `calibrationSchema.$defs.${definitionName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

function nonZeroDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) && value !== ZERO_SHA_256;
}

function safeDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : ZERO_SHA_256;
}

function validateConfiguration(input) {
  const evaluator = input?.evaluator;
  if (!evaluator || !['llm_judge', 'deterministic_structural'].includes(evaluator.kind)) {
    return false;
  }
  if (
    !Number.isFinite(Date.parse(input?.frozenAt)) ||
    input.frozenAt === '1970-01-01T00:00:00.000Z'
  ) {
    return false;
  }
  const digestFields =
    evaluator.kind === 'llm_judge'
      ? ['judgeConfigSha256', 'modelConfigSha256', 'promptSha256', 'rubricSha256']
      : ['implementationSha256', 'rubricSha256'];
  return digestFields.every((field) => nonZeroDigest(evaluator[field]));
}

function validateCustody(input) {
  if (input?.evaluator?.kind !== 'llm_judge') return true;
  const candidateIds = new Set([input?.candidate?.id, ...(input?.candidate?.maintainerIds ?? [])]);
  const custody = input?.custody;
  if (
    !custody ||
    candidateIds.has(custody.ownerId) ||
    candidateIds.has(custody.reviewerId) ||
    custody.ownerId === custody.reviewerId ||
    custody.candidateAccessDetected !== false ||
    custody.humanLabelsExposedBeforeJudgeFreeze !== false
  ) {
    return false;
  }
  const frozenAt = Date.parse(input.frozenAt);
  const predictionsFrozenAt = Date.parse(custody.judgePredictionsFrozenAt);
  const labelsReleasedAt = Date.parse(custody.humanLabelsReleasedAt);
  const reviewedAt = Date.parse(custody.accessReviewedAt);
  return (
    Number.isFinite(frozenAt) &&
    predictionsFrozenAt >= frozenAt &&
    labelsReleasedAt >= predictionsFrozenAt &&
    reviewedAt >= labelsReleasedAt
  );
}

function reportEvaluator(evaluator) {
  if (evaluator?.kind === 'deterministic_structural') {
    return {
      kind: 'deterministic_structural',
      implementationSha256: safeDigest(evaluator.implementationSha256),
      rubricSha256: safeDigest(evaluator.rubricSha256),
    };
  }
  return {
    kind: 'llm_judge',
    judgeConfigSha256: safeDigest(evaluator?.judgeConfigSha256),
    modelConfigSha256: safeDigest(evaluator?.modelConfigSha256),
    promptSha256: safeDigest(evaluator?.promptSha256),
    rubricSha256: safeDigest(evaluator?.rubricSha256),
  };
}

function evaluateJudgeCalibration(input, options) {
  const schemaFailures = validateJudgeCalibrationInput(input, options.schema);
  const semanticContractFailures = [];
  const examples = Array.isArray(input?.examples) ? input.examples : [];
  const requiredFamilies = Array.isArray(input?.requiredFamilies) ? input.requiredFamilies : [];
  const requiredFamilySet = new Set(requiredFamilies);
  const exampleIds = new Set();
  for (const [index, example] of examples.entries()) {
    if (exampleIds.has(example?.id)) {
      semanticContractFailures.push(`input.examples[${index}].id: must be unique`);
    }
    exampleIds.add(example?.id);
    if (!requiredFamilySet.has(example?.family)) {
      semanticContractFailures.push(
        `input.examples[${index}].family: must be declared by requiredFamilies`,
      );
    }
  }
  const contractFailures = [...schemaFailures, ...semanticContractFailures];
  const configurationValid = validateConfiguration(input);
  const custodyValid = validateCustody(input);
  const failures = new Set();
  if (contractFailures.length > 0) failures.add('invalid_contract');
  if (!configurationValid) failures.add('invalid_configuration');
  if (!custodyValid) failures.add('invalid_custody');

  const resolvedExamples = examples.filter(
    (example) => example?.humanLabel === 'pass' || example?.humanLabel === 'fail',
  );
  const humanPass = resolvedExamples.filter((example) => example.humanLabel === 'pass').length;
  const humanFail = resolvedExamples.filter((example) => example.humanLabel === 'fail').length;
  const humanAmbiguous = examples.filter((example) => example?.humanLabel === 'ambiguous').length;
  const judgeAmbiguousOnResolved = resolvedExamples.filter(
    (example) => example?.judgeLabel === 'ambiguous',
  ).length;
  const judgeBinaryMismatch = resolvedExamples.filter(
    (example) => example?.judgeLabel !== 'ambiguous' && example?.judgeLabel !== example?.humanLabel,
  ).length;
  const judgeBinaryAgreement =
    resolvedExamples.length - judgeAmbiguousOnResolved - judgeBinaryMismatch;
  const disagreementCount = judgeAmbiguousOnResolved + judgeBinaryMismatch;
  const disagreementRate =
    resolvedExamples.length > 0 ? disagreementCount / resolvedExamples.length : null;

  const coverage = requiredFamilies.map((family) => {
    const familyExamples = examples.filter((example) => example?.family === family);
    const resolvedHumanCount = familyExamples.filter(
      (example) => example?.humanLabel === 'pass' || example?.humanLabel === 'fail',
    ).length;
    return {
      family,
      resolvedHumanCount,
      humanAmbiguousCount: familyExamples.filter((example) => example?.humanLabel === 'ambiguous')
        .length,
      covered:
        input?.evaluator?.kind === 'deterministic_structural' ||
        resolvedHumanCount >= MINIMUM_RESOLVED_PER_FAMILY,
    };
  });

  const isDeterministic = input?.evaluator?.kind === 'deterministic_structural';
  if (!isDeterministic) {
    if (resolvedExamples.length < MINIMUM_RESOLVED_EXAMPLES) {
      failures.add('insufficient_resolved_examples');
    }
    if (humanPass === 0 || humanFail === 0) failures.add('missing_human_class');
    if (
      resolvedExamples.length > 0 &&
      Math.min(humanPass, humanFail) / resolvedExamples.length < MINIMUM_CLASS_FRACTION
    ) {
      failures.add('class_imbalance');
    }
    if (coverage.some((entry) => !entry.covered)) failures.add('incomplete_family_coverage');
    if (disagreementRate === null || disagreementRate >= DISAGREEMENT_FAILURE_THRESHOLD) {
      failures.add('judge_disagreement_threshold');
    }
  }

  const failureList = [...failures].sort();
  const claimEligible = failureList.length === 0;
  const report = {
    $schema: JUDGE_CALIBRATION_SCHEMA_URL,
    kind: 'judge_calibration_report',
    schemaVersion: '1.0.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    inputSha256: safeDigest(options.inputSha256),
    evaluator: reportEvaluator(input?.evaluator),
    custodyValid,
    coverage:
      coverage.length > 0
        ? coverage
        : [{ family: 'invalid', resolvedHumanCount: 0, humanAmbiguousCount: 0, covered: false }],
    counts: {
      total: examples.length,
      resolvedHuman: resolvedExamples.length,
      humanAmbiguous,
      humanPass,
      humanFail,
      judgeBinaryAgreement,
      judgeBinaryMismatch,
      judgeAmbiguousOnResolved,
    },
    disagreement: {
      count: disagreementCount,
      rate: disagreementRate,
      failureThreshold: DISAGREEMENT_FAILURE_THRESHOLD,
    },
    status: isDeterministic && claimEligible ? 'not_required' : claimEligible ? 'passed' : 'failed',
    claimEligible,
    failures: failureList,
  };
  const reportFailures = validateJudgeCalibrationReport(report, options.schema);
  return {
    contractFailures,
    report,
    reportFailures,
  };
}

function evaluatePrivateJudgeCalibrationFile(projectRoot, inputPath, options = {}) {
  const schema = loadJudgeCalibrationSchema(projectRoot);
  const inputFile = readPrivateJsonFile(projectRoot, inputPath, 'calibration.input');
  return evaluateJudgeCalibration(inputFile.value, {
    generatedAt: options.generatedAt,
    inputSha256: inputFile.sha256,
    schema,
  });
}

module.exports = {
  DISAGREEMENT_FAILURE_THRESHOLD,
  JUDGE_CALIBRATION_SCHEMA_FILE,
  JUDGE_CALIBRATION_SCHEMA_URL,
  MINIMUM_CLASS_FRACTION,
  MINIMUM_RESOLVED_EXAMPLES,
  MINIMUM_RESOLVED_PER_FAMILY,
  checkPublicJudgeCalibrationContract,
  evaluateJudgeCalibration,
  evaluatePrivateJudgeCalibrationFile,
  loadJudgeCalibrationSchema,
  validateJudgeCalibrationInput,
  validateJudgeCalibrationReport,
};
