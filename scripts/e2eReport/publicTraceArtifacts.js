const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { projectPublicRunReport } = require('./publicRunReport');
const { projectPublicRedactedTrace } = require('./publicTraceSchema');

const TRACE_ARTIFACT_DIR_NAME = 'redacted-traces';

function sanitizeTraceFileName(value) {
  return (
    String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scenario'
  );
}

function fixtureIdDigest(value) {
  return createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex')
    .slice(0, 12);
}

function isPublicRedactedTrace(value) {
  return projectPublicRedactedTrace(value) !== null;
}

function writePublicTraceArtifact(params) {
  const traceDir = path.join(params.runDir, TRACE_ARTIFACT_DIR_NAME);
  fs.mkdirSync(traceDir, { recursive: true });
  const filename = `${params.retentionReason}-${sanitizeTraceFileName(
    params.fixtureId,
  )}-${fixtureIdDigest(params.fixtureId)}.json`;
  const relativePath = `${params.retentionRunId}/${TRACE_ARTIFACT_DIR_NAME}/${filename}`;
  const artifact = {
    schemaVersion: 'e2e-redacted-trace-v2',
    traceId: `${sanitizeTraceFileName(params.generatedAt)}:${params.fixtureId}`,
    generatedAt: params.generatedAt,
    retentionReason: params.retentionReason,
    provider: params.runMetadata.provider,
    hostedFamily: params.runMetadata.hostedFamily,
    model: params.runMetadata.model,
    endpointSha256: params.runMetadata.endpointSha256,
    gitSha: params.runMetadata.gitSha,
    trace: params.trace,
  };
  fs.writeFileSync(path.join(traceDir, filename), JSON.stringify(artifact, null, 2), 'utf8');
  return {
    traceArtifact: {
      referenceBase: 'retention_root',
      relativePath,
      retentionReason: params.retentionReason,
    },
    indexEntry: {
      fixtureId: params.fixtureId,
      referenceBase: 'retention_root',
      retentionReason: params.retentionReason,
      relativePath,
    },
  };
}

function writeRedactedTraceArtifacts(report, runDir, retentionRunId) {
  const publicReport = projectPublicRunReport(report);
  const sourceScenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const traceIndex = [];
  let sampledPassRetained = false;
  const scenarios = publicReport.scenarios.map((publicScenario, index) => {
    const sourceScenario = sourceScenarios[index] || {};
    const trace = projectPublicRedactedTrace(sourceScenario.trace);
    const retentionReason = !trace
      ? undefined
      : !publicScenario.passed
        ? 'failed'
        : sampledPassRetained
          ? undefined
          : 'sampled_pass';
    if (!retentionReason) {
      return publicScenario;
    }
    if (retentionReason === 'sampled_pass') {
      sampledPassRetained = true;
    }
    const { traceArtifact, indexEntry } = writePublicTraceArtifact({
      runDir,
      retentionRunId,
      generatedAt: publicReport.generatedAt,
      runMetadata: publicReport.runMetadata,
      fixtureId: publicScenario.fixtureId,
      retentionReason,
      trace,
    });
    traceIndex.push(indexEntry);
    return { ...publicScenario, traceArtifact };
  });

  if (traceIndex.length > 0) {
    const traceDir = path.join(runDir, TRACE_ARTIFACT_DIR_NAME);
    fs.writeFileSync(
      path.join(traceDir, 'index.json'),
      JSON.stringify(
        {
          schemaVersion: 'e2e-redacted-trace-index-v2',
          generatedAt: publicReport.generatedAt,
          traces: traceIndex,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return { ...publicReport, scenarios };
}

module.exports = {
  TRACE_ARTIFACT_DIR_NAME,
  sanitizeTraceFileName,
  isPublicRedactedTrace,
  writeRedactedTraceArtifacts,
};
