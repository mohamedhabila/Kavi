const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { loadEvaluationSchema } = require('./evaluationContract');

const PRIVATE_GOVERNANCE_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/klae-private-governance.schema.json';
const PRIVATE_GOVERNANCE_SCHEMA_FILE = path.join(
  'evaluation',
  'klae-private-governance.schema.json',
);
const PRIVATE_REGISTRY_TEMPLATE_FILE = path.join(
  'evaluation',
  'klae-private-registry.template.json',
);
const PRIVATE_SPLIT_RULES = Object.freeze({
  development: Object.freeze({
    caseCount: 40,
    packId: 'klae-development-private-v1',
    accessPolicy: 'visible_development',
  }),
  locked_validation: Object.freeze({
    caseCount: 40,
    packId: 'klae-locked-validation-v1',
    accessPolicy: 'results_only',
  }),
  sealed_held_out: Object.freeze({
    minimumCaseCount: 100,
    packId: 'klae-sealed-held-out-v1',
    accessPolicy: 'prohibited',
  }),
});
const ZERO_SHA_256 = '0'.repeat(64);
const ZERO_GIT_COMMIT = '0'.repeat(40);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function formatAjvErrors(errors, root) {
  return (errors ?? []).map(
    (error) => `${formatInstancePath(error.instancePath, root)}: ${error.message}`,
  );
}

function loadPrivateGovernanceSchema(projectRoot) {
  return readJson(path.join(projectRoot, PRIVATE_GOVERNANCE_SCHEMA_FILE));
}

function loadPrivateRegistryTemplate(projectRoot) {
  return readJson(path.join(projectRoot, PRIVATE_REGISTRY_TEMPLATE_FILE));
}

function buildPrivateGovernanceValidator(evaluationSchema, governanceSchema, definitionName) {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  ajv.addSchema(evaluationSchema);
  ajv.addSchema(governanceSchema);
  const validator = ajv.getSchema(`${governanceSchema.$id}#/$defs/${definitionName}`);
  if (!validator) {
    throw new Error(`Missing KLAE governance definition: ${definitionName}`);
  }
  return validator;
}

function validateGovernanceDefinition(
  value,
  evaluationSchema,
  governanceSchema,
  definitionName,
  root,
) {
  try {
    const validator = buildPrivateGovernanceValidator(
      evaluationSchema,
      governanceSchema,
      definitionName,
    );
    return validator(value) ? [] : formatAjvErrors(validator.errors, root);
  } catch (error) {
    return [
      `governance.$defs.${definitionName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function validatePrivateRegistry(registry, evaluationSchema, governanceSchema) {
  return validateGovernanceDefinition(
    registry,
    evaluationSchema,
    governanceSchema,
    'privateRegistry',
    'registry',
  );
}

function validatePrivateCasePack(pack, evaluationSchema, governanceSchema) {
  return validateGovernanceDefinition(
    pack,
    evaluationSchema,
    governanceSchema,
    'privateCasePack',
    'pack',
  );
}

function validateGovernanceSchemaShape(schema) {
  const failures = [];
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push('governance.$schema: must use JSON Schema draft 2020-12');
  }
  if (schema?.$id !== PRIVATE_GOVERNANCE_SCHEMA_URL) {
    failures.push(`governance.$id: must be ${PRIVATE_GOVERNANCE_SCHEMA_URL}`);
  }
  for (const definitionName of ['privateRegistry', 'privateCasePack']) {
    if (!schema?.$defs?.[definitionName]) {
      failures.push(`governance.$defs.${definitionName}: is required`);
    }
    if (!(schema?.oneOf ?? []).some((entry) => entry?.$ref === `#/$defs/${definitionName}`)) {
      failures.push(`governance.oneOf: must include #/$defs/${definitionName}`);
    }
  }
  return failures;
}

function validatePublicRegistryTemplate(template, evaluationSchema, governanceSchema) {
  const failures = validatePrivateRegistry(template, evaluationSchema, governanceSchema);
  if (template?.registryState !== 'template') {
    failures.push('template.registryState: must be template');
  }
  if (template?.frozenBaseline?.appCommitSha !== ZERO_GIT_COMMIT) {
    failures.push('template.frozenBaseline.appCommitSha: must be the zero placeholder');
  }
  for (const field of ['configurationSha256', 'promptSha256']) {
    if (template?.frozenBaseline?.[field] !== ZERO_SHA_256) {
      failures.push(`template.frozenBaseline.${field}: must be the zero placeholder`);
    }
  }

  const descriptors = Array.isArray(template?.splits) ? template.splits : [];
  const byKind = new Map(descriptors.map((descriptor) => [descriptor?.splitKind, descriptor]));
  if (byKind.size !== Object.keys(PRIVATE_SPLIT_RULES).length) {
    failures.push('template.splits: must contain each private split exactly once');
  }
  for (const [splitKind, rule] of Object.entries(PRIVATE_SPLIT_RULES)) {
    const descriptor = byKind.get(splitKind);
    if (!descriptor) {
      failures.push(`template.splits: missing ${splitKind}`);
      continue;
    }
    if (descriptor.packId !== rule.packId) {
      failures.push(`template.splits.${splitKind}.packId: must be ${rule.packId}`);
    }
    const expectedCount = rule.caseCount ?? rule.minimumCaseCount;
    if (descriptor.caseCount !== expectedCount) {
      failures.push(`template.splits.${splitKind}.caseCount: must be ${expectedCount}`);
    }
    if (descriptor.candidateAccessPolicy !== rule.accessPolicy) {
      failures.push(
        `template.splits.${splitKind}.candidateAccessPolicy: must be ${rule.accessPolicy}`,
      );
    }
    if (descriptor.sha256 !== ZERO_SHA_256) {
      failures.push(`template.splits.${splitKind}.sha256: must be the zero placeholder`);
    }
  }
  return Array.from(new Set(failures));
}

function checkPublicKlaeGovernance(projectRoot) {
  let evaluationSchema;
  let governanceSchema;
  let template;
  try {
    evaluationSchema = loadEvaluationSchema(projectRoot);
    governanceSchema = loadPrivateGovernanceSchema(projectRoot);
    template = loadPrivateRegistryTemplate(projectRoot);
  } catch (error) {
    return [
      `KLAE public governance artifacts: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  return [
    ...validateGovernanceSchemaShape(governanceSchema),
    ...validatePublicRegistryTemplate(template, evaluationSchema, governanceSchema),
  ];
}

module.exports = {
  PRIVATE_GOVERNANCE_SCHEMA_FILE,
  PRIVATE_GOVERNANCE_SCHEMA_URL,
  PRIVATE_REGISTRY_TEMPLATE_FILE,
  PRIVATE_SPLIT_RULES,
  ZERO_GIT_COMMIT,
  ZERO_SHA_256,
  checkPublicKlaeGovernance,
  loadPrivateGovernanceSchema,
  loadPrivateRegistryTemplate,
  validatePrivateCasePack,
  validatePrivateRegistry,
  validatePublicRegistryTemplate,
};
