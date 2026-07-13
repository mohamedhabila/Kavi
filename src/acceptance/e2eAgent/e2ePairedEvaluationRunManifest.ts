import { createHash } from 'crypto';
import { arch, platform } from 'os';
import { resolve } from 'path';

import type { E2EPairedPublicReport } from './e2ePairedPublicReport';

const { EVALUATION_SCHEMA_URL, loadEvaluationContract } =
  require('../../../scripts/lib/evaluationContract') as {
    EVALUATION_SCHEMA_URL: string;
    loadEvaluationContract: (projectRoot: string) => unknown;
  };
const { validateEvaluationRunManifest } = require('../../../scripts/lib/evaluationRunManifest') as {
  validateEvaluationRunManifest: (manifest: unknown, contract: unknown) => string[];
};

export const E2E_PAIRED_EVALUATION_RUN_FILE = 'evaluation-run.json';
export const E2E_PAIRED_EVALUATION_RUN_SCHEMA_VERSION = '1.0.0' as const;
const APP_REPOSITORY_URL = 'https://github.com/mohamedhabila/Kavi';
const PROJECT_ROOT = resolve(__dirname, '../../..');

type EvaluationRunManifest = Readonly<Record<string, unknown>> & {
  kind: 'evaluation_run';
  schemaVersion: typeof E2E_PAIRED_EVALUATION_RUN_SCHEMA_VERSION;
  runId: string;
  source: {
    app: { repositoryUrl: string; commitSha: string; dirty: boolean };
    upstream: { status: 'not_applicable' };
  };
  artifacts: ReadonlyArray<{
    role: string;
    path: string;
    sha256: string;
    visibility: string;
    mediaType: string;
  }>;
};

function bareSha256(value: string, label: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(value);
  if (!match) throw new Error(`${label} must be a SHA-256 hash.`);
  return match[1];
}

export function sha256EvaluationArtifact(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function candidateCondition(report: E2EPairedPublicReport) {
  return report.conditions.find(
    (condition) => condition.condition === report.comparison.candidateCondition,
  );
}

function manifestOutcome(report: E2EPairedPublicReport): {
  status: 'passed' | 'failed' | 'error';
  statusReason: string | null;
  counts: { requested: number; executed: number; passed: number; failed: number; skipped: number };
  failures: ReadonlyArray<{
    primary:
      | 'premature_completion'
      | 'final_response_incomplete_or_unfaithful'
      | 'infrastructure_or_evaluator';
    secondary: [];
    detailCode: string;
  }>;
} {
  if (report.source.status !== 'clean_match') {
    const detailCode = report.source.status === 'dirty' ? 'source_dirty' : 'source_mismatch';
    return {
      status: 'error',
      statusReason: detailCode,
      counts: { requested: 1, executed: 0, passed: 0, failed: 0, skipped: 1 },
      failures: [{ primary: 'infrastructure_or_evaluator', secondary: [], detailCode }],
    };
  }
  const candidate = candidateCondition(report);
  if (!report.validForDeltaClaims || candidate?.status !== 'completed') {
    return {
      status: 'error',
      statusReason: 'paired_evidence_invalid',
      counts: { requested: 1, executed: 1, passed: 0, failed: 1, skipped: 0 },
      failures: [
        {
          primary: 'infrastructure_or_evaluator',
          secondary: [],
          detailCode: 'paired_evidence_invalid',
        },
      ],
    };
  }
  if (!candidate.metrics.passed) {
    const primary = candidate.metrics.executionCompleted
      ? 'final_response_incomplete_or_unfaithful'
      : 'premature_completion';
    return {
      status: 'failed',
      statusReason: 'candidate_scenario_failed',
      counts: { requested: 1, executed: 1, passed: 0, failed: 1, skipped: 0 },
      failures: [{ primary, secondary: [], detailCode: 'candidate_scenario_failed' }],
    };
  }
  return {
    status: 'passed',
    statusReason: null,
    counts: { requested: 1, executed: 1, passed: 1, failed: 0, skipped: 0 },
    failures: [],
  };
}

function pricing(report: E2EPairedPublicReport) {
  return report.model.capabilityClass === 'on_device'
    ? ({ status: 'not_applicable', estimatedCostUsd: 0 } as const)
    : ({ status: 'missing', estimatedCostUsd: null } as const);
}

function metrics(report: E2EPairedPublicReport) {
  const candidate = candidateCondition(report);
  const completed = candidate?.status === 'completed' ? candidate : null;
  return {
    pass_at_1: completed ? Number(completed.metrics.passed) : null,
    task_completion: completed ? completed.metrics.rubricPassRate : null,
    memory_retrieval:
      completed && completed.metrics.retrieval.instrumentationFailureTurnCount === 0 ? 1 : null,
    latency: completed ? completed.metrics.durationMs : null,
    cost: report.model.capabilityClass === 'on_device' ? 0 : null,
    resource_use: completed ? completed.metrics.totalTokens : null,
  };
}

export function buildE2EPairedEvaluationRunManifest(input: {
  report: E2EPairedPublicReport;
  reportJson: string;
  runId: string;
  generatedAt?: Date;
  host?: { os: string; arch: string; nodeVersion: string };
}): EvaluationRunManifest {
  const outcome = manifestOutcome(input.report);
  const manifest = {
    $schema: EVALUATION_SCHEMA_URL,
    kind: 'evaluation_run',
    schemaVersion: E2E_PAIRED_EVALUATION_RUN_SCHEMA_VERSION,
    runId: input.runId,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    evaluation: {
      id: 'e2e-paired-assessment',
      lane: 'product_native',
      protocolConformance: 'product_native',
      verificationLabel: 'local_only',
      profileId: 'paired-product-native',
      splitKind: 'development',
      status: outcome.status,
      statusReason: outcome.statusReason,
    },
    source: {
      app: {
        repositoryUrl: APP_REPOSITORY_URL,
        commitSha: input.report.source.app.commitSha,
        dirty: input.report.source.app.dirty,
      },
      upstream: { status: 'not_applicable' },
    },
    inputs: {
      datasets: [
        {
          id: 'paired-scenario',
          split: 'development',
          sha256: bareSha256(input.report.scenarioInputHash, 'scenarioInputHash'),
          redistributable: false,
        },
      ],
      configurations: [
        {
          id: 'paired-invariant',
          sha256: bareSha256(input.report.invariantConfigHash, 'invariantConfigHash'),
        },
        {
          id: 'paired-comparison',
          sha256: bareSha256(input.report.pairConfigHash, 'pairConfigHash'),
        },
      ],
      prompts: [],
    },
    models: [{ ...input.report.model }],
    environment: {
      host: input.host ?? { os: platform(), arch: arch(), nodeVersion: process.version },
      device: { status: 'not_applicable' },
    },
    trials: {
      index: 1,
      count: 1,
      seeds: [input.report.executionSeed],
      temperature: null,
      maxRetries: 0,
    },
    pricing: pricing(input.report),
    command: { argv: ['npm', 'run', 'eval:e2e:paired'] },
    scenarioCounts: outcome.counts,
    metrics: metrics(input.report),
    failures: outcome.failures,
    artifacts: [
      {
        role: 'paired-report',
        path: 'paired-report.json',
        sha256: sha256EvaluationArtifact(input.reportJson),
        visibility: 'public',
        mediaType: 'application/json',
      },
    ],
  } as const;
  const failures = validateE2EPairedEvaluationRunManifestBinding(
    input.report,
    input.reportJson,
    manifest,
  );
  if (failures.length > 0) {
    throw new Error(`Paired evaluation manifest is invalid: ${failures.join('; ')}`);
  }
  return manifest;
}

export function validateE2EPairedEvaluationRunManifestBinding(
  report: E2EPairedPublicReport,
  reportJson: string,
  manifest: EvaluationRunManifest,
): string[] {
  const failures = validateEvaluationRunManifest(manifest, loadEvaluationContract(PROJECT_ROOT));
  if (
    manifest.source.app.commitSha !== report.source.app.commitSha ||
    manifest.source.app.dirty !== report.source.app.dirty
  ) {
    failures.push('manifest.source.app: must match the paired report source');
  }
  if (manifest.runId.length === 0) failures.push('manifest.runId: must be present');
  if (manifest.artifacts.length !== 1) {
    failures.push('manifest.artifacts: must contain only the paired report binding');
  } else {
    const artifact = manifest.artifacts[0];
    if (
      artifact.role !== 'paired-report' ||
      artifact.path !== 'paired-report.json' ||
      artifact.visibility !== 'public' ||
      artifact.mediaType !== 'application/json'
    ) {
      failures.push('manifest.artifacts[0]: must identify the public paired report');
    }
    if (artifact.sha256 !== sha256EvaluationArtifact(reportJson)) {
      failures.push('manifest.artifacts[0].sha256: must match the paired report bytes');
    }
  }
  return Array.from(new Set(failures));
}
