const fs = require('fs');
const path = require('path');

const {
  CONTRACT_FILE,
  SCHEMA_FILE,
  loadEvaluationContract,
  loadEvaluationSchema,
  validateSchemaDefinition,
} = require('./evaluationContract');

const DEVELOPMENT_PACK_FILE = path.join('evaluation', 'klae-development.json');
const REQUIRED_MODE_TRANSITIONS = [
  'chitchat_to_chitchat',
  'chitchat_to_agentic',
  'agentic_to_chitchat',
  'agentic_to_agentic',
];
const ASSISTANT_PROSE_TARGET_SEGMENTS = new Set(['content', 'prose', 'regex', 'text']);

function addFailure(failures, location, message) {
  failures.push(`${location}: ${message}`);
}

function duplicateStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (typeof value !== 'string') return false;
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function validateUniqueIds(entries, location, failures) {
  if (!Array.isArray(entries)) return;
  if (duplicateStrings(entries.map((entry) => entry?.id)).length > 0) {
    addFailure(failures, location, 'must contain unique id values');
  }
}

function targetsAssistantProse(target) {
  return (
    typeof target === 'string' &&
    target.startsWith('turn.') &&
    target.split(/[._-]/u).some((segment) => ASSISTANT_PROSE_TARGET_SEGMENTS.has(segment))
  );
}

function validateCase(caseEntry, index, contract, failures) {
  const location = `pack.cases[${index}]`;
  const steps = Array.isArray(caseEntry?.steps) ? caseEntry.steps : [];
  const assertions = Array.isArray(caseEntry?.assertions) ? caseEntry.assertions : [];

  validateUniqueIds(caseEntry?.fixtures, `${location}.fixtures`, failures);
  validateUniqueIds(steps, `${location}.steps`, failures);
  validateUniqueIds(assertions, `${location}.assertions`, failures);

  for (const [stepIndex, step] of steps.entries()) {
    validateUniqueIds(step?.attachments, `${location}.steps[${stepIndex}].attachments`, failures);
    if (stepIndex === 0) continue;
    const priorTime = Date.parse(steps[stepIndex - 1]?.at);
    const currentTime = Date.parse(step?.at);
    if (Number.isFinite(priorTime) && Number.isFinite(currentTime) && currentTime <= priorTime) {
      addFailure(
        failures,
        `${location}.steps[${stepIndex}].at`,
        'must be later than the prior step',
      );
    }
  }

  const stepIds = new Set(steps.map((step) => step?.id));
  assertions.forEach((assertion, assertionIndex) => {
    if (!stepIds.has(assertion?.afterStepId)) {
      addFailure(
        failures,
        `${location}.assertions[${assertionIndex}].afterStepId`,
        'must reference a step in the same case',
      );
    }
    if (targetsAssistantProse(assertion?.target)) {
      addFailure(
        failures,
        `${location}.assertions[${assertionIndex}].target`,
        'must reference structured state, not assistant prose',
      );
    }
  });

  const registeredMetrics = new Set(contract?.metricIds ?? []);
  (caseEntry?.metricIds ?? []).forEach((metricId, metricIndex) => {
    if (!registeredMetrics.has(metricId)) {
      addFailure(
        failures,
        `${location}.metricIds[${metricIndex}]`,
        'must be registered by evaluation/contract.json',
      );
    }
  });
}

function validateEvaluationCasePack(pack, contract, schema) {
  const failures = validateSchemaDefinition(pack, schema, 'evaluationCasePack', 'pack');
  if (!Array.isArray(pack?.cases)) return failures;

  validateUniqueIds(pack.cases, 'pack.cases', failures);
  pack.cases.forEach((caseEntry, index) => validateCase(caseEntry, index, contract, failures));

  const coveredFamilies = new Set(pack.cases.flatMap((caseEntry) => caseEntry?.families ?? []));
  for (const family of schema?.$defs?.klaeFamily?.enum ?? []) {
    if (!coveredFamilies.has(family)) {
      addFailure(failures, 'pack.cases', `must include the representative family ${family}`);
    }
  }

  const coveredTransitions = new Set(
    pack.cases.flatMap((caseEntry) => caseEntry?.modeTransitions ?? []),
  );
  for (const transition of REQUIRED_MODE_TRANSITIONS) {
    if (!coveredTransitions.has(transition)) {
      addFailure(failures, 'pack.cases', `must include the mode transition ${transition}`);
    }
  }

  const controlKinds = new Set(pack.cases.map((caseEntry) => caseEntry?.controlKind));
  for (const controlKind of ['positive', 'negative', 'mixed']) {
    if (!controlKinds.has(controlKind)) {
      addFailure(failures, 'pack.cases', `must include a ${controlKind} control case`);
    }
  }

  return Array.from(new Set(failures));
}

function loadEvaluationCasePack(projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, DEVELOPMENT_PACK_FILE), 'utf8'));
}

function checkEvaluationCasePack(projectRoot) {
  let pack;
  let contract;
  let schema;
  try {
    pack = loadEvaluationCasePack(projectRoot);
  } catch (error) {
    return [`${DEVELOPMENT_PACK_FILE}: ${error instanceof Error ? error.message : String(error)}`];
  }
  try {
    contract = loadEvaluationContract(projectRoot);
  } catch (error) {
    return [`${CONTRACT_FILE}: ${error instanceof Error ? error.message : String(error)}`];
  }
  try {
    schema = loadEvaluationSchema(projectRoot);
  } catch (error) {
    return [`${SCHEMA_FILE}: ${error instanceof Error ? error.message : String(error)}`];
  }

  return validateEvaluationCasePack(pack, contract, schema);
}

module.exports = {
  DEVELOPMENT_PACK_FILE,
  checkEvaluationCasePack,
  loadEvaluationCasePack,
  validateCase,
  validateEvaluationCasePack,
};
