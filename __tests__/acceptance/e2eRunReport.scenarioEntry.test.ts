import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import {
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeMobileTool,
} from '../../src/engine/tools/e2eNativeCalendarFixtures';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
  TOKEN_BUCKETS,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport scenario entries', () => {
  installE2ERunReportFixtureReset();

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
});
