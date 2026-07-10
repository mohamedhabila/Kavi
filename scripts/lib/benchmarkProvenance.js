const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const BENCHMARK_PROVENANCE_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/benchmark-provenance.schema.json';
const BENCHMARK_PROVENANCE_SCHEMA_FILE = path.join(
  'evaluation',
  'benchmark-provenance.schema.json',
);
const BENCHMARK_PROVENANCE_FILE = path.join('evaluation', 'benchmark-provenance.json');
const ENABLED_BENCHMARK_IDS = Object.freeze(['longmemeval-v2', 'state-bench-agent-learning']);
const OPENAI_SERVICE_TERMS_URL = 'https://openai.com/policies/service-terms/';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadBenchmarkProvenanceSchema(projectRoot) {
  return readJson(path.join(projectRoot, BENCHMARK_PROVENANCE_SCHEMA_FILE));
}

function loadBenchmarkProvenance(projectRoot) {
  return readJson(path.join(projectRoot, BENCHMARK_PROVENANCE_FILE));
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

function validateSchema(value, schema) {
  try {
    const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
    addFormats(ajv);
    const validator = ajv.compile(schema);
    if (validator(value)) return [];
    return (validator.errors ?? []).map(
      (error) => `${formatInstancePath(error.instancePath, 'provenance')}: ${error.message}`,
    );
  } catch (error) {
    return [`benchmarkProvenanceSchema: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function collectFiles(projectRoot, relativeRoot) {
  const absoluteRoot = path.resolve(projectRoot, relativeRoot);
  const relativeToProject = path.relative(projectRoot, absoluteRoot);
  if (
    relativeToProject.startsWith(`..${path.sep}`) ||
    relativeToProject === '..' ||
    path.isAbsolute(relativeToProject)
  ) {
    throw new Error(`adapter root escapes the project: ${relativeRoot}`);
  }
  const rootStat = fs.lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`adapter root must be a real directory: ${relativeRoot}`);
  }
  const output = childProcess.execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', relativeToProject],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  const files = output
    .split('\0')
    .filter(Boolean)
    .map((relativePath) => path.resolve(projectRoot, relativePath))
    .filter(
      (absolutePath) =>
        absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}${path.sep}`),
    )
    .sort((left, right) => left.localeCompare(right));
  for (const absolutePath of files) {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`adapter source must contain only real files: ${absolutePath}`);
    }
  }
  if (files.length === 0) throw new Error(`adapter root is empty: ${relativeRoot}`);
  return files;
}

function hashAdapterRoots(projectRoot, roots) {
  const files = roots
    .flatMap((root) => collectFiles(projectRoot, root))
    .sort((left, right) => left.localeCompare(right));
  const uniqueFiles = new Set(files);
  if (uniqueFiles.size !== files.length) {
    throw new Error('adapter roots overlap');
  }
  const digest = crypto.createHash('sha256');
  for (const absolutePath of files) {
    const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join('/');
    digest.update(relativePath, 'utf8');
    digest.update(Buffer.from([0]));
    digest.update(fs.readFileSync(absolutePath));
    digest.update(Buffer.from([0]));
  }
  return digest.digest('hex');
}

function isSortedUnique(values) {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0)
  );
}

function walkStrings(value, location, visitor) {
  if (typeof value === 'string') {
    visitor(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${location}[${index}]`, visitor));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      walkStrings(entry, `${location}.${key}`, visitor);
    }
  }
}

function validateSourceEvidence(projectRoot, adapter, failures) {
  const evidence =
    adapter.id === 'longmemeval-v2'
      ? {
          path: path.join('benchmarks', 'longmemeval_v2', 'run_kavi_isolated.py'),
          values: [
            adapter.upstream.commitSha,
            adapter.data.revision,
            ...adapter.data.integrity.map((entry) => entry.sha256),
          ],
        }
      : adapter.id === 'state-bench-agent-learning'
        ? {
            path: path.join('benchmarks', 'state_bench', 'stateBenchTrainingArtifact.ts'),
            values: [
              adapter.upstream.releaseTag,
              adapter.upstream.commitSha,
              ...adapter.data.integrity.map((entry) => entry.sha256),
            ],
          }
        : null;
  if (!evidence) return;
  const source = fs.readFileSync(path.join(projectRoot, evidence.path), 'utf8');
  for (const value of evidence.values.filter(Boolean)) {
    if (!source.includes(value)) {
      failures.push(`${adapter.id}: ${evidence.path} does not enforce provenance value ${value}`);
    }
  }
}

function validateAdapter(adapter, index, projectRoot, failures) {
  const location = `provenance.adapters[${index}]`;
  for (const [field, values] of [
    ['capabilityClaims', adapter.capabilityClaims],
    ['adapter.roots', adapter.adapter?.roots],
    ['upstream.allowedInstalledChanges', adapter.upstream?.allowedInstalledChanges],
    ['data.integrity', adapter.data?.integrity?.map((entry) => entry.id)],
    [
      'dependencyReproducibility.files',
      adapter.dependencyReproducibility?.files?.map((entry) => entry.path),
    ],
    ['runRequirements', adapter.runRequirements],
  ]) {
    if (Array.isArray(values) && !isSortedUnique(values)) {
      failures.push(`${location}.${field}: must be unique and sorted`);
    }
  }

  if (!adapter.upstream?.immutableSourceUrl?.includes(adapter.upstream?.commitSha)) {
    failures.push(`${location}.upstream.immutableSourceUrl: must contain the pinned commit`);
  }
  if (!adapter.licenses?.code?.sourceUrl?.includes(adapter.upstream?.commitSha)) {
    failures.push(`${location}.licenses.code.sourceUrl: must identify the pinned commit`);
  }
  if (!adapter.data?.sourceUrl?.includes(adapter.data?.revision)) {
    failures.push(`${location}.data.sourceUrl: must identify the pinned data revision`);
  }

  const roles = adapter.models?.map((model) => model.role) ?? [];
  if (!isSortedUnique(roles)) failures.push(`${location}.models: roles must be unique and sorted`);
  for (const [modelIndex, model] of (adapter.models ?? []).entries()) {
    const modelLocation = `${location}.models[${modelIndex}]`;
    if (model.termsPolicy === 'openai_api_terms_apply') {
      if (model.termsUrl !== OPENAI_SERVICE_TERMS_URL) {
        failures.push(`${modelLocation}.termsUrl: must use the canonical OpenAI service terms`);
      }
    } else if (model.termsUrl !== null) {
      failures.push(`${modelLocation}.termsUrl: run-specific provider terms require null here`);
    }
  }

  const submission = adapter.submission;
  if (submission?.resultStatus === 'not_submitted') {
    if (submission.submissionRecordUrl !== null) {
      failures.push(`${location}.submission: not_submitted requires a null submission record`);
    }
  } else if (submission?.submissionRecordUrl === null) {
    failures.push(`${location}.submission: submitted results require a submission record URL`);
  }

  try {
    const actualDigest = hashAdapterRoots(projectRoot, adapter.adapter?.roots ?? []);
    if (actualDigest !== adapter.adapter?.sourceSha256) {
      failures.push(
        `${location}.adapter.sourceSha256: expected ${actualDigest} for the checked-in adapter source`,
      );
    }
  } catch (error) {
    failures.push(
      `${location}.adapter.roots: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateSourceEvidence(projectRoot, adapter, failures);
}

function validateBenchmarkProvenance(value, schema, projectRoot) {
  const failures = validateSchema(value, schema);
  walkStrings(value, 'provenance', (entry, location) => {
    if (/\bunknown\b/iu.test(entry)) failures.push(`${location}: unresolved values are forbidden`);
  });
  const adapters = Array.isArray(value?.adapters) ? value.adapters : [];
  const ids = adapters.map((adapter) => adapter?.id);
  if (
    ids.length !== ENABLED_BENCHMARK_IDS.length ||
    ids.some((id, index) => id !== ENABLED_BENCHMARK_IDS[index])
  ) {
    failures.push(
      `provenance.adapters: must contain every enabled adapter in order: ${ENABLED_BENCHMARK_IDS.join(', ')}`,
    );
  }
  adapters.forEach((adapter, index) => {
    if (adapter && typeof adapter === 'object') {
      validateAdapter(adapter, index, projectRoot, failures);
    }
  });
  return Array.from(new Set(failures));
}

function checkBenchmarkProvenance(projectRoot) {
  try {
    return validateBenchmarkProvenance(
      loadBenchmarkProvenance(projectRoot),
      loadBenchmarkProvenanceSchema(projectRoot),
      projectRoot,
    );
  } catch (error) {
    return [`benchmarkProvenance: ${error instanceof Error ? error.message : String(error)}`];
  }
}

module.exports = {
  BENCHMARK_PROVENANCE_FILE,
  BENCHMARK_PROVENANCE_SCHEMA_FILE,
  BENCHMARK_PROVENANCE_SCHEMA_URL,
  ENABLED_BENCHMARK_IDS,
  checkBenchmarkProvenance,
  hashAdapterRoots,
  loadBenchmarkProvenance,
  loadBenchmarkProvenanceSchema,
  validateBenchmarkProvenance,
};
