import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  flushE2ERunReport,
  formatE2ERunReportSummary,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import {
  E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
  E2E_SCENARIO_MANIFEST_VERSION,
} from '../../src/acceptance/e2eAgent/thresholds';
import {
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeMobileTool,
} from '../../src/engine/tools/e2eNativeCalendarFixtures';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import type { UsageTokenBuckets } from '../../src/types/usage';

const TOKEN_BUCKETS: UsageTokenBuckets = {
  systemPromptTokens: 11,
  toolDeclarationTokens: 22,
  memoryContextTokens: 33,
  conversationHistoryTokens: 44,
  userTurnTokens: 55,
  toolResultTokens: 66,
};

function buildFixtureResult(overrides?: Partial<E2EScenarioResult>): E2EScenarioResult {
  return {
    fixtureId: 'file-write-read',
    conversationId: 'e2e-file-write-read',
    toolCalls: [{ id: 'tc-1', name: 'write_file', arguments: '{}' }],
    toolResults: [],
    graphSnapshots: [{ status: 'finalized' } as E2EScenarioResult['graphSnapshots'][number]],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      totalTokens: 125,
      eventCount: 1,
    },
    errors: [],
    completed: true,
    durationMs: 1200,
    userTurnCount: 1,
    turnTraces: [],
    ...overrides,
  };
}

describe('e2eRunReport', () => {
  beforeEach(() => {
    resetE2ENativeMobileFixtures();
  });

  it('buildE2ERunReportScenarioEntry captures structural scenario fields', () => {
    const result = buildFixtureResult({
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 0,
        totalTokens: 125,
        eventCount: 1,
        tokenBuckets: TOKEN_BUCKETS,
        promptCache: {
          eligibleTurnCount: 1,
          enabledTurnCount: 1,
          skippedTurnCount: 0,
          createEventCount: 0,
          reuseEventCount: 0,
          providerManagedEventCount: 1,
          thresholdTokens: [4096],
          explicitCacheNames: ['cm:test'],
          reasonCounts: [{ reason: 'automatic_prompt_cache', count: 1 }],
          events: [
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 4096,
              thresholdTokens: 4096,
              providerFamily: 'openai',
              hostedFamily: 'openai',
              mode: 'openai_native',
              event: 'provider_managed',
              reason: 'automatic_prompt_cache',
              explicitCacheName: 'cm:test',
            },
          ],
        },
      },
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
      rubrics: [
        { kind: 'graph_terminal_success' },
        { kind: 'workspace_file', path: 'artifacts/e2e.txt', contains: 'E2E-FILE-42' },
      ],
    });

    expect(entry).toMatchObject({
      suite: 'core',
      fixtureId: 'file-write-read',
      passed: true,
      attemptCount: 1,
      graphStatus: 'finalized',
      toolCallCount: 1,
      rubricPassed: 1,
      rubricTotal: 2,
      failedRubrics: [
        expect.objectContaining({
          fixtureId: 'file-write-read:workspace_file',
          detail: expect.stringContaining('artifacts/e2e.txt'),
        }),
      ],
    });
    expect(entry.cache.cacheReadRate).toBeCloseTo(0.05);
    expect(entry.tokenBuckets).toEqual(TOKEN_BUCKETS);
    expect(entry.promptCache).toMatchObject({
      eligibleTurnCount: 1,
      providerManagedEventCount: 1,
      thresholdTokens: [4096],
      explicitCacheNames: ['cm:test'],
    });
    expect(entry.loopDiagnostics).toMatchObject({
      repeatedCatalogAfterActivationCount: 0,
      repeatedToolCalls: [],
      repeatedHoldReasons: [],
      passing: true,
    });
    expect(entry.rubricAudit).toMatchObject({
      rubricCount: 2,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
    });
    expect(entry.trace).toMatchObject({
      schemaVersion: 'e2e-redacted-trace-v1',
      fixtureId: 'file-write-read',
      toolCallCount: 1,
      graphStatus: 'finalized',
    });
    expect(entry.trace?.toolCalls[0]).toMatchObject({
      name: 'write_file',
      argumentKeys: [],
    });
  });

  it('redacts trace arguments and tool results while retaining structural fields', () => {
    const result = buildFixtureResult({
      fixtureId: 'trace-redaction',
      conversationId: 'private-conversation-id',
      toolCalls: [
        {
          id: 'tc-secret',
          name: 'native_secret_tool',
          arguments: '{"recipient":"SECRET-ARGUMENT-VALUE","count":1}',
        },
      ],
      toolResults: [
        {
          toolCallId: 'tc-secret',
          name: 'native_secret_tool',
          content: '{"status":"completed","id":"safe-fixture-id","secret":"SECRET-RESULT-VALUE"}',
          isError: false,
        },
        {
          toolCallId: 'tc-goals',
          name: 'update_goals',
          content: JSON.stringify({
            status: 'failed',
            action: 'complete',
            errors: ['SECRET-GOAL-ERROR'],
            structuredErrors: [
              { code: 'evidence_required', detail: 'SECRET-STRUCTURED-DETAIL' },
              { code: 'invalid_lifecycle', detail: 'SECRET-LIFECYCLE-DETAIL' },
            ],
            goals: [
              {
                id: 'goal-a',
                status: 'active',
              },
            ],
          }),
          isError: false,
        },
      ],
      graphSnapshots: [
        {
          status: 'awaiting_review',
          iteration: 1,
          audit: [
            {
              type: 'TOOL_SURFACE_SELECTED',
              timestamp: 1,
              iteration: 1,
              detail: 'count:1,tokens:10,tools:native_secret_tool',
            },
          ],
          goals: [
            {
              id: 'goal-a',
              title: 'goal-a',
              status: 'active',
              dependencies: [],
              evidence: [
                'native_secret_tool:SECRET-EVIDENCE-VALUE',
                'native_secret_tool:SECOND-SECRET-EVIDENCE-VALUE',
              ],
              successCriteria: ['evidence.tool:native_secret_tool'],
              completionPolicy: 'blocking',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          expectedToolCalls: [],
          observedToolResults: [],
          pendingAsyncCount: 0,
          lastModelToolNames: ['native_secret_tool'],
          asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [], updatedAt: 1 },
          performance: {
            modelTurnCount: 1,
            modelDurationMs: 0,
            toolExecutionCount: 0,
            toolExecutionDurationMs: 0,
            lastCandidateToolCount: 1,
            lastActiveToolCount: 1,
            maxActiveToolCount: 1,
            lastActiveToolTokenEstimate: 10,
            maxActiveToolTokenEstimate: 10,
            updatedAt: 1,
          },
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 0,
          },
          updatedAt: 1,
          version: 1,
        },
      ],
      turnTraces: [],
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'trace-redaction', passed: false },
      attemptCount: 1,
      rubrics: [{ kind: 'graph_terminal_success' }],
    });

    const serializedTrace = JSON.stringify(entry.trace);
    expect(serializedTrace).not.toContain('SECRET-ARGUMENT-VALUE');
    expect(serializedTrace).not.toContain('SECRET-RESULT-VALUE');
    expect(serializedTrace).not.toContain('SECRET-EVIDENCE-VALUE');
    expect(serializedTrace).not.toContain('SECOND-SECRET-EVIDENCE-VALUE');
    expect(serializedTrace).not.toContain('SECRET-GOAL-ERROR');
    expect(serializedTrace).not.toContain('SECRET-STRUCTURED-DETAIL');
    expect(serializedTrace).not.toContain('SECRET-LIFECYCLE-DETAIL');
    expect(serializedTrace).not.toContain('private-conversation-id');
    expect(entry.trace?.toolCalls[0]).toMatchObject({
      name: 'native_secret_tool',
      argumentKeys: ['count', 'recipient'],
      argumentsHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
    });
    expect(entry.trace?.toolResults[0]).toMatchObject({
      name: 'native_secret_tool',
      statusFields: [
        expect.objectContaining({
          fieldPath: 'status',
          preview: 'completed',
        }),
      ],
    });
    expect(entry.trace?.toolResults[1]).toMatchObject({
      name: 'update_goals',
      updateGoalsResult: {
        status: 'failed',
        action: 'complete',
        errorCount: 1,
        structuredErrorCodes: ['evidence_required', 'invalid_lifecycle'],
        goalIdsByStatus: {
          pending: [],
          active: ['goal-a'],
          completed: [],
          blocked: [],
        },
      },
    });
    expect(entry.trace?.graphSnapshots[0]?.goalSummaries).toEqual([
      expect.objectContaining({
        id: 'goal-a',
        status: 'active',
        completionPolicy: 'blocking',
        evidenceCount: 2,
        evidencePrefixCounts: [{ prefix: 'native_secret_tool', count: 2 }],
        successCriteria: [
          expect.objectContaining({
            preview: 'evidence.tool:native_secret_tool',
          }),
        ],
      }),
    ]);
    expect(entry.trace?.graphSnapshots[0]?.selectedToolSurfaceEvents).toHaveLength(1);
  });

  it('captures final native fixture state as redacted primitive diagnostics', async () => {
    const previousRuntimeFlag = process.env.RUN_E2E_AGENT_EVAL;
    process.env.RUN_E2E_AGENT_EVAL = '1';
    try {
      await tryExecuteE2ENativeMobileTool('contacts_search', '{"query":"Avery"}');
      await tryExecuteE2ENativeMobileTool(
        'sms_compose',
        '{"recipients":["+15550100"],"message":"TRACE-MESSAGE"}',
      );
      const entry = buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult({
          fixtureId: 'native-fixture-diagnostics',
          conversationId: 'native-fixture-diagnostics',
        }),
        outcome: { fixtureId: 'native-fixture-diagnostics', passed: false },
        attemptCount: 1,
      });

      expect(entry.trace?.nativeFixtureState).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: 'contacts.resultCount',
            preview: 1,
          }),
          expect.objectContaining({
            fieldPath: 'sms.opened',
            preview: true,
          }),
          expect.objectContaining({
            fieldPath: 'sms.recipientCount',
            preview: 1,
          }),
        ]),
      );
      expect(JSON.stringify(entry.trace)).not.toContain('TRACE-MESSAGE');
    } finally {
      if (previousRuntimeFlag === undefined) {
        delete process.env.RUN_E2E_AGENT_EVAL;
      } else {
        process.env.RUN_E2E_AGENT_EVAL = previousRuntimeFlag;
      }
      resetE2ENativeMobileFixtures();
    }
  });

  it('buildE2ERunReport aggregates totals and pass counts', () => {
    const passEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const failEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult({
        fixtureId: 'goal-evidence-complete',
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 60,
          eventCount: 1,
        },
      }),
      outcome: {
        fixtureId: 'goal-evidence-complete',
        passed: false,
        detail: 'tool write_file called 0 times',
      },
      attemptCount: 2,
    });

    const report = buildE2ERunReport([passEntry, failEntry], {
      generatedAt: '2026-06-10T00:00:00.000Z',
      maxScenarioRetries: 1,
      runMetadata: {
        gitSha: 'test-sha',
        model: 'gemini-3.5-flash',
        providerBaseUrl: 'https://aiplatform.googleapis.com/v1',
        collectMode: true,
      },
    });

    expect(report.totals).toMatchObject({
      scenarioCount: 2,
      passedCount: 1,
      failedCount: 1,
      inputTokens: 150,
      outputTokens: 30,
      totalTokens: 185,
      durationMs: 2400,
    });
    expect(report.maxScenarioRetries).toBe(1);
    expect(report.runMetadata).toMatchObject({
      gitSha: 'test-sha',
      model: 'gemini-3.5-flash',
      collectMode: true,
      scenarioManifestVersion: E2E_SCENARIO_MANIFEST_VERSION,
    });
    expect(report.cache).toMatchObject({
      inputTokens: 150,
      eligibleInputTokens: 0,
      passing: false,
      promptCacheTelemetry: {
        eligibleTurnCount: 0,
        enabledTurnCount: 0,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 0,
        thresholdTokens: [],
        explicitCacheNameCount: 0,
        reasonCounts: [],
      },
    });
    expect(report.graderAudit).toMatchObject({
      scenarioCount: 2,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      passing: true,
    });
    expect(report.reliability).toMatchObject({
      k: 2,
      scenarioCount: 2,
      pass1PassedCount: 1,
      passKPassedCount: 1,
      retriedScenarioCount: 1,
    });
    expect(report.readiness.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('scenario_pass_rate');
    expect(report.readiness.failedCriteria).toContain('pass1_reliability');
    expect(report.assessment.scenarioCount).toBe(2);
    expect(report.assessment.overallScenarioPassRate).toBe(0.5);
    expect(formatE2ERunReportSummary(report)).toContain('scenarios=1/2 passed');
    expect(formatE2ERunReportSummary(report)).toContain('reliability pass1=1/2 pass^2=1/2');
    expect(formatE2ERunReportSummary(report)).toContain('readiness=false');
    expect(formatE2ERunReportSummary(report)).toContain('assessment evidenceScore=');
  });

  it('keeps pass^1 reliability separate from retry-assisted pass^k', () => {
    const retriedPassEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 2,
    });

    const report = buildE2ERunReport([retriedPassEntry], {
      maxScenarioRetries: 2,
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.reliability).toMatchObject({
      k: 3,
      scenarioCount: 1,
      pass1PassedCount: 0,
      passKPassedCount: 1,
      pass1Rate: 0,
      passKRate: 1,
      retriedScenarioCount: 1,
    });
    expect(report.readiness.failedCriteria).toContain('pass1_reliability');
    expect(report.readiness.failedCriteria).not.toContain('scenario_pass_rate');
  });

  it('reports cache readiness from eligible input instead of any cache hit', () => {
    const usage = {
      inputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      outputTokens: 10,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS + 10,
      eventCount: 1,
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache.eligibleInputTokens).toBe(E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS);
    expect(report.cache.cacheReadTokens).toBe(100);
    expect(report.cache.passing).toBe(false);
    expect(report.cache.cacheCreateTelemetryAvailable).toBe(true);
    expect(report.metricsPassing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
    expect(report.readiness.failedCriteria).not.toContain('cache_create_telemetry');
  });

  it('uses provider prompt-cache telemetry instead of aggregate scenario input for eligibility', () => {
    const usage = {
      inputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 2,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 2 + 10,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 0,
        enabledTurnCount: 0,
        skippedTurnCount: 2,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 0,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'below_threshold', count: 2 }],
        events: [
          {
            eligible: false,
            enabled: false,
            estimatedInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS - 200,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'skip',
            reason: 'below_threshold',
          },
          {
            eligible: false,
            enabled: false,
            estimatedInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS - 100,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'skip',
            reason: 'below_threshold',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(entry.cache.eligibleInputTokens).toBe(0);
    expect(report.cache.eligibleInputTokens).toBe(0);
    expect(report.cache.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
  });

  it('caps telemetry-estimated eligible input at actual provider input tokens', () => {
    const usage = {
      inputTokens: 4096,
      outputTokens: 10,
      cacheReadTokens: 2048,
      cacheWriteTokens: 0,
      totalTokens: 4106,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'gemini_implicit_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(entry.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(0.5);
  });

  it('counts provider-managed cache reuse across turn traces from scenario telemetry', () => {
    const firstEvent = {
      eligible: true,
      enabled: true,
      estimatedInputTokens: 4096,
      thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      providerFamily: 'openai',
      hostedFamily: 'openai',
      mode: 'openai_native' as const,
      event: 'provider_managed' as const,
      reason: 'automatic_prompt_cache',
      explicitCacheName: 'cm:openai-cross-turn',
      stableSystemPromptDigest: 'system-prompt:stable',
      stableToolDeclarationDigest: 'tools:stable',
      cacheablePrefixDigest: 'prompt-prefix:stable',
      toolDeclarationDigest: 'tools:stable',
      prefixDivergenceReason: 'fully_stable_prefix' as const,
    };
    const secondEvent = {
      ...firstEvent,
      estimatedInputTokens: 4096,
    };
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 2048,
      cacheWriteTokens: 0,
      totalTokens: 8202,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: ['cm:openai-cross-turn'],
        reasonCounts: [{ reason: 'automatic_prompt_cache', count: 2 }],
        events: [firstEvent, secondEvent],
      },
    };
    const result = buildFixtureResult({
      usage,
      turnTraces: [
        {
          turnIndex: 0,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          completed: true,
          usage: {
            ...usage,
            inputTokens: 4096,
            outputTokens: 5,
            cacheReadTokens: 0,
            totalTokens: 4101,
            eventCount: 1,
            promptCache: {
              ...usage.promptCache,
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              providerManagedEventCount: 1,
              events: [firstEvent],
            },
          },
        },
        {
          turnIndex: 1,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          completed: true,
          usage: {
            ...usage,
            inputTokens: 4096,
            outputTokens: 5,
            cacheReadTokens: 2048,
            totalTokens: 4101,
            eventCount: 1,
            promptCache: {
              ...usage.promptCache,
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              providerManagedEventCount: 1,
              events: [secondEvent],
            },
          },
        },
      ],
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(entry.cache.eligibleInputTokens).toBe(4096);
    expect(entry.cache.providerManagedReadinessTokens).toBe(4096);
    expect(entry.cache.eligibleCacheReadRate).toBe(0.5);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(0.5);
  });

  it('caps eligible cache read rate at eligible input tokens', () => {
    const usage = {
      inputTokens: 4096,
      outputTokens: 10,
      cacheReadTokens: 8192,
      cacheWriteTokens: 0,
      totalTokens: 4106,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'automatic_prompt_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'openai',
            hostedFamily: 'openai',
            mode: 'openai_native',
            event: 'provider_managed',
            reason: 'automatic_prompt_cache',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'openai',
            hostedFamily: 'openai',
            mode: 'openai_native',
            event: 'provider_managed',
            reason: 'automatic_prompt_cache',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(report.cache.cacheReadTokens).toBe(8192);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(1);
    expect(entry.cache.eligibleCacheReadRate).toBe(1);
  });

  it('passes cache readiness for repeated provider-managed opportunities without real reads', () => {
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 8202,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'gemini_implicit_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
            stableSystemPromptDigest: 'system-prompt:test',
            stableToolDeclarationDigest: 'tools:stable',
            cacheablePrefixDigest: 'prompt-prefix:test',
            toolDeclarationDigest: 'tools:test',
            prefixDivergenceReason: 'stable_prefix_with_dynamic_suffix',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
            stableSystemPromptDigest: 'system-prompt:test',
            stableToolDeclarationDigest: 'tools:stable',
            cacheablePrefixDigest: 'prompt-prefix:test',
            toolDeclarationDigest: 'tools:test',
            prefixDivergenceReason: 'stable_prefix_with_dynamic_suffix',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(report.cache.cacheReadTokens).toBe(0);
    expect(report.cache.eligibleCacheReadRate).toBe(0);
    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.providerManagedReadinessObserved).toBe(true);
    expect(report.cache.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
  });

  it('counts repeated provider-managed opportunities by stable prefix even when all tools are dynamic suffixes', () => {
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 8202,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'gemini_implicit_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
            stableSystemPromptDigest: 'system-prompt:stable',
            stableToolDeclarationDigest: 'tools:empty-stable',
            cacheablePrefixDigest: 'prompt-prefix:stable',
            toolDeclarationDigest: 'tools:dynamic-a',
            prefixDivergenceReason: 'no_stable_tool_prefix',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
            stableSystemPromptDigest: 'system-prompt:stable',
            stableToolDeclarationDigest: 'tools:empty-stable',
            cacheablePrefixDigest: 'prompt-prefix:stable',
            toolDeclarationDigest: 'tools:dynamic-b',
            prefixDivergenceReason: 'no_stable_tool_prefix',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.promptCacheTelemetry.prefixStability).toMatchObject({
      uniqueStableSystemPromptDigestCount: 1,
      uniqueStableToolDeclarationDigestCount: 1,
      uniqueCacheablePrefixDigestCount: 1,
      uniqueToolDeclarationDigestCount: 2,
      longestStableSystemPromptRun: 2,
      longestStableToolDeclarationRun: 2,
      longestCacheablePrefixRun: 2,
      longestToolDeclarationRun: 1,
    });
  });

  it('aggregates prompt cache telemetry and token buckets into the cache report', () => {
    const result = buildFixtureResult({
      usage: {
        inputTokens: 4096,
        outputTokens: 20,
        cacheReadTokens: 1024,
        cacheWriteTokens: 0,
        totalTokens: 4116,
        eventCount: 2,
        tokenBuckets: TOKEN_BUCKETS,
        promptCache: {
          eligibleTurnCount: 2,
          enabledTurnCount: 2,
          skippedTurnCount: 0,
          createEventCount: 1,
          reuseEventCount: 1,
          providerManagedEventCount: 0,
          thresholdTokens: [4096],
          explicitCacheNames: ['projects/test/cachedContents/1'],
          reasonCounts: [
            { reason: 'gemini_created', count: 1 },
            { reason: 'gemini_memory_cache_entry', count: 1 },
          ],
          events: [
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 5000,
              thresholdTokens: 4096,
              providerFamily: 'gemini',
              hostedFamily: 'gemini',
              mode: 'gemini_native',
              event: 'create',
              reason: 'gemini_created',
              explicitCacheName: 'projects/test/cachedContents/1',
              stableSystemPromptDigest: 'system-prompt:test-a',
              stableToolDeclarationDigest: 'stable-tools:test-a',
              cacheablePrefixDigest: 'prompt-prefix:test-a',
              toolDeclarationDigest: 'tools:test-a',
            },
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 5000,
              thresholdTokens: 4096,
              providerFamily: 'gemini',
              hostedFamily: 'gemini',
              mode: 'gemini_native',
              event: 'reuse',
              reason: 'gemini_memory_cache_entry',
              explicitCacheName: 'projects/test/cachedContents/1',
              stableSystemPromptDigest: 'system-prompt:test-a',
              stableToolDeclarationDigest: 'stable-tools:test-a',
              cacheablePrefixDigest: 'prompt-prefix:test-a',
              toolDeclarationDigest: 'tools:test-b',
            },
          ],
        },
      },
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: result.fixtureId, passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 1,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache.promptCacheTelemetry).toMatchObject({
      eligibleTurnCount: 2,
      enabledTurnCount: 2,
      skippedTurnCount: 0,
      createEventCount: 1,
      reuseEventCount: 1,
      providerManagedEventCount: 0,
      thresholdTokens: [4096],
      explicitCacheNameCount: 1,
      reasonCounts: [
        { reason: 'gemini_created', count: 1 },
        { reason: 'gemini_memory_cache_entry', count: 1 },
      ],
      prefixStability: {
        eventCount: 2,
        stableSystemPromptDigestEventCount: 2,
        stableToolDeclarationDigestEventCount: 2,
        cacheablePrefixDigestEventCount: 2,
        toolDeclarationDigestEventCount: 2,
        uniqueStableSystemPromptDigestCount: 1,
        uniqueStableToolDeclarationDigestCount: 1,
        uniqueCacheablePrefixDigestCount: 1,
        uniqueToolDeclarationDigestCount: 2,
        longestStableSystemPromptRun: 2,
        longestStableToolDeclarationRun: 2,
        longestCacheablePrefixRun: 2,
        longestToolDeclarationRun: 1,
      },
    });
    expect(report.cache.scenarios[0]).toMatchObject({
      fixtureId: 'file-write-read',
      tokenBuckets: TOKEN_BUCKETS,
      promptCache: {
        eligibleTurnCount: 2,
        createEventCount: 1,
        reuseEventCount: 1,
      },
    });
  });

  it('surfaces discovery loops after session-level tool activation', () => {
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
      ],
      graphSnapshots: [
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [{ id: 'tc-1', name: 'tool_catalog' }],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: result.fixtureId, passed: true }],
      metricResults: [result],
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedCatalogAfterActivationCount: 2,
      repeatedToolCalls: [
        expect.objectContaining({
          name: 'tool_catalog',
          count: 2,
          noNewEvidence: true,
        }),
      ],
      passing: false,
    });
    expect(report.readiness.failedCriteria).toContain('loop_diagnostics');
  });

  it('does not classify pre-activation discovery fanout as post-activation catalog looping', () => {
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
      ],
      graphSnapshots: [
        {
          status: 'running',
          sessionActivatedToolNames: [],
          observedToolResults: [{ id: 'tc-1', name: 'tool_catalog' }],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          sessionActivatedToolNames: [],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedCatalogAfterActivationCount: 0,
      repeatedToolCalls: [
        expect.objectContaining({
          name: 'tool_catalog',
          count: 2,
          noNewEvidence: true,
        }),
      ],
      passing: true,
    });
  });

  it('counts repeated finalization holds by hold episode instead of snapshot retention', () => {
    const result = buildFixtureResult({
      graphSnapshots: [
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedHoldReasons: [{ reason: 'goals_incomplete', count: 2 }],
      passing: true,
    });
  });

  it('reports provider cache-create failures without deriving them from scenario outcomes', () => {
    const result = buildFixtureResult();
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      cacheTelemetry: {
        cacheCreateAttempts: 3,
        cacheCreateFailureCount: 2,
        cacheCreateFailuresByProviderStatus: [
          { providerStatus: '400', count: 1 },
          { providerStatus: 'network_error', count: 1 },
        ],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache).toMatchObject({
      cacheCreateAttempts: 3,
      cacheCreateFailureCount: 2,
      cacheCreateFailuresByProviderStatus: [
        { providerStatus: '400', count: 1 },
        { providerStatus: 'network_error', count: 1 },
      ],
      cacheCreateTelemetryAvailable: true,
    });
  });

  it('recordE2ERunReportEntry and flushE2ERunReport write JSON artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-report-'));
    const reportPath = join(dir, 'e2e-agent-report.json');
    const env = {
      E2E_REPORT_PATH: reportPath,
      E2E_MAX_SCENARIO_RETRIES: '1',
    };

    try {
      const passEntry = buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult(),
        outcome: { fixtureId: 'file-write-read', passed: true },
        attemptCount: 1,
      });
      const failEntry = buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult({
          fixtureId: 'goal-evidence-complete',
          toolCalls: [
            {
              id: 'tc-catalog',
              name: 'tool_catalog',
              arguments: '{"query":"SECRET-TRACE-ARG","category":"memory"}',
            },
            {
              id: 'tc-private',
              name: 'write_file',
              arguments: '{"path":"artifacts/private.txt","content":"SECRET-TRACE-ARG"}',
            },
          ],
          toolResults: [
            {
              toolCallId: 'tc-catalog',
              name: 'tool_catalog',
              content: JSON.stringify({
                mode: 'search',
                category: 'memory',
                query: 'SECRET-TRACE-RESULT',
                tools: [
                  {
                    name: 'memory_recall',
                    activation: { name: 'memory_recall', eligible: true },
                  },
                ],
                totalMatches: 1,
              }),
              isError: false,
            },
            {
              toolCallId: 'tc-private',
              name: 'write_file',
              content: '{"status":"failed","secret":"SECRET-TRACE-RESULT"}',
              isError: true,
            },
          ],
        }),
        outcome: {
          fixtureId: 'goal-evidence-complete',
          passed: false,
          detail: 'workspace artifact missing',
        },
        attemptCount: 1,
        rubrics: [
          {
            kind: 'workspace_file',
            path: 'artifacts/private.txt',
            contains: 'SECRET-TRACE-RESULT',
          },
        ],
      });

      recordE2ERunReportEntry(passEntry, env);
      recordE2ERunReportEntry(failEntry, env);

      const report = flushE2ERunReport(env);
      expect(report).not.toBeNull();
      expect(report?.scenarios).toHaveLength(2);

      const persisted = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        scenarios: Array<{
          fixtureId: string;
          trace?: unknown;
          traceArtifact?: { path: string; retentionReason: string };
        }>;
        runMetadata: { model: string; scenarioManifestVersion: string };
        reliability: { pass1PassedCount: number; passKPassedCount: number };
        cache: { passing: boolean };
        graderAudit: { passing: boolean };
        readiness: { passing: boolean };
        readinessDashboard: {
          overall: { passing: boolean };
          benchmarkRequirements: { externalRequired: number };
        };
      };
      expect(persisted.scenarios[0]?.fixtureId).toBe('file-write-read');
      const persistedPass = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'file-write-read',
      );
      const persistedFailure = persisted.scenarios.find(
        (scenario) => scenario.fixtureId === 'goal-evidence-complete',
      );
      expect(persistedPass?.traceArtifact).toMatchObject({
        retentionReason: 'sampled_pass',
      });
      expect(persistedFailure?.traceArtifact).toMatchObject({
        retentionReason: 'failed',
      });
      expect(persistedPass?.trace).toBeUndefined();
      expect(persistedFailure?.trace).toBeUndefined();
      expect(existsSync(persistedPass!.traceArtifact!.path)).toBe(true);
      expect(existsSync(persistedFailure!.traceArtifact!.path)).toBe(true);
      const failedTrace = readFileSync(persistedFailure!.traceArtifact!.path, 'utf8');
      expect(failedTrace).toContain('goal-evidence-complete');
      expect(failedTrace).toContain('"toolCatalogResult"');
      expect(failedTrace).toContain('"memory_recall"');
      expect(failedTrace).toContain('"totalMatches": 1');
      expect(failedTrace).not.toContain('SECRET-TRACE-ARG');
      expect(failedTrace).not.toContain('SECRET-TRACE-RESULT');
      expect(persisted.runMetadata.model).toBeTruthy();
      expect(persisted.runMetadata.scenarioManifestVersion).toBe(E2E_SCENARIO_MANIFEST_VERSION);
      expect(persisted.reliability).toMatchObject({
        pass1PassedCount: 1,
        passKPassedCount: 1,
      });
      expect(persisted.cache.passing).toBe(false);
      expect(persisted.graderAudit.passing).toBe(true);
      expect(persisted.readiness.passing).toBe(false);
      expect(persisted.readinessDashboard.overall.passing).toBe(false);

      const dashboardPath = `${reportPath}.dashboard.json`;
      expect(existsSync(dashboardPath)).toBe(true);
      const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
        benchmarkRequirements: { externalRequired: number };
      };
      expect(dashboard.benchmarkRequirements.externalRequired).toBeGreaterThan(0);

      const retentionIndexPath = join(dir, 'e2e-readiness-runs', 'index.json');
      expect(existsSync(retentionIndexPath)).toBe(true);
      const retentionIndex = JSON.parse(readFileSync(retentionIndexPath, 'utf8')) as {
        retainedRunCount: number;
        runs: Array<{ dashboardPath: string; reportPath: string }>;
      };
      expect(retentionIndex.retainedRunCount).toBe(1);
      expect(existsSync(retentionIndex.runs[0]!.dashboardPath)).toBe(true);
      expect(existsSync(retentionIndex.runs[0]!.reportPath)).toBe(true);
      expect(existsSync(join(dirname(persistedFailure!.traceArtifact!.path), 'index.json'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
