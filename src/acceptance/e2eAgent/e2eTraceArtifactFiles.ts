import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, posix } from 'path';

import type { E2EScenarioTraceSummary } from './e2eTraceSummary';

export type E2ETraceRetentionReason = 'failed' | 'sampled_pass';

export type E2ERunReportScenarioTraceArtifact = {
  referenceBase: 'retention_root';
  relativePath: string;
  retentionReason: E2ETraceRetentionReason;
};

export type E2ETraceArtifactRunMetadata = {
  gitSha: string;
  provider: string;
  hostedFamily: string;
  model: string;
  endpointSha256: string;
};

export type E2ETraceArtifactIndexEntry = {
  fixtureId: string;
  referenceBase: 'retention_root';
  retentionReason: E2ETraceRetentionReason;
  relativePath: string;
};

export const TRACE_ARTIFACT_DIR_NAME = 'redacted-traces';

export function sanitizeTraceFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scenario'
  );
}

function fixtureIdDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export function writeRetainedScenarioTraceArtifact(params: {
  runDir: string;
  retentionRunId: string;
  generatedAt: string;
  runMetadata: E2ETraceArtifactRunMetadata;
  fixtureId: string;
  retentionReason: E2ETraceRetentionReason;
  trace: E2EScenarioTraceSummary;
}): {
  traceArtifact: E2ERunReportScenarioTraceArtifact;
  indexEntry: E2ETraceArtifactIndexEntry;
} {
  const traceDir = join(params.runDir, TRACE_ARTIFACT_DIR_NAME);
  mkdirSync(traceDir, { recursive: true });

  const filename = `${params.retentionReason}-${sanitizeTraceFileName(
    params.fixtureId,
  )}-${fixtureIdDigest(params.fixtureId)}.json`;
  const relativePath = posix.join(params.retentionRunId, TRACE_ARTIFACT_DIR_NAME, filename);
  const path = join(traceDir, filename);
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

  writeFileSync(path, JSON.stringify(artifact, null, 2), 'utf8');

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

export function writeTraceArtifactIndex(params: {
  runDir: string;
  generatedAt: string;
  traces: ReadonlyArray<E2ETraceArtifactIndexEntry>;
}): void {
  if (params.traces.length === 0) {
    return;
  }

  const traceDir = join(params.runDir, TRACE_ARTIFACT_DIR_NAME);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(
    join(traceDir, 'index.json'),
    JSON.stringify(
      {
        schemaVersion: 'e2e-redacted-trace-index-v2',
        generatedAt: params.generatedAt,
        traces: params.traces,
      },
      null,
      2,
    ),
    'utf8',
  );
}
