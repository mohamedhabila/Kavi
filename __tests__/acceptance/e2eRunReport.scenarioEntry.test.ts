import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeMobileTool,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';

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
      schemaVersion: 'e2e-redacted-trace-v2',
      fixtureId: 'file-write-read',
      toolCallCount: 1,
      graphStatus: 'finalized',
    });
    expect(entry.trace?.toolCalls[0]).toMatchObject({
      name: 'write_file',
      nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      argumentFieldCount: 0,
      toolCallIdHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
    });
  });

  it('emits only hashes, counts, schemas, allowlisted tool names, and allowlisted enums', () => {
    const result = buildFixtureResult({
      fixtureId: 'trace-redaction',
      conversationId: 'private-conversation-id',
      toolCalls: [
        {
          id: 'PRIVATE-TOOL-CALL-ID-NEVER-EXPORT',
          name: 'native_secret_tool',
          arguments:
            '{"recipient":"SECRET-ARGUMENT-VALUE","count":1,"PRIVATE-ARGUMENT-FIELD-NEVER-EXPORT":true}',
        },
      ],
      toolResults: [
        {
          toolCallId: 'PRIVATE-TOOL-CALL-ID-NEVER-EXPORT',
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
              { code: 'PRIVATE-ERROR-CODE-NEVER-EXPORT', detail: 'SECRET-UNKNOWN-DETAIL' },
            ],
            goals: [
              {
                id: 'PRIVATE-GOAL-ID-NEVER-EXPORT',
                status: 'active',
              },
            ],
          }),
          isError: false,
        },
        {
          toolCallId: 'PRIVATE-STATUS-CALL-ID-NEVER-EXPORT',
          name: 'status_probe',
          content: JSON.stringify({
            status: 'PRIVATE-STATUS-NEVER-EXPORT',
            code: 'PRIVATE-CODE-NEVER-EXPORT',
            errorClass: 'PRIVATE-ERROR-CLASS-NEVER-EXPORT',
            error: 'PRIVATE-ERROR-PROSE-NEVER-EXPORT',
          }),
          isError: true,
        },
        {
          toolCallId: 'PRIVATE-CATALOG-CALL-ID-NEVER-EXPORT',
          name: 'tool_catalog',
          content: JSON.stringify({
            mode: 'PRIVATE-CATALOG-MODE-NEVER-EXPORT',
            category: 'PRIVATE-CATALOG-CATEGORY-NEVER-EXPORT',
            capabilities: ['read', 'PRIVATE-CAPABILITY-NEVER-EXPORT'],
            totalMatches: 1,
            tools: [{ name: 'safe_public_tool', activation: { name: 'safe_public_tool' } }],
          }),
          isError: false,
        },
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 0,
        totalTokens: 125,
        eventCount: 1,
        promptCache: {
          eligibleTurnCount: 1,
          enabledTurnCount: 1,
          skippedTurnCount: 0,
          createEventCount: 1,
          reuseEventCount: 0,
          providerManagedEventCount: 0,
          thresholdTokens: [1024],
          explicitCacheNames: ['PRIVATE-CACHE-NAME-NEVER-EXPORT'],
          reasonCounts: [{ reason: 'PRIVATE-CACHE-REASON-NEVER-EXPORT', count: 1 }],
          events: [
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 2048,
              thresholdTokens: 1024,
              providerFamily: 'PRIVATE-PROVIDER-FAMILY-NEVER-EXPORT',
              hostedFamily: 'PRIVATE-HOSTED-FAMILY-NEVER-EXPORT',
              mode: 'openai_native',
              event: 'create',
              reason: 'PRIVATE-CACHE-REASON-NEVER-EXPORT',
              explicitCacheName: 'PRIVATE-CACHE-NAME-NEVER-EXPORT',
              stableSystemPromptDigest: 'PRIVATE-SYSTEM-DIGEST-NEVER-EXPORT',
              stableToolDeclarationDigest: 'PRIVATE-TOOLS-DIGEST-NEVER-EXPORT',
              cacheablePrefixDigest: 'PRIVATE-PREFIX-DIGEST-NEVER-EXPORT',
              toolDeclarationDigest: 'PRIVATE-DECLARATION-DIGEST-NEVER-EXPORT',
              prefixDivergenceReason: 'fully_stable_prefix',
            },
          ],
        },
      },
      graphSnapshots: [
        {
          status: 'awaiting_review',
          iteration: 1,
          finalizationHoldReason: 'PRIVATE-HOLD-REASON-NEVER-EXPORT',
          terminalReason: 'PRIVATE-TERMINAL-REASON-NEVER-EXPORT',
          activeTaskId: 'PRIVATE-ACTIVE-TASK-ID-NEVER-EXPORT',
          audit: [
            {
              type: 'TOOL_SURFACE_SELECTED',
              timestamp: 1,
              iteration: 1,
              detail: 'PRIVATE-STRUCTURED-AUDIT-DETAIL-NEVER-EXPORT',
            },
            {
              type: 'PRIVATE-AUDIT-TYPE-NEVER-EXPORT',
              timestamp: 2,
              detail: 'PRIVATE-ARBITRARY-AUDIT-DETAIL-NEVER-EXPORT',
            },
          ],
          goals: [
            {
              id: 'PRIVATE-GOAL-ID-NEVER-EXPORT',
              title: 'PRIVATE-GOAL-TITLE-NEVER-EXPORT',
              status: 'active',
              dependencies: [],
              evidence: [
                'PRIVATE-EVIDENCE-SOURCE-NEVER-EXPORT:SECRET-EVIDENCE-VALUE',
                'PRIVATE-EVIDENCE-SOURCE-NEVER-EXPORT:SECOND-SECRET-EVIDENCE-VALUE',
              ],
              successCriteria: ['PRIVATE-SUCCESS-CRITERION-NEVER-EXPORT'],
              completionPolicy: 'blocking',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          expectedToolCalls: [
            { id: 'PRIVATE-EXPECTED-TOOL-CALL-ID-NEVER-EXPORT', name: 'native_secret_tool' },
          ],
          observedToolResults: [
            {
              id: 'PRIVATE-OBSERVED-TOOL-CALL-ID-NEVER-EXPORT',
              name: 'native_secret_tool',
              evidence: ['PRIVATE-OBSERVED-EVIDENCE-SOURCE-NEVER-EXPORT:value'],
            },
          ],
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
    expect(serializedTrace).not.toContain('SECRET-UNKNOWN-DETAIL');
    expect(serializedTrace).not.toContain('private-conversation-id');
    for (const sentinel of [
      'PRIVATE-TOOL-CALL-ID-NEVER-EXPORT',
      'PRIVATE-ARGUMENT-FIELD-NEVER-EXPORT',
      'PRIVATE-ERROR-CODE-NEVER-EXPORT',
      'PRIVATE-GOAL-ID-NEVER-EXPORT',
      'PRIVATE-STATUS-CALL-ID-NEVER-EXPORT',
      'PRIVATE-STATUS-NEVER-EXPORT',
      'PRIVATE-CODE-NEVER-EXPORT',
      'PRIVATE-ERROR-CLASS-NEVER-EXPORT',
      'PRIVATE-ERROR-PROSE-NEVER-EXPORT',
      'PRIVATE-CATALOG-CALL-ID-NEVER-EXPORT',
      'PRIVATE-CATALOG-MODE-NEVER-EXPORT',
      'PRIVATE-CATALOG-CATEGORY-NEVER-EXPORT',
      'PRIVATE-CAPABILITY-NEVER-EXPORT',
      'PRIVATE-CACHE-NAME-NEVER-EXPORT',
      'PRIVATE-CACHE-MODE-NEVER-EXPORT',
      'PRIVATE-CACHE-EVENT-NEVER-EXPORT',
      'PRIVATE-CACHE-REASON-NEVER-EXPORT',
      'PRIVATE-DIVERGENCE-REASON-NEVER-EXPORT',
      'PRIVATE-PROVIDER-FAMILY-NEVER-EXPORT',
      'PRIVATE-HOSTED-FAMILY-NEVER-EXPORT',
      'PRIVATE-SYSTEM-DIGEST-NEVER-EXPORT',
      'PRIVATE-TOOLS-DIGEST-NEVER-EXPORT',
      'PRIVATE-PREFIX-DIGEST-NEVER-EXPORT',
      'PRIVATE-DECLARATION-DIGEST-NEVER-EXPORT',
      'PRIVATE-HOLD-REASON-NEVER-EXPORT',
      'PRIVATE-TERMINAL-REASON-NEVER-EXPORT',
      'PRIVATE-ACTIVE-TASK-ID-NEVER-EXPORT',
      'PRIVATE-STRUCTURED-AUDIT-DETAIL-NEVER-EXPORT',
      'PRIVATE-AUDIT-TYPE-NEVER-EXPORT',
      'PRIVATE-ARBITRARY-AUDIT-DETAIL-NEVER-EXPORT',
      'PRIVATE-GOAL-TITLE-NEVER-EXPORT',
      'PRIVATE-EVIDENCE-SOURCE-NEVER-EXPORT',
      'PRIVATE-SUCCESS-CRITERION-NEVER-EXPORT',
      'PRIVATE-EXPECTED-TOOL-CALL-ID-NEVER-EXPORT',
      'PRIVATE-OBSERVED-TOOL-CALL-ID-NEVER-EXPORT',
      'PRIVATE-OBSERVED-EVIDENCE-SOURCE-NEVER-EXPORT',
      'native_secret_tool',
      'status_probe',
      'safe_public_tool',
    ]) {
      expect(serializedTrace).not.toContain(sentinel);
    }
    expect(entry.trace?.toolCalls[0]).toMatchObject({
      nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      argumentFieldCount: 3,
      toolCallIdHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      argumentsHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
    });
    expect(entry.trace?.toolCalls[0]).not.toHaveProperty('name');
    expect(entry.trace?.toolResults[0]).toMatchObject({
      nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      statusFields: [
        expect.objectContaining({
          fieldPath: 'status',
          enumValue: 'completed',
          valueHash: expect.stringContaining('sha256:'),
        }),
      ],
    });
    expect(entry.trace?.toolResults[0]).not.toHaveProperty('name');
    expect(entry.trace?.toolResults[1]).toMatchObject({
      name: 'update_goals',
      updateGoalsResult: {
        status: 'failed',
        action: 'complete',
        errorCount: 1,
        structuredErrorCodeCount: 3,
        structuredErrorCodes: ['evidence_required', 'invalid_lifecycle'],
        structuredErrorCodeHashes: expect.arrayContaining([
          expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        ]),
        goalIdHashesByStatus: {
          pending: [],
          active: [expect.objectContaining({ hash: expect.stringContaining('sha256:') })],
          completed: [],
          blocked: [],
        },
      },
    });
    expect(entry.trace?.toolResults[3]).toMatchObject({
      name: 'tool_catalog',
      toolCatalogResult: {
        capabilityCount: 2,
        capabilities: ['read'],
        capabilityHashes: expect.arrayContaining([
          expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        ]),
        toolNames: [],
        toolNameHashes: [expect.objectContaining({ hash: expect.stringContaining('sha256:') })],
        activationNames: [],
        activationNameHashes: [
          expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        ],
      },
    });
    expect(entry.trace?.graphSnapshots[0]).toMatchObject({
      expectedToolNames: [],
      expectedToolNameHashes: [
        expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      ],
      lastModelToolNames: [],
      lastModelToolNameHashes: [
        expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      ],
      observedToolResults: [
        expect.objectContaining({
          nameHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        }),
      ],
    });
    expect(entry.trace?.graphSnapshots[0]?.observedToolResults[0]).not.toHaveProperty('name');
    expect(entry.trace?.usage.promptCache).toMatchObject({
      reasonCounts: [
        expect.objectContaining({
          reasonHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
          count: 1,
        }),
      ],
      events: [
        expect.objectContaining({
          providerFamilyHash: expect.objectContaining({
            hash: expect.stringContaining('sha256:'),
          }),
          hostedFamilyHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
          reasonHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
          mode: 'openai_native',
          event: 'create',
          prefixDivergenceReason: 'fully_stable_prefix',
          stableSystemPromptDigestHash: expect.objectContaining({
            hash: expect.stringContaining('sha256:'),
          }),
        }),
      ],
    });
    expect(entry.trace?.graphSnapshots[0]?.goalSummaries).toEqual([
      expect.objectContaining({
        goalIdHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        status: 'active',
        completionPolicy: 'blocking',
        successCriteriaCount: 1,
        successCriteriaHashes: [
          expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
        ],
        evidenceCount: 2,
        evidenceSourceHashCounts: [
          expect.objectContaining({
            count: 2,
            valueHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
          }),
        ],
      }),
    ]);
    expect(entry.trace?.graphSnapshots[0]?.selectedToolSurfaceEvents).toHaveLength(1);
    expect(entry.trace?.graphSnapshots[0]?.auditEvents[1]).toMatchObject({
      type: 'OTHER',
      typeHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
      detailHash: expect.objectContaining({ hash: expect.stringContaining('sha256:') }),
    });
  });

  it('captures final native fixture state as redacted primitive diagnostics', async () => {
    const previousRuntimeFlag = process.env.RUN_E2E_AGENT_EVAL;
    process.env.RUN_E2E_AGENT_EVAL = '1';
    try {
      const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
      await tryExecuteE2ENativeMobileTool('contacts_search', '{"query":"Avery"}');
      await tryExecuteE2ENativeMobileTool(
        'sms_compose',
        '{"recipients":["+15550100"],"message":"TRACE-MESSAGE"}',
      );
      const native = {
        stateBefore,
        stateAfter: getE2ENativeMobileFixtureStateSnapshot(),
        invocations: getE2ENativeMobileInvocationSnapshots(),
      };
      resetE2ENativeMobileFixtures();
      const baseResult = buildFixtureResult({
        fixtureId: 'native-fixture-diagnostics',
        conversationId: 'native-fixture-diagnostics',
      });
      const result = buildFixtureResult({
        fixtureId: baseResult.fixtureId,
        conversationId: baseResult.conversationId,
        turnTraces: [
          {
            turnIndex: 0,
            lifecycleBefore: null,
            user: {
              messageId: 'native-fixture-user',
              text: 'Exercise native fixture diagnostics.',
              timestamp: 1,
            },
            route: { directive: 'forced_agentic', mode: 'agentic', personaId: 'super-agent' },
            finalAssistant: null,
            finalAssistantCandidateCount: 0,
            completion: {
              assistantStatus: 'missing',
              executionCompleted: true,
              finalResponseCompleted: false,
              runStatus: 'completed',
              runCompleted: true,
              runCompletedAt: null,
              runTerminalReason: null,
              graphStatus: 'finalized',
              graphTerminalReason: null,
            },
            agentRun: null,
            memory: [],
            memoryEvidence: {
              delta: {
                capturedAt: 1,
                facts: { createdIds: [], updatedIds: [], removedIds: [] },
                episodes: { createdIds: [], updatedIds: [], removedIds: [] },
                workingBlocks: { createdIds: [], updatedIds: [], removedIds: [] },
                ingestionJobs: { createdIds: [], updatedIds: [], removedIds: [] },
                invalidatedFactIds: [],
                deletedFactIds: [],
                deletedEpisodeIds: [],
                clearedWorkingBlockIds: [],
                completedIngestionJobIds: [],
              },
            },
            native,
            toolCalls: [],
            toolResults: [],
            graphSnapshots: [],
            usage: baseResult.usage,
            completed: true,
          },
        ],
      });
      const entry = buildE2ERunReportScenarioEntry({
        suite: 'core',
        result,
        outcome: { fixtureId: 'native-fixture-diagnostics', passed: false },
        attemptCount: 1,
      });

      expect(entry.trace?.nativeFixtureStateFingerprints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: 'contacts.resultCount',
            count: 1,
            valueHash: expect.stringContaining('sha256:'),
          }),
          expect.objectContaining({
            fieldPath: 'sms.opened',
            valueType: 'boolean',
            valueHash: expect.stringContaining('sha256:'),
          }),
          expect.objectContaining({
            fieldPath: 'sms.recipientCount',
            count: 1,
            valueHash: expect.stringContaining('sha256:'),
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
