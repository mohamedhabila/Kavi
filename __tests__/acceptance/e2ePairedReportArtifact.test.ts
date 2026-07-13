import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  E2EPairedClaimFailure,
  writeE2EPairedPublicReportArtifact,
} from '../../src/acceptance/e2eAgent/e2ePairedReportArtifact';
import {
  buildE2EPairedExecutionIdentityHash,
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  resolveE2EPairedExecutionOrder,
  type E2EPairedRuntimeResult,
} from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { stableHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import {
  E2E_PAIRED_EVALUATION_RUN_FILE,
  sha256EvaluationArtifact,
  validateE2EPairedEvaluationRunManifestBinding,
} from '../../src/acceptance/e2eAgent/e2ePairedEvaluationRunManifest';
import type { E2EScenarioTurnTrace } from '../../src/acceptance/e2eAgent/types';
import {
  buildPairedRetrievalEvent,
  buildPairedTurnTrace,
  PAIRED_TEST_SOURCE_THREAD_HASH,
} from '../helpers/e2ePairedRunHarness';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

function validRuntime(input?: {
  productTurnTraces?: ReadonlyArray<E2EScenarioTurnTrace>;
}): E2EPairedRuntimeResult {
  const pairIdHash = stableHash('pair-id');
  const executionSeed = 2;
  const condition = (label: 'memory_off' | 'production_auto') => {
    const turnTraces =
      label === 'memory_off'
        ? [
            buildPairedTurnTrace({
              sourceThreadIdHash: null,
              instrumentationStatus: 'opt_out',
              events: [],
            }),
          ]
        : (input?.productTurnTraces ?? [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'recorded',
              events: [buildPairedRetrievalEvent()],
            }),
          ]);
    return {
      condition: label,
      conditionConfigHash: stableHash(`${label}-config`),
      executionIdentityHash: buildE2EPairedExecutionIdentityHash({
        pairIdHash,
        seed: executionSeed,
        condition: label,
      }),
      oracleEvidenceCount: 0,
      status: 'completed' as const,
      result: buildFixtureResult({
        fixtureId: 'paired-artifact',
        turnTraces,
        userTurnCount: turnTraces.length,
      }),
      assessment: {
        executionCompleted: true,
        rubricPassed: 1,
        rubricTotal: 1,
        passed: true,
      },
    };
  };
  return {
    schemaVersion: E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
    source: {
      app: { commitSha: 'a'.repeat(40), dirty: false },
      completionApp: { commitSha: 'a'.repeat(40), dirty: false },
      status: 'clean_match',
    },
    model: {
      role: 'assistant',
      capabilityClass: 'hosted_tool_capable',
      provider: 'custom',
      model: `sha256-${'b'.repeat(64)}`,
      revision: null,
      endpointSha256: 'c'.repeat(64),
    },
    scenarioInputHash: stableHash('paired-artifact-scenario'),
    pairIdHash,
    invariantConfigHash: stableHash('invariant'),
    comparison: {
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
    },
    executionSeed,
    executionOrder: resolveE2EPairedExecutionOrder(
      { referenceCondition: 'memory_off', candidateCondition: 'production_auto' },
      executionSeed,
    ),
    conditions: [condition('memory_off'), condition('production_auto')],
    cleanup: { status: 'completed' },
    validForDeltaClaims: true,
  };
}

describe('paired public report artifact', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kavi-paired-report-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('atomically writes a valid public report', () => {
    const reportPath = join(directory, 'run-valid', 'paired-report.json');
    const manifestPath = join(directory, 'run-valid', E2E_PAIRED_EVALUATION_RUN_FILE);
    const report = writeE2EPairedPublicReportArtifact({
      runtime: validRuntime(),
      retentionRoot: directory,
      runId: 'run-valid',
      generatedAt: new Date('2026-07-13T10:00:00.000Z'),
      host: { os: 'test-os', arch: 'test-arch', nodeVersion: 'v22.0.0' },
    });
    const reportJson = readFileSync(reportPath, 'utf8');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(JSON.parse(reportJson)).toEqual(report);
    expect(manifest).toMatchObject({
      kind: 'evaluation_run',
      schemaVersion: '1.0.0',
      runId: 'run-valid',
      evaluation: {
        lane: 'product_native',
        protocolConformance: 'product_native',
        verificationLabel: 'local_only',
        splitKind: 'development',
      },
      source: { app: { commitSha: 'a'.repeat(40), dirty: false } },
      pricing: { status: 'missing', estimatedCostUsd: null },
      metrics: { cost: null },
      artifacts: [
        {
          role: 'paired-report',
          path: 'paired-report.json',
          sha256: sha256EvaluationArtifact(reportJson),
        },
      ],
    });
    expect(validateE2EPairedEvaluationRunManifestBinding(report, reportJson, manifest)).toEqual([]);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain('.private/');
    expect(serialized).not.toContain('sk-proj-');
  });

  it('detects report tampering, artifact hash drift, and source metadata mismatch', () => {
    const reportPath = join(directory, 'run-binding', 'paired-report.json');
    const manifestPath = join(directory, 'run-binding', E2E_PAIRED_EVALUATION_RUN_FILE);
    const report = writeE2EPairedPublicReportArtifact({
      runtime: validRuntime(),
      retentionRoot: directory,
      runId: 'run-binding',
    });
    const reportJson = readFileSync(reportPath, 'utf8');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(
      validateE2EPairedEvaluationRunManifestBinding(report, `${reportJson}\n`, manifest),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('must match the paired report bytes')]),
    );

    const hashDrift = JSON.parse(JSON.stringify(manifest));
    hashDrift.artifacts[0].sha256 = 'd'.repeat(64);
    expect(validateE2EPairedEvaluationRunManifestBinding(report, reportJson, hashDrift)).toEqual(
      expect.arrayContaining([expect.stringContaining('must match the paired report bytes')]),
    );

    const sourceDrift = JSON.parse(JSON.stringify(manifest));
    sourceDrift.source.app.commitSha = 'b'.repeat(40);
    expect(validateE2EPairedEvaluationRunManifestBinding(report, reportJson, sourceDrift)).toEqual(
      expect.arrayContaining([expect.stringContaining('must match the paired report source')]),
    );
  });

  it.each([
    {
      executionCompleted: true,
      primary: 'final_response_incomplete_or_unfaithful',
      runId: 'run-candidate-failed',
    },
    {
      executionCompleted: false,
      primary: 'premature_completion',
      runId: 'run-candidate-incomplete',
    },
  ] as const)(
    'writes a valid $primary manifest for a failed candidate',
    ({ executionCompleted, primary, runId }) => {
      const runtime = validRuntime();
      const candidate = runtime.conditions[1];
      if (candidate.status !== 'completed') throw new Error('candidate fixture must complete');
      const candidateFailure: E2EPairedRuntimeResult = {
        ...runtime,
        conditions: [
          runtime.conditions[0],
          {
            ...candidate,
            result: { ...candidate.result, completed: executionCompleted },
            assessment: {
              executionCompleted,
              rubricPassed: 0,
              rubricTotal: 1,
              passed: false,
            },
          },
        ],
      };

      const report = writeE2EPairedPublicReportArtifact({
        runtime: candidateFailure,
        retentionRoot: directory,
        runId,
      });
      const manifest = JSON.parse(
        readFileSync(join(directory, runId, E2E_PAIRED_EVALUATION_RUN_FILE), 'utf8'),
      );

      expect(report.conditions[1]).toMatchObject({
        status: 'completed',
        metrics: { passed: false },
      });
      expect(manifest).toMatchObject({
        evaluation: { status: 'failed', statusReason: 'candidate_scenario_failed' },
        failures: [
          {
            primary,
            secondary: [],
            detailCode: 'candidate_scenario_failed',
          },
        ],
      });
    },
  );

  it('persists zero-event overflow evidence and fails closed without a paired delta', () => {
    const reportPath = join(directory, 'run-overflow', 'paired-report.json');
    expect(() =>
      writeE2EPairedPublicReportArtifact({
        runtime: validRuntime({
          productTurnTraces: [
            buildPairedTurnTrace({
              sourceThreadIdHash: PAIRED_TEST_SOURCE_THREAD_HASH,
              instrumentationStatus: 'overflow',
              events: [],
            }),
          ],
        }),
        retentionRoot: directory,
        runId: 'run-overflow',
      }),
    ).toThrow(E2EPairedClaimFailure);

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      validForDeltaClaims: false,
      pairedDelta: null,
      memoryPairedObservation: { status: 'invalid_instrumentation' },
    });
  });

  it('writes redacted failure evidence before failing the caller', () => {
    const reportPath = join(directory, 'run-failed', 'paired-report.json');
    const runtime = validRuntime();
    const failedRuntime: E2EPairedRuntimeResult = {
      ...runtime,
      conditions: [
        {
          condition: 'memory_off',
          conditionConfigHash: stableHash('memory_off-config'),
          executionIdentityHash: runtime.conditions[0].executionIdentityHash,
          oracleEvidenceCount: 0,
          status: 'failed',
          category: 'condition_execution',
          errorHash: stableHash('PRIVATE-INFRASTRUCTURE-PROSE'),
          privateError: 'PRIVATE-INFRASTRUCTURE-PROSE',
        },
        runtime.conditions[1],
      ],
      validForDeltaClaims: false,
    };

    expect(() =>
      writeE2EPairedPublicReportArtifact({
        runtime: failedRuntime,
        retentionRoot: directory,
        runId: 'run-failed',
      }),
    ).toThrow(E2EPairedClaimFailure);
    const persisted = readFileSync(reportPath, 'utf8');
    expect(persisted).not.toContain('PRIVATE-INFRASTRUCTURE-PROSE');
    expect(persisted).not.toContain('privateError');
    expect(JSON.parse(persisted)).toMatchObject({
      validForDeltaClaims: false,
      pairedDelta: null,
      infrastructureFailures: [
        expect.objectContaining({ scope: 'memory_off', category: 'condition_execution' }),
      ],
    });
  });

  it('rejects traversal and symlink escapes before publishing', () => {
    expect(() =>
      writeE2EPairedPublicReportArtifact({
        runtime: validRuntime(),
        retentionRoot: directory,
        runId: '../escape',
      }),
    ).toThrow('path-free identifier');

    const outside = mkdtempSync(join(tmpdir(), 'kavi-paired-outside-'));
    try {
      mkdirSync(join(outside, 'target'));
      symlinkSync(join(outside, 'target'), join(directory, 'run-symlink'));
      expect(() =>
        writeE2EPairedPublicReportArtifact({
          runtime: validRuntime(),
          retentionRoot: directory,
          runId: 'run-symlink',
        }),
      ).toThrow('run directory must not be a symlink');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('never overwrites an existing immutable run directory', () => {
    writeE2EPairedPublicReportArtifact({
      runtime: validRuntime(),
      retentionRoot: directory,
      runId: 'run-immutable',
    });
    const reportPath = join(directory, 'run-immutable', 'paired-report.json');
    const firstContent = readFileSync(reportPath, 'utf8');
    expect(() =>
      writeE2EPairedPublicReportArtifact({
        runtime: validRuntime(),
        retentionRoot: directory,
        runId: 'run-immutable',
      }),
    ).toThrow('retained evidence is immutable');
    expect(readFileSync(reportPath, 'utf8')).toBe(firstContent);
  });

  it('rejects a pre-existing symlink lock path', () => {
    const outside = mkdtempSync(join(tmpdir(), 'kavi-paired-lock-'));
    try {
      symlinkSync(outside, join(directory, '.paired-report.lock'));
      expect(() =>
        writeE2EPairedPublicReportArtifact({
          runtime: validRuntime(),
          retentionRoot: directory,
          runId: 'run-lock',
        }),
      ).toThrow('lock path must not be a symlink');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps absolute retention paths out of serializable infrastructure errors', () => {
    const failed = validRuntime();
    const invalid: E2EPairedRuntimeResult = {
      ...failed,
      conditions: [
        {
          condition: 'memory_off',
          conditionConfigHash: stableHash('memory_off-config'),
          executionIdentityHash: failed.conditions[0].executionIdentityHash,
          oracleEvidenceCount: 0,
          status: 'failed',
          category: 'state_reset',
          errorHash: stableHash('private error'),
          privateError: 'private error',
        },
        failed.conditions[1],
      ],
      validForDeltaClaims: false,
    };
    let caught: unknown;
    try {
      writeE2EPairedPublicReportArtifact({
        runtime: invalid,
        retentionRoot: directory,
        runId: 'run-error',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(E2EPairedClaimFailure);
    expect(JSON.stringify(caught)).not.toContain(directory);
    expect(caught).toMatchObject({
      runId: 'run-error',
      reportRelativePath: 'run-error/paired-report.json',
      failureCount: 1,
    });
  });
});
