import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { E2EScenarioTraceSummary } from './e2eTraceSummary';

export type E2ETraceRetentionReason = 'failed' | 'sampled_pass';

export type E2ERunReportScenarioTraceArtifact = {
  path: string;
  relativePath: string;
  retentionReason: E2ETraceRetentionReason;
};

export type E2ETraceArtifactRunMetadata = {
  gitSha: string;
  provider: string;
  model: string;
};

export type E2ETraceArtifactIndexEntry = {
  fixtureId: string;
  retentionReason: E2ETraceRetentionReason;
  path: string;
};

export const TRACE_ARTIFACT_DIR_NAME = 'failed-traces';

export function sanitizeTraceFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scenario'
  );
}

export function writeRetainedScenarioTraceArtifact(params: {
  runDir: string;
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

  const filename = `${params.retentionReason}-${sanitizeTraceFileName(params.fixtureId)}.json`;
  const relativePath = join(TRACE_ARTIFACT_DIR_NAME, filename);
  const path = join(traceDir, filename);
  const artifact = {
    traceId: `${sanitizeTraceFileName(params.generatedAt)}:${params.fixtureId}`,
    generatedAt: params.generatedAt,
    retentionReason: params.retentionReason,
    provider: params.runMetadata.provider,
    model: params.runMetadata.model,
    gitSha: params.runMetadata.gitSha,
    trace: params.trace,
  };

  writeFileSync(path, JSON.stringify(artifact, null, 2), 'utf8');

  return {
    traceArtifact: {
      path,
      relativePath,
      retentionReason: params.retentionReason,
    },
    indexEntry: {
      fixtureId: params.fixtureId,
      retentionReason: params.retentionReason,
      path,
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
        schemaVersion: 'e2e-redacted-trace-index-v1',
        generatedAt: params.generatedAt,
        traces: params.traces,
      },
      null,
      2,
    ),
    'utf8',
  );
}
