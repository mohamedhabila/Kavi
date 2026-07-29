const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const EVALUATION_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/schema.json';
const CONTRACT_FILE = path.join('evaluation', 'contract.json');
const SCHEMA_FILE = path.join('evaluation', 'schema.json');

const CONTRACT_KEYS = [
  '$schema',
  'kind',
  'schemaVersion',
  'artifactVersions',
  'lanes',
  'protocolConformance',
  'verificationLabels',
  'splitKinds',
  'runStatuses',
  'pricingStatuses',
  'failureCategories',
  'metricIds',
  'claimRules',
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addFailure(failures, location, message) {
  failures.push(`${location}: ${message}`);
}

function validateExactKeys(value, expectedKeys, location, failures) {
  if (!isRecord(value)) {
    addFailure(failures, location, 'must be an object');
    return false;
  }

  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addFailure(failures, `${location}.${key}`, 'is required');
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      addFailure(failures, `${location}.${key}`, 'is not allowed');
    }
  }
  return true;
}

function validateString(value, location, failures, options = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    addFailure(failures, location, 'must be a non-empty string');
    return false;
  }
  if (options.pattern && !options.pattern.test(value)) {
    addFailure(failures, location, `does not match ${options.pattern}`);
    return false;
  }
  return true;
}

function validateNonNegativeInteger(value, location, failures) {
  if (!Number.isInteger(value) || value < 0) {
    addFailure(failures, location, 'must be a non-negative integer');
    return false;
  }
  return true;
}

function validateEnum(value, allowed, location, failures) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    addFailure(failures, location, `must be one of: ${allowed.join(', ')}`);
    return false;
  }
  return true;
}

function validateCanonicalArray(value, expected, location, failures) {
  if (!Array.isArray(value)) {
    addFailure(failures, location, 'must be an array');
    return;
  }
  if (new Set(value).size !== value.length) {
    addFailure(failures, location, 'must not contain duplicates');
  }
  if (value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) {
    addFailure(failures, location, 'must exactly match the ordered enum in evaluation/schema.json');
  }
}

function schemaEnum(schema, definitionName) {
  const value = schema?.$defs?.[definitionName]?.enum;
  return Array.isArray(value) ? value : [];
}

const schemaValidatorCache = new WeakMap();

function formatInstancePath(instancePath, root) {
  const segments = instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  return segments.reduce(
    (location, segment) =>
      /^[0-9]+$/u.test(segment) ? `${location}[${segment}]` : `${location}.${segment}`,
    root,
  );
}

function getSchemaValidator(schema, definitionName) {
  let validators = schemaValidatorCache.get(schema);
  if (!validators) {
    validators = new Map();
    schemaValidatorCache.set(schema, validators);
  }
  const cached = validators.get(definitionName);
  if (cached) return cached;

  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validator = ajv.getSchema(`${schema.$id}#/$defs/${definitionName}`);
  if (!validator) {
    throw new Error(`Missing JSON Schema definition: ${definitionName}`);
  }
  validators.set(definitionName, validator);
  return validator;
}

function validateSchemaDefinition(value, schema, definitionName, root) {
  try {
    const validator = getSchemaValidator(schema, definitionName);
    if (validator(value)) return [];
    return (validator.errors ?? []).map(
      (error) => `${formatInstancePath(error.instancePath, root)}: ${error.message}`,
    );
  } catch (error) {
    return [
      `schema.$defs.${definitionName}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

function validateSchemaShape(schema, failures) {
  if (!isRecord(schema)) {
    addFailure(failures, 'schema', 'must be an object');
    return;
  }
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    addFailure(failures, 'schema.$schema', 'must use JSON Schema draft 2020-12');
  }
  if (schema.$id !== EVALUATION_SCHEMA_URL) {
    addFailure(failures, 'schema.$id', `must be ${EVALUATION_SCHEMA_URL}`);
  }
  const refs = Array.isArray(schema.oneOf)
    ? schema.oneOf.map((entry) => entry?.$ref).filter(Boolean)
    : [];
  for (const requiredRef of [
    '#/$defs/evaluationContract',
    '#/$defs/evaluationRun',
    '#/$defs/evaluationCasePack',
  ]) {
    if (!refs.includes(requiredRef)) {
      addFailure(failures, 'schema.oneOf', `must include ${requiredRef}`);
    }
  }
  if (!isRecord(schema.$defs?.evaluationContract)) {
    addFailure(failures, 'schema.$defs.evaluationContract', 'is required');
  }
  if (!isRecord(schema.$defs?.evaluationRun)) {
    addFailure(failures, 'schema.$defs.evaluationRun', 'is required');
  }
  if (!isRecord(schema.$defs?.evaluationCasePack)) {
    addFailure(failures, 'schema.$defs.evaluationCasePack', 'is required');
  }
}

function validateEvaluationContract(contract, schema) {
  const failures = [];
  validateSchemaShape(schema, failures);
  failures.push(...validateSchemaDefinition(contract, schema, 'evaluationContract', 'contract'));
  if (!validateExactKeys(contract, CONTRACT_KEYS, 'contract', failures)) {
    return failures;
  }

  if (contract.$schema !== EVALUATION_SCHEMA_URL) {
    addFailure(failures, 'contract.$schema', `must be ${EVALUATION_SCHEMA_URL}`);
  }
  if (contract.kind !== 'evaluation_contract') {
    addFailure(failures, 'contract.kind', 'must be evaluation_contract');
  }

  const contractVersion = schema?.$defs?.evaluationContract?.properties?.schemaVersion?.const;
  if (contract.schemaVersion !== contractVersion) {
    addFailure(failures, 'contract.schemaVersion', `must be ${contractVersion}`);
  }

  validateExactKeys(
    contract.artifactVersions,
    ['contract', 'runManifest', 'casePack'],
    'contract.artifactVersions',
    failures,
  );
  if (contract.artifactVersions?.contract !== contractVersion) {
    addFailure(failures, 'contract.artifactVersions.contract', `must be ${contractVersion}`);
  }
  const runVersion = schema?.$defs?.evaluationRun?.properties?.schemaVersion?.const;
  if (contract.artifactVersions?.runManifest !== runVersion) {
    addFailure(failures, 'contract.artifactVersions.runManifest', `must be ${runVersion}`);
  }
  const casePackVersion = schema?.$defs?.evaluationCasePack?.properties?.schemaVersion?.const;
  if (contract.artifactVersions?.casePack !== casePackVersion) {
    addFailure(failures, 'contract.artifactVersions.casePack', `must be ${casePackVersion}`);
  }

  const enumFields = [
    ['lanes', 'lane'],
    ['protocolConformance', 'protocolConformance'],
    ['verificationLabels', 'verificationLabel'],
    ['splitKinds', 'splitKind'],
    ['runStatuses', 'runStatus'],
    ['pricingStatuses', 'pricingStatus'],
    ['failureCategories', 'failureCategory'],
    ['metricIds', 'metricId'],
  ];
  for (const [contractField, definitionName] of enumFields) {
    const expected = schemaEnum(schema, definitionName);
    if (expected.length === 0) {
      addFailure(failures, `schema.$defs.${definitionName}.enum`, 'must be a non-empty array');
      continue;
    }
    validateCanonicalArray(
      contract[contractField],
      expected,
      `contract.${contractField}`,
      failures,
    );
  }

  const claimSchema = schema?.$defs?.claimRules;
  const claimKeys = Array.isArray(claimSchema?.required) ? claimSchema.required : [];
  validateExactKeys(contract.claimRules, claimKeys, 'contract.claimRules', failures);
  for (const claimKey of claimKeys) {
    const expected = claimSchema?.properties?.[claimKey]?.const;
    if (contract.claimRules?.[claimKey] !== expected) {
      addFailure(failures, `contract.claimRules.${claimKey}`, `must be ${String(expected)}`);
    }
  }

  return failures;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEvaluationContract(projectRoot) {
  return readJson(path.join(projectRoot, CONTRACT_FILE));
}

function loadEvaluationSchema(projectRoot) {
  return readJson(path.join(projectRoot, SCHEMA_FILE));
}

function checkEvaluationContract(projectRoot) {
  let contract;
  let schema;
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
  return validateEvaluationContract(contract, schema);
}

module.exports = {
  CONTRACT_FILE,
  EVALUATION_SCHEMA_URL,
  SCHEMA_FILE,
  addFailure,
  checkEvaluationContract,
  isRecord,
  loadEvaluationContract,
  loadEvaluationSchema,
  validateEnum,
  validateEvaluationContract,
  validateExactKeys,
  validateNonNegativeInteger,
  validateString,
  validateSchemaDefinition,
};
