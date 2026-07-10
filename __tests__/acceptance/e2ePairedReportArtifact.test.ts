import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  E2EPairedInfrastructureFailure,
  writeE2EPairedPublicReportArtifact,
} from '../../src/acceptance/e2eAgent/e2ePairedReportArtifact';
import {
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  type E2EPairedRuntimeResult,
} from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { stableHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
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
    pairIdHash: stableHash('pair-id'),
    invariantConfigHash: stableHash('invariant'),
    comparison: {
      referenceCondition: 'memory_off',
      candidateCondition: 'production_auto',
    },
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
    const report = writeE2EPairedPublicReportArtifact({
      runtime: validRuntime(),
      retentionRoot: directory,
      runId: 'run-valid',
    });
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
  });

  it('persists zero-event overflow evidence while withholding the memory observation', () => {
    const reportPath = join(directory, 'run-overflow', 'paired-report.json');
    const report = writeE2EPairedPublicReportArtifact({
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
    });

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.pairedDelta).not.toBeNull();
    expect(report.memoryPairedObservation.status).toBe('invalid_instrumentation');
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
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
    ).toThrow(E2EPairedInfrastructureFailure);
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
    expect(caught).toBeInstanceOf(E2EPairedInfrastructureFailure);
    expect(JSON.stringify(caught)).not.toContain(directory);
    expect(caught).toMatchObject({
      runId: 'run-error',
      reportRelativePath: 'run-error/paired-report.json',
      failureCount: 1,
    });
  });
});
