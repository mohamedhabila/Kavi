const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { RUN_REPORT_SCHEMA_VERSION } = require('./constants');
const { projectPublicRedactedTrace } = require('./publicTraceSchema');

const RETAINED_RUN_MANIFEST_FILE = 'artifact-manifest.json';
const RETAINED_RUN_MANIFEST_SCHEMA_VERSION = 'e2e-retained-run-manifest-v1';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function exactKeys(value, expectedKeys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort())
  );
}

function listRegularFiles(rootDir, relativeDir = '') {
  const directory = path.join(rootDir, relativeDir);
  const files = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, name) : name;
    if (relativePath === RETAINED_RUN_MANIFEST_FILE) continue;
    const absolutePath = path.join(rootDir, ...relativePath.split('/'));
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Retained evaluation artifacts cannot contain symlinks: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      files.push(...listRegularFiles(rootDir, relativePath));
    } else if (stat.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported retained evaluation artifact: ${relativePath}`);
    }
  }
  return files.sort();
}

function expectedRetainedPaths(report, runId) {
  const paths = new Set(['dashboard.json', 'report.json']);
  let hasTrace = false;
  for (const scenario of report.scenarios || []) {
    const artifact = scenario.traceArtifact;
    if (!artifact) continue;
    const prefix = `${runId}/`;
    if (
      !exactKeys(artifact, ['referenceBase', 'relativePath', 'retentionReason']) ||
      artifact.referenceBase !== 'retention_root' ||
      typeof artifact.relativePath !== 'string' ||
      !artifact.relativePath.startsWith(`${prefix}redacted-traces/`) ||
      path.posix.normalize(artifact.relativePath) !== artifact.relativePath ||
      !['failed', 'sampled_pass'].includes(artifact.retentionReason)
    ) {
      throw new Error('Retained evaluation report contains an invalid trace reference.');
    }
    hasTrace = true;
    paths.add(artifact.relativePath.slice(prefix.length));
  }
  if (hasTrace) paths.add('redacted-traces/index.json');
  return [...paths].sort();
}

function buildRetainedRunManifest(runDir, runId, generatedAt) {
  const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'));
  const paths = expectedRetainedPaths(report, runId);
  const actualPaths = listRegularFiles(runDir);
  if (!isDeepStrictEqual(actualPaths, paths)) {
    throw new Error('Generated retained evaluation run contains unmanifested artifacts.');
  }
  return {
    schemaVersion: RETAINED_RUN_MANIFEST_SCHEMA_VERSION,
    runId,
    generatedAt,
    files: paths.map((relativePath) => ({
      relativePath,
      sha256: sha256File(path.join(runDir, ...relativePath.split('/'))),
    })),
  };
}

function validateTraceArtifacts(runDir, runId, report) {
  const expectedIndexEntries = [];
  for (const scenario of report.scenarios) {
    const artifactReference = scenario.traceArtifact;
    if (!artifactReference) continue;
    const localPath = artifactReference.relativePath.slice(`${runId}/`.length);
    const artifact = JSON.parse(
      fs.readFileSync(path.join(runDir, ...localPath.split('/')), 'utf8'),
    );
    if (
      !exactKeys(artifact, [
        'schemaVersion',
        'traceId',
        'generatedAt',
        'retentionReason',
        'provider',
        'hostedFamily',
        'model',
        'endpointSha256',
        'gitSha',
        'trace',
      ]) ||
      artifact.schemaVersion !== 'e2e-redacted-trace-v2' ||
      artifact.generatedAt !== report.generatedAt ||
      artifact.retentionReason !== artifactReference.retentionReason ||
      artifact.provider !== report.runMetadata.provider ||
      artifact.hostedFamily !== report.runMetadata.hostedFamily ||
      artifact.model !== report.runMetadata.model ||
      artifact.endpointSha256 !== report.runMetadata.endpointSha256 ||
      artifact.gitSha !== report.runMetadata.gitSha ||
      !isDeepStrictEqual(projectPublicRedactedTrace(artifact.trace), artifact.trace)
    ) {
      throw new Error('Retained evaluation trace is not canonical public evidence.');
    }
    expectedIndexEntries.push({
      fixtureId: scenario.fixtureId,
      referenceBase: 'retention_root',
      retentionReason: artifactReference.retentionReason,
      relativePath: artifactReference.relativePath,
    });
  }
  if (expectedIndexEntries.length === 0) return;
  const traceIndex = JSON.parse(
    fs.readFileSync(path.join(runDir, 'redacted-traces', 'index.json'), 'utf8'),
  );
  if (
    !exactKeys(traceIndex, ['schemaVersion', 'generatedAt', 'traces']) ||
    traceIndex.schemaVersion !== 'e2e-redacted-trace-index-v2' ||
    traceIndex.generatedAt !== report.generatedAt ||
    !isDeepStrictEqual(traceIndex.traces, expectedIndexEntries)
  ) {
    throw new Error('Retained evaluation trace index is not canonical.');
  }
}

function validateRetainedRunDirectory(retentionDir, indexEntry) {
  try {
    const runDir = path.join(retentionDir, indexEntry.runId);
    const manifestPath = path.join(runDir, RETAINED_RUN_MANIFEST_FILE);
    const manifestBytes = fs.readFileSync(manifestPath);
    if (sha256(manifestBytes) !== indexEntry.manifestSha256) return false;
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (
      !exactKeys(manifest, ['schemaVersion', 'runId', 'generatedAt', 'files']) ||
      manifest.schemaVersion !== RETAINED_RUN_MANIFEST_SCHEMA_VERSION ||
      manifest.runId !== indexEntry.runId ||
      manifest.generatedAt !== indexEntry.generatedAt ||
      !Array.isArray(manifest.files)
    ) {
      return false;
    }
    const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'));
    const dashboard = JSON.parse(fs.readFileSync(path.join(runDir, 'dashboard.json'), 'utf8'));
    if (
      report.schemaVersion !== RUN_REPORT_SCHEMA_VERSION ||
      report.generatedAt !== indexEntry.generatedAt ||
      report.runMetadata?.gitSha !== indexEntry.gitSha ||
      report.runMetadata?.provider !== indexEntry.provider ||
      report.runMetadata?.model !== indexEntry.model ||
      !Array.isArray(report.scenarios) ||
      !isDeepStrictEqual(dashboard, report.readinessDashboard)
    ) {
      return false;
    }
    const expectedPaths = expectedRetainedPaths(report, indexEntry.runId);
    const actualPaths = listRegularFiles(runDir);
    if (!isDeepStrictEqual(actualPaths, expectedPaths)) return false;
    if (
      !isDeepStrictEqual(
        manifest.files,
        expectedPaths.map((relativePath) => ({
          relativePath,
          sha256: sha256File(path.join(runDir, ...relativePath.split('/'))),
        })),
      )
    ) {
      return false;
    }
    validateTraceArtifacts(runDir, indexEntry.runId, report);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  RETAINED_RUN_MANIFEST_FILE,
  RETAINED_RUN_MANIFEST_SCHEMA_VERSION,
  buildRetainedRunManifest,
  sha256,
  validateRetainedRunDirectory,
};
