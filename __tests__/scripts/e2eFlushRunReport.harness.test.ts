import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import path from 'path';

import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

const projectRoot = path.resolve(__dirname, '../..');
const { digestProviderEndpoint } = require('../../scripts/e2eReport/provenance');
const { buildE2eRunReport } = require('../../scripts/e2e-flush-run-report');
const { projectPublicRunReport } = require('../../scripts/e2eReport/publicRunReport');
const { projectPublicRedactedTrace } = require('../../scripts/e2eReport/publicTraceSchema');
const {
  SCENARIO_ENTRY_SCHEMA_VERSION,
  writePartialReportFile,
} = require('../../scripts/e2eReport/partialReport');

const EMPTY_TOKEN_BUCKETS = {
  systemPromptTokens: 0,
  toolDeclarationTokens: 0,
  memoryContextTokens: 0,
  conversationHistoryTokens: 0,
  userTurnTokens: 0,
  toolResultTokens: 0,
};

function currentPartialEntry(overrides: Record<string, any>) {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    eventCount: 0,
    ...(overrides.usage ?? {}),
  };
  const inputTokens = usage.inputTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const eligibleInputTokens = inputTokens >= 4096 ? inputTokens : 0;
  return {
    schemaVersion: SCENARIO_ENTRY_SCHEMA_VERSION,
    suite: 'core',
    fixtureId: 'fixture',
    passed: true,
    attemptCount: 1,
    durationMs: 0,
    completed: true,
    userTurnCount: 1,
    toolCallCount: 0,
    turnCount: 1,
    graphStatus: null,
    usage,
    tokenBuckets: usage.tokenBuckets ?? EMPTY_TOKEN_BUCKETS,
    cache: {
      inputTokens,
      eligibleInputTokens,
      providerManagedReadinessTokens: 0,
      cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheReadRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
      eligibleCacheReadRate:
        eligibleInputTokens > 0
          ? Math.min(cacheReadTokens, eligibleInputTokens) / eligibleInputTokens
          : 0,
      eligible: eligibleInputTokens > 0,
    },
    loopDiagnostics: {
      repeatedToolCalls: [],
      repeatedCatalogAfterActivationCount: 0,
      repeatedHoldReasons: [],
      passing: true,
    },
    benchmarkFamilies: [],
    assessmentDimensions: [],
    rubricAudit: {
      rubricCount: 0,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      structuralSubstringRubricCount: 0,
      risks: [],
    },
    errors: [],
    ...overrides,
    usage,
    tokenBuckets: overrides.tokenBuckets ?? usage.tokenBuckets ?? EMPTY_TOKEN_BUCKETS,
    ...((overrides.promptCache ?? usage.promptCache)
      ? { promptCache: overrides.promptCache ?? usage.promptCache }
      : {}),
  };
}

function runFlush(env: NodeJS.ProcessEnv) {
  return spawnSync('node', ['./scripts/e2e-flush-run-report.js'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
}

describe('e2e-flush-run-report harness', () => {
  it('projects a closed public report and recursively rebuilds redacted traces', () => {
    const scenarioEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const privateTrace = {
      ...scenarioEntry.trace,
      privateTopLevel: 'projection-sentinel-trace-top',
      usage: {
        ...scenarioEntry.trace!.usage,
        privateNested: 'projection-sentinel-trace-nested',
      },
    };
    const projectedTrace = projectPublicRedactedTrace(privateTrace);
    expect(projectedTrace).not.toBeNull();
    expect(JSON.stringify(projectedTrace)).not.toContain('projection-sentinel');
    expect(
      projectPublicRedactedTrace({
        schemaVersion: 'e2e-redacted-trace-v2',
        privatePayload: 'projection-sentinel-invalid-trace',
      }),
    ).toBeNull();

    const rawReport = buildE2eRunReport(
      [
        currentPartialEntry({
          fixtureId: 'file-write-read',
          detail: 'projection-sentinel-detail',
          errors: ['projection-sentinel-error'],
          customScenarioField: 'projection-sentinel-custom-scenario',
          loopDiagnostics: {
            repeatedToolCalls: [
              {
                name: 'projection_sentinel_dynamic_tool',
                argsHash: 'projection-sentinel-args',
                count: 3,
                noNewEvidence: true,
              },
            ],
            repeatedCatalogAfterActivationCount: 0,
            repeatedHoldReasons: [{ reason: 'projection-sentinel-hold-reason', count: 3 }],
            passing: false,
          },
        }),
      ],
      {
        generatedAt: '2026-07-10T00:00:00.000Z',
        runMetadata: {
          gitSha: 'f'.repeat(40),
          provider: 'openai',
          providerId: 'e2e-openai',
          hostedFamily: 'openai',
          model: 'gpt-5',
          modelIdentitySource: 'provider-model-id',
          modelLocatorSha256: 'a'.repeat(64),
          endpointSha256: 'b'.repeat(64),
          scenarioManifestVersion: '2026-06-12.phase0',
          promptCacheMode: 'provider-default',
          nativeToolFixtureVersion: 'native-tools-2026-06-12',
          collectMode: false,
        },
      },
    ) as any;
    rawReport.privateTopLevel = 'projection-sentinel-custom-report';
    rawReport.scenarios[0].customScenarioField = 'projection-sentinel-custom-scenario';
    rawReport.readinessDashboard.minedEvalCandidates = [
      {
        id: 'candidate:file-write-read:abc',
        sourceScenarioId: 'file-write-read',
        traceFingerprint: 'projection-sentinel-fingerprint',
        categories: ['loop_control'],
        benchmarkFamilies: ['kavi-core'],
        assessmentDimensions: ['control_graph'],
        failedRubricKinds: [],
        toolCallNames: ['projection_sentinel_dynamic_tool'],
        graphStatus: 'finalized',
      },
    ];

    const publicReport = projectPublicRunReport(rawReport);
    const serialized = JSON.stringify(publicReport);
    expect(serialized).not.toContain('projection-sentinel');
    expect(publicReport).not.toHaveProperty('privateTopLevel');
    expect(publicReport.scenarios[0]).not.toHaveProperty('customScenarioField');
    expect(publicReport.scenarios[0].loopDiagnostics.repeatedToolCalls[0]).not.toHaveProperty(
      'name',
    );
    expect(publicReport.readinessDashboard.minedEvalCandidates[0]).toMatchObject({
      toolCallNames: [],
      toolCallNameHashes: [expect.any(Object)],
    });
  });

  it('writes final JSON report from partial entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-private-sentinel-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult({
        toolCalls: [
          {
            id: 'private-sentinel-call-1',
            name: 'private_sentinel_dynamic_tool',
            arguments: '{"private":"private-sentinel-argument"}',
          },
          {
            id: 'private-sentinel-call-2',
            name: 'private_sentinel_dynamic_tool',
            arguments: '{"private":"private-sentinel-argument"}',
          },
        ],
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
          eventCount: 1,
          tokenBuckets: {
            systemPromptTokens: 1,
            toolDeclarationTokens: 2,
            memoryContextTokens: 3,
            conversationHistoryTokens: 4,
            userTurnTokens: 5,
            toolResultTokens: 6,
          },
          promptCache: {
            eligibleTurnCount: 1,
            enabledTurnCount: 1,
            skippedTurnCount: 0,
            createEventCount: 0,
            reuseEventCount: 0,
            providerManagedEventCount: 1,
            thresholdTokens: [1024],
            explicitCacheNames: ['private-sentinel-cache-id'],
            reasonCounts: [{ reason: 'automatic_prompt_cache', count: 1 }],
            events: [
              {
                eligible: true,
                enabled: true,
                estimatedInputTokens: 1024,
                thresholdTokens: 1024,
                providerFamily: 'openai',
                hostedFamily: 'openai',
                mode: 'openai_native',
                event: 'provider_managed',
                reason: 'automatic_prompt_cache',
                explicitCacheName: 'private-sentinel-cache-id',
              },
            ],
          },
        },
      }),
      outcome: {
        fixtureId: 'file-write-read',
        passed: true,
        detail: 'private-sentinel-outcome-detail',
      },
      attemptCount: 1,
      rubrics: [
        {
          kind: 'workspace_file',
          path: 'private-sentinel-rubric-path.txt',
          contains: 'private-sentinel-rubric-token',
        },
      ],
    });
    const traceWithUnknownFields = entry.trace
      ? {
          ...entry.trace,
          privateNestedTraceValue: 'private-sentinel-trace-top-level',
          usage: {
            ...entry.trace.usage,
            privateNestedUsageValue: 'private-sentinel-trace-nested',
          },
        }
      : undefined;
    writePartialReportFile(partialPath, [
      {
        ...entry,
        trace: traceWithUnknownFields,
        errors: ['private-sentinel-provider-error'],
      },
    ]);
    const retentionDir = join(dir, 'e2e-readiness-runs');
    const legacyRunDir = join(retentionDir, 'legacy-run');
    mkdirSync(legacyRunDir, { recursive: true });
    writeFileSync(join(legacyRunDir, 'report.json'), 'private-sentinel-legacy-report', 'utf8');
    writeFileSync(
      join(retentionDir, 'index.json'),
      JSON.stringify({
        version: '2026-06-12.phase8',
        runs: [
          {
            runId: 'legacy-run',
            reportPath: join(legacyRunDir, 'report.json'),
            dashboardPath: join(legacyRunDir, 'dashboard.json'),
          },
        ],
      }),
      'utf8',
    );

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_MAX_SCENARIO_RETRIES: '1',
        E2E_PROVIDER: 'compatible',
        E2E_COMPATIBLE_BASE_URL: 'https://private-sentinel.invalid/local-endpoint',
        E2E_COMPATIBLE_MODEL: `file://${dir}/private-sentinel-model.gguf?token=private-sentinel-token`,
        E2E_GIT_SHA: 'f'.repeat(40),
        E2E_MODEL_VERSION: 'revision-2026.07',
        E2E_PROMPT_CACHE_MODE: 'disabled',
        E2E_PUBLIC_HOSTED_FAMILY: 'qwen',
        E2E_PUBLIC_MODEL_ID: 'qwen2.5-mobile-eval',
        E2E_SEED: '42',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('wrote');
      expect(result.stdout).toContain('summary wrote');

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        schemaVersion: string;
        scenarios: Array<{
          fixtureId: string;
          trace?: unknown;
          rawTrace?: unknown;
          privateTrace?: unknown;
          traceArtifact?: {
            referenceBase: string;
            relativePath: string;
            retentionReason: string;
          };
          tokenBuckets: {
            toolDeclarationTokens: number;
          };
          usage: {
            promptCache?: {
              explicitCacheNameHashes: unknown[];
            };
          };
          detailHash?: unknown;
          errorHashes: unknown[];
          failedRubrics?: Array<{ detailHash?: unknown }>;
          loopDiagnostics: {
            repeatedToolCalls: Array<{ name?: string; nameHash: unknown }>;
          };
        }>;
        totals: { scenarioCount: number };
        maxScenarioRetries: number;
        runMetadata: {
          hostedFamily: string;
          model: string;
          modelIdentitySource: string;
          modelLocatorSha256: string;
          modelVersion?: string;
          endpointSha256: string;
          promptCacheMode: string;
          seed?: number;
          scenarioManifestVersion: string;
        };
        reliability: {
          k: number;
          pass1PassedCount: number;
          passKPassedCount: number;
          retriedScenarioCount: number;
        };
        cache: {
          eligibleInputThreshold: number;
          passing: boolean;
          promptCacheTelemetry: {
            eligibleTurnCount: number;
            providerManagedEventCount: number;
            explicitCacheNameCount: number;
          };
        };
        graderAudit: { passing: boolean };
        readiness: { passing: boolean };
        readinessDashboard: {
          version: string;
          overall: { passing: boolean };
          failureTaxonomy: Array<{
            category: string;
            externalRequirementIds: string[];
          }>;
          artifactRetention: { defaultRetainedRuns: number };
        };
      };
      expect(report.schemaVersion).toBe('e2e-run-report-v2');
      expect(report.scenarios[0]?.fixtureId).toBe('file-write-read');
      expect(report.scenarios[0]?.trace).toBeUndefined();
      expect(report.scenarios[0]?.rawTrace).toBeUndefined();
      expect(report.scenarios[0]?.privateTrace).toBeUndefined();
      expect(report.scenarios[0]?.traceArtifact).toEqual({
        referenceBase: 'retention_root',
        relativePath: expect.stringMatching(
          /^run-[^/]+\/redacted-traces\/sampled_pass-file-write-read-[a-f0-9]{12}\.json$/u,
        ),
        retentionReason: 'sampled_pass',
      });
      expect(report.scenarios[0]?.tokenBuckets.toolDeclarationTokens).toBe(2);
      expect(report.scenarios[0]?.usage.promptCache?.explicitCacheNameHashes).toHaveLength(1);
      expect(report.scenarios[0]?.detailHash).toBeDefined();
      expect(report.scenarios[0]?.errorHashes).toHaveLength(1);
      expect(report.scenarios[0]?.failedRubrics?.[0]?.detailHash).toBeDefined();
      expect(report.scenarios[0]?.loopDiagnostics.repeatedToolCalls[0]).toMatchObject({
        nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      });
      expect(report.scenarios[0]?.loopDiagnostics.repeatedToolCalls[0]?.name).toBeUndefined();
      expect(report.totals.scenarioCount).toBe(1);
      expect(report.maxScenarioRetries).toBe(1);
      expect(report.runMetadata.hostedFamily).toBe('qwen');
      expect(report.runMetadata.model).toBe('qwen2.5-mobile-eval');
      expect(report.runMetadata.modelIdentitySource).toBe('explicit-public-id');
      expect(report.runMetadata.modelLocatorSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.runMetadata.modelVersion).toBe('revision-2026.07');
      expect(report.runMetadata.endpointSha256).toBe(
        digestProviderEndpoint('https://private-sentinel.invalid/local-endpoint'),
      );
      expect(report.runMetadata.promptCacheMode).toBe('disabled');
      expect(report.runMetadata.seed).toBe(42);
      expect(report.runMetadata.scenarioManifestVersion).toBe('2026-06-12.phase0');
      expect(report.reliability).toMatchObject({
        k: 2,
        pass1PassedCount: 1,
        passKPassedCount: 1,
        retriedScenarioCount: 0,
      });
      expect(report.cache.eligibleInputThreshold).toBe(4096);
      expect(report.cache.promptCacheTelemetry).toMatchObject({
        eligibleTurnCount: 1,
        providerManagedEventCount: 1,
        explicitCacheNameCount: 1,
      });
      expect(report.cache.passing).toBe(false);
      expect(report.graderAudit.passing).toBe(true);
      expect(report.readiness.passing).toBe(false);
      expect(report.readinessDashboard).toMatchObject({
        version: '2026-07-10.phase9',
        overall: { passing: false },
        artifactRetention: { defaultRetainedRuns: 90 },
      });
      expect(report.readinessDashboard.failureTaxonomy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'external_runner_required',
            externalRequirementIds: expect.arrayContaining([
              'androidworld-device-runner',
              'agentdojo-prompt-injection',
            ]),
          }),
        ]),
      );

      const dashboardPath = `${reportPath}.dashboard.json`;
      expect(existsSync(dashboardPath)).toBe(true);
      const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
        benchmarkRequirements: { externalRequired: number };
      };
      expect(dashboard.benchmarkRequirements.externalRequired).toBeGreaterThan(0);
      const summaryPath = join(dir, 'e2e-agent-report.md');
      expect(existsSync(summaryPath)).toBe(true);
      const summary = readFileSync(summaryPath, 'utf8');
      expect(summary).toContain('E2E Agent Report Summary');
      expect(summary).toContain('file-write-read');

      const retentionIndex = JSON.parse(
        readFileSync(join(dir, 'e2e-readiness-runs', 'index.json'), 'utf8'),
      ) as {
        retainedRunCount: number;
        runs: Array<{
          runId: string;
          dashboardRelativePath: string;
          reportRelativePath: string;
        }>;
      };
      expect(retentionIndex.retainedRunCount).toBe(1);
      expect(existsSync(legacyRunDir)).toBe(false);
      expect(retentionIndex.runs[0]!.dashboardRelativePath).toBe(
        `${retentionIndex.runs[0]!.runId}/dashboard.json`,
      );
      expect(retentionIndex.runs[0]!.reportRelativePath).toBe(
        `${retentionIndex.runs[0]!.runId}/report.json`,
      );
      expect(
        existsSync(join(dir, 'e2e-readiness-runs', retentionIndex.runs[0]!.dashboardRelativePath)),
      ).toBe(true);
      expect(
        existsSync(join(dir, 'e2e-readiness-runs', retentionIndex.runs[0]!.reportRelativePath)),
      ).toBe(true);
      const retentionDir = join(dir, 'e2e-readiness-runs');
      const retainedRunDir = join(retentionDir, retentionIndex.runs[0]!.runId);
      const tracePath = join(retentionDir, report.scenarios[0]!.traceArtifact!.relativePath);
      const traceIndexPath = join(retainedRunDir, 'redacted-traces', 'index.json');
      expect(existsSync(tracePath)).toBe(true);
      expect(existsSync(traceIndexPath)).toBe(true);
      const publicJson = [
        readFileSync(reportPath, 'utf8'),
        readFileSync(dashboardPath, 'utf8'),
        readFileSync(join(dir, 'e2e-readiness-runs', 'index.json'), 'utf8'),
        readFileSync(
          join(dir, 'e2e-readiness-runs', retentionIndex.runs[0]!.dashboardRelativePath),
          'utf8',
        ),
        readFileSync(
          join(dir, 'e2e-readiness-runs', retentionIndex.runs[0]!.reportRelativePath),
          'utf8',
        ),
        readFileSync(tracePath, 'utf8'),
        readFileSync(traceIndexPath, 'utf8'),
      ].join('\n');
      expect(publicJson).not.toContain(dir);
      expect(publicJson).not.toContain('private-sentinel');
      expect(publicJson).not.toContain('local-endpoint');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no-ops when E2E_REPORT_PATH is unset', () => {
    const result = runFlush({
      ...process.env,
      E2E_REPORT_PATH: '',
    });

    expect(result.status).toBe(0);
  });

  it('reports retry-assisted pass^k separately from pass^1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-flush-reliability-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    writePartialReportFile(partialPath, [
      currentPartialEntry({
        fixtureId: 'file-write-read',
        attemptCount: 2,
        durationMs: 1000,
        toolCallCount: 1,
        graphStatus: 'finalized',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
          eventCount: 1,
        },
        benchmarkFamilies: ['kavi-core'],
        assessmentDimensions: ['task_completion'],
      }),
    ]);

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_MAX_SCENARIO_RETRIES: '2',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('reliability pass1=0/1 pass^3=1/1');

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        reliability: {
          k: number;
          pass1Rate: number;
          passKRate: number;
          retriedScenarioCount: number;
        };
        readiness: { failedCriteria: string[] };
      };
      expect(report.reliability).toMatchObject({
        k: 3,
        pass1Rate: 0,
        passKRate: 1,
        retriedScenarioCount: 1,
      });
      expect(report.readiness.failedCriteria).toContain('pass1_reliability');
      expect(report.readiness.failedCriteria).not.toContain('scenario_pass_rate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('threads explicit cache-create telemetry into the final report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-flush-cache-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const partialPath = `${reportPath}.partial.json`;

    writePartialReportFile(partialPath, [
      currentPartialEntry({
        fixtureId: 'cache-readiness',
        durationMs: 1000,
        toolCallCount: 1,
        graphStatus: 'finalized',
        usage: {
          inputTokens: 4096,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 4101,
          eventCount: 1,
        },
      }),
    ]);

    try {
      const result = runFlush({
        ...process.env,
        E2E_REPORT_PATH: reportPath,
        E2E_CACHE_CREATE_ATTEMPTS: '2',
        E2E_CACHE_CREATE_FAILURE_COUNT: '1',
        E2E_CACHE_CREATE_FAILURES_JSON: JSON.stringify([{ providerStatus: '400', count: 1 }]),
      });

      expect(result.status).toBe(0);

      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        cache: {
          cacheCreateAttempts: number;
          cacheCreateFailureCount: number;
          cacheCreateFailuresByProviderStatus: Array<{
            providerStatusHash: unknown;
            count: number;
          }>;
          cacheCreateTelemetryAvailable: boolean;
        };
        readiness: { failedCriteria: string[] };
      };
      expect(report.cache).toMatchObject({
        cacheCreateAttempts: 2,
        cacheCreateFailureCount: 1,
        cacheCreateFailuresByProviderStatus: [{ providerStatusHash: expect.any(Object), count: 1 }],
        cacheCreateTelemetryAvailable: true,
      });
      expect(report.readiness.failedCriteria).toContain('cache_readiness');
      expect(report.readiness.failedCriteria).not.toContain('cache_create_telemetry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
