const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { loadEvaluationContract, loadEvaluationSchema } = require('./evaluationContract');
const { validatePrivatePackCoverage } = require('./klaePrivateCoverage');
const { readPrivateJsonFile } = require('./privateEvaluationFiles');

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
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

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

function validateExpectedReleaseIdentity(expected) {
  const failures = [];
  for (const field of ['candidateId', 'baselineId']) {
    if (!SAFE_ID_PATTERN.test(expected?.[field] ?? '')) {
      failures.push(`release.${field}: must be a canonical non-empty id`);
    }
  }
  if (!GIT_COMMIT_PATTERN.test(expected?.appCommitSha ?? '')) {
    failures.push('release.appCommitSha: must be a 40-character lowercase commit SHA');
  }
  for (const field of ['registrySha256', 'configurationSha256', 'promptSha256']) {
    if (!SHA_256_PATTERN.test(expected?.[field] ?? '') || expected?.[field] === ZERO_SHA_256) {
      failures.push(`release.${field}: must be a non-zero lowercase SHA-256 digest`);
    }
  }
  return failures;
}

function validateReleaseCheckout(projectRoot, expectedAppCommitSha) {
  try {
    const head = childProcess
      .execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();
    if (head !== expectedAppCommitSha) {
      return ['release.appCommitSha: must equal the current Kavi Git HEAD'];
    }
    const status = childProcess
      .execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();
    return status.length === 0 ? [] : ['release.checkout: Kavi worktree must be clean'];
  } catch {
    return ['release.checkout: unable to verify the Kavi Git checkout'];
  }
}

function validateFrozenIdentity(registry, expected, failures) {
  const comparisons = [
    ['candidate.id', registry?.candidate?.id, expected.candidateId],
    ['frozenBaseline.id', registry?.frozenBaseline?.id, expected.baselineId],
    ['frozenBaseline.appCommitSha', registry?.frozenBaseline?.appCommitSha, expected.appCommitSha],
    [
      'frozenBaseline.configurationSha256',
      registry?.frozenBaseline?.configurationSha256,
      expected.configurationSha256,
    ],
    ['frozenBaseline.promptSha256', registry?.frozenBaseline?.promptSha256, expected.promptSha256],
  ];
  for (const [location, actual, expectedValue] of comparisons) {
    if (actual !== expectedValue) {
      failures.push(`registry.${location}: does not match the explicit frozen release identity`);
    }
  }
}

function containsTemplatePlaceholder(value) {
  if (typeof value === 'string') {
    return value.startsWith('replace-with-') || value === ZERO_SHA_256 || value === ZERO_GIT_COMMIT;
  }
  if (Array.isArray(value)) return value.some(containsTemplatePlaceholder);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsTemplatePlaceholder);
  }
  return false;
}

function validatePrivateRegistryReleasePolicy(registry, expected) {
  const failures = [];
  if (registry?.registryState !== 'frozen') {
    failures.push('registry.registryState: must be frozen for release validation');
  }
  if (containsTemplatePlaceholder(registry)) {
    failures.push('registry: must not contain template identifiers or zero digests');
  }
  if (registry?.frozenBaseline?.frozenAt === '1970-01-01T00:00:00.000Z') {
    failures.push('registry.frozenBaseline.frozenAt: must not use the template timestamp');
  }
  if (registry?.contamination?.status !== 'clean') {
    failures.push('registry.contamination.status: invalidated registries cannot produce a release');
  }
  validateFrozenIdentity(registry, expected, failures);

  const candidateCustodyIds = new Set([
    registry?.candidate?.id,
    ...(registry?.candidate?.maintainerIds ?? []),
  ]);
  if (candidateCustodyIds.has(registry?.registryOwnerId)) {
    failures.push('registry.registryOwnerId: must be independent from the candidate');
  }
  const descriptors = Array.isArray(registry?.splits) ? registry.splits : [];
  const byKind = new Map();
  const paths = new Set();
  const digests = new Set();
  for (const descriptor of descriptors) {
    if (byKind.has(descriptor?.splitKind)) {
      failures.push(`registry.splits: contains duplicate ${descriptor.splitKind}`);
    }
    byKind.set(descriptor?.splitKind, descriptor);
    if (paths.has(descriptor?.packPath)) {
      failures.push('registry.splits: pack paths must be unique');
    }
    paths.add(descriptor?.packPath);
    if (digests.has(descriptor?.sha256)) {
      failures.push('registry.splits: pack digests must be unique');
    }
    digests.add(descriptor?.sha256);
  }

  for (const [splitKind, rule] of Object.entries(PRIVATE_SPLIT_RULES)) {
    const descriptor = byKind.get(splitKind);
    if (!descriptor) {
      failures.push(`registry.splits: missing ${splitKind}`);
      continue;
    }
    if (descriptor.packId !== rule.packId) {
      failures.push(`registry.splits.${splitKind}.packId: must be ${rule.packId}`);
    }
    if (descriptor.candidateAccessPolicy !== rule.accessPolicy) {
      failures.push(
        `registry.splits.${splitKind}.candidateAccessPolicy: must be ${rule.accessPolicy}`,
      );
    }
    if (rule.caseCount && descriptor.caseCount !== rule.caseCount) {
      failures.push(`registry.splits.${splitKind}.caseCount: must be ${rule.caseCount}`);
    }
    if (rule.minimumCaseCount && descriptor.caseCount < rule.minimumCaseCount) {
      failures.push(
        `registry.splits.${splitKind}.caseCount: must be at least ${rule.minimumCaseCount}`,
      );
    }
    if (descriptor.baselineId !== registry?.frozenBaseline?.id) {
      failures.push(`registry.splits.${splitKind}.baselineId: must match the frozen baseline`);
    }
    if (
      splitKind !== 'development' &&
      descriptor?.accessReview?.candidatePackAccessDetected !== false
    ) {
      failures.push(
        `registry.splits.${splitKind}.accessReview: candidate access invalidates release eligibility`,
      );
    }
    if (splitKind !== 'development' && candidateCustodyIds.has(descriptor?.custodyOwnerId)) {
      failures.push(
        `registry.splits.${splitKind}.custodyOwnerId: must be independent from the candidate`,
      );
    }
    if (
      splitKind !== 'development' &&
      candidateCustodyIds.has(descriptor?.accessReview?.reviewerId)
    ) {
      failures.push(
        `registry.splits.${splitKind}.accessReview.reviewerId: must be independent from the candidate`,
      );
    }
    if (
      Date.parse(descriptor?.accessReview?.reviewedAt) <
      Date.parse(registry?.frozenBaseline?.frozenAt)
    ) {
      failures.push(
        `registry.splits.${splitKind}.accessReview.reviewedAt: must not predate the frozen baseline`,
      );
    }
  }

  const heldOut = byKind.get('sealed_held_out');
  const otherOwners = descriptors
    .filter((descriptor) => descriptor?.splitKind !== 'sealed_held_out')
    .map((descriptor) => descriptor?.custodyOwnerId);
  if (
    heldOut &&
    (heldOut.custodyOwnerId === registry?.registryOwnerId ||
      candidateCustodyIds.has(heldOut.custodyOwnerId) ||
      otherOwners.includes(heldOut.custodyOwnerId))
  ) {
    failures.push(
      'registry.splits.sealed_held_out.custodyOwnerId: must be separate from registry, candidate, and other split custody',
    );
  }
  return Array.from(new Set(failures));
}

function validateLoadedPack(pack, descriptor, contract, evaluationSchema, governanceSchema) {
  const failures = [
    ...validatePrivateCasePack(pack, evaluationSchema, governanceSchema),
    ...validatePrivatePackCoverage(pack, contract, evaluationSchema),
  ];
  if (pack?.id !== descriptor?.packId) {
    failures.push('pack.id: must match its registry descriptor');
  }
  if (pack?.splitKind !== descriptor?.splitKind) {
    failures.push('pack.splitKind: must match its registry descriptor');
  }
  if (pack?.baselineId !== descriptor?.baselineId) {
    failures.push('pack.baselineId: must match its registry descriptor');
  }
  if (Array.isArray(pack?.cases) && pack.cases.length !== descriptor?.caseCount) {
    failures.push('pack.cases: count must match its registry descriptor');
  }
  return Array.from(new Set(failures));
}

function validatePrivateKlaeRelease(options) {
  const failures = validateExpectedReleaseIdentity(options?.expected);
  if (failures.length > 0) return failures;
  const { projectRoot } = options;
  failures.push(...validateReleaseCheckout(projectRoot, options.expected.appCommitSha));
  let evaluationSchema;
  let governanceSchema;
  let contract;
  let registryFile;
  try {
    evaluationSchema = loadEvaluationSchema(projectRoot);
    governanceSchema = loadPrivateGovernanceSchema(projectRoot);
    contract = loadEvaluationContract(projectRoot);
    registryFile = readPrivateJsonFile(projectRoot, options.registryPath, 'release.registry');
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  if (registryFile.sha256 !== options.expected.registrySha256) {
    failures.push('release.registrySha256: does not match the immutable registry bytes');
  }
  const registry = registryFile.value;
  failures.push(
    ...validatePrivateRegistry(registry, evaluationSchema, governanceSchema),
    ...validatePrivateRegistryReleasePolicy(registry, options.expected),
  );

  const globalCaseIds = new Set();
  for (const descriptor of registry?.splits ?? []) {
    let packFile;
    try {
      packFile = readPrivateJsonFile(
        projectRoot,
        descriptor?.packPath,
        `release.${descriptor?.splitKind ?? 'unknown'}Pack`,
        path.dirname(registryFile.resolvedPath),
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (packFile.sha256 !== descriptor?.sha256) {
      failures.push(
        `registry.splits.${descriptor?.splitKind}.sha256: does not match the immutable pack bytes`,
      );
    }
    const packFailures = validateLoadedPack(
      packFile.value,
      descriptor,
      contract,
      evaluationSchema,
      governanceSchema,
    );
    failures.push(...packFailures.map((failure) => `${descriptor?.splitKind}.${failure}`));
    for (const caseEntry of packFile.value?.cases ?? []) {
      if (globalCaseIds.has(caseEntry?.id)) {
        failures.push(`release.caseIds: duplicate private case id ${caseEntry.id}`);
      }
      globalCaseIds.add(caseEntry?.id);
    }
  }
  return Array.from(new Set(failures));
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
  validatePrivateKlaeRelease,
  validatePrivateRegistry,
  validatePrivateRegistryReleasePolicy,
  validateReleaseCheckout,
  validatePublicRegistryTemplate,
};
