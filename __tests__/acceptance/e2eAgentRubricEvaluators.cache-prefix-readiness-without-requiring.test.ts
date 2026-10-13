import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import {
  resetE2ENativeMobileFixtures,
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
  tryExecuteE2ENativeMobileTool,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { buildE2ERubricResult as buildResult } from '../helpers/e2eRubricResult';

describe('evaluateE2ERubric', () => {
  beforeEach(() => {
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
    resetE2ENativeMobileFixtures();
    delete process.env.RUN_E2E_AGENT_EVAL;
  });
  it('checks cache_prefix_readiness without requiring provider read telemetry', () => {
    const result = buildResult({
      turnTraces: [
        {
          turnIndex: 0,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          usage: {
            inputTokens: 5000,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 5001,
            eventCount: 1,
            promptCache: {
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              skippedTurnCount: 0,
              createEventCount: 0,
              reuseEventCount: 0,
              providerManagedEventCount: 1,
              thresholdTokens: [4096],
              explicitCacheNames: [],
              reasonCounts: [],
              events: [
                {
                  eligible: true,
                  enabled: true,
                  estimatedInputTokens: 5000,
                  thresholdTokens: 4096,
                  providerFamily: 'openai',
                  mode: 'openai_native',
                  event: 'provider_managed',
                  reason: 'automatic_prompt_cache',
                  cacheablePrefixDigest: 'prefix-a',
                },
              ],
            },
          },
          completed: true,
        },
        {
          turnIndex: 1,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          usage: {
            inputTokens: 5000,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 5001,
            eventCount: 1,
            promptCache: {
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              skippedTurnCount: 0,
              createEventCount: 0,
              reuseEventCount: 0,
              providerManagedEventCount: 1,
              thresholdTokens: [4096],
              explicitCacheNames: [],
              reasonCounts: [],
              events: [
                {
                  eligible: true,
                  enabled: true,
                  estimatedInputTokens: 5000,
                  thresholdTokens: 4096,
                  providerFamily: 'openai',
                  mode: 'openai_native',
                  event: 'provider_managed',
                  reason: 'automatic_prompt_cache',
                  cacheablePrefixDigest: 'prefix-a',
                },
              ],
            },
          },
          completed: true,
        },
      ],
    });

    const outcome = evaluateE2ERubric(result, {
      kind: 'cache_prefix_readiness',
      minEligibleInputTokens: 4000,
      minEligibleTurns: 1,
      afterWarmupTurns: 1,
    });
    expect(outcome).toMatchObject({
      passed: true,
      detail: 'cache prefix readiness 1 turns 5000 tokens',
    });
  });
  it('checks native_fixture_state from deterministic native side effects', async () => {
    process.env.RUN_E2E_AGENT_EVAL = '1';
    const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
    await tryExecuteE2ENativeMobileTool('device_query', '{"kind":"permissions"}');
    const native = {
      stateBefore,
      stateAfter: getE2ENativeMobileFixtureStateSnapshot(),
      invocations: getE2ENativeMobileInvocationSnapshots(),
    };
    resetE2ENativeMobileFixtures();

    const outcome = evaluateE2ERubric(
      buildResult({
        turnTraces: [{ native } as E2EScenarioResult['turnTraces'][number]],
      }),
      {
        kind: 'native_fixture_state',
        path: 'permissions.location',
        expectedValue: 'denied',
      },
    );
    expect(outcome.passed).toBe(true);
  });
  it('checks file_hash against workspace content', () => {
    const conversationId = 'conv-hash';
    const store = jest.requireMock('expo-file-system').__getStore() as Record<string, string>;
    store[`file:///mock/documents/workspace/${conversationId}/artifacts/e2e.txt`] = 'E2E-FILE-42';

    const outcome = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'file_hash',
      path: 'artifacts/e2e.txt',
      expectedHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    expect(outcome.passed).toBe(false);

    const { createHash } = require('crypto');
    const expectedHash = createHash('sha256').update('E2E-FILE-42').digest('hex');
    const passing = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'file_hash',
      path: 'artifacts/e2e.txt',
      expectedHash,
    });
    expect(passing.passed).toBe(true);
  });
  it('checks graph_audit_observed from graph audit trail', () => {
    const outcome = evaluateE2ERubric(
      buildResult({
        graphSnapshots: [
          {
            version: 1,
            status: 'finalized',
            iteration: 1,
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false },
            performance: {
              modelTurnCount: 1,
              modelDurationMs: 1,
              toolExecutionCount: 0,
              toolExecutionDurationMs: 0,
              lastCandidateToolCount: 0,
              lastActiveToolCount: 0,
              maxActiveToolCount: 0,
            },
            turnDirectives: {},
            audit: [
              {
                type: 'TOOL_SURFACE_TOKEN_AUDIT',
                timestamp: 1,
                detail: 'count:3,tokens:120,sessionPinned:1,turnPinned:0',
              },
            ],
            updatedAt: 1,
          },
        ],
      }),
      {
        kind: 'graph_audit_observed',
        auditType: 'TOOL_SURFACE_TOKEN_AUDIT',
        detailContains: 'sessionPinned:',
      },
    );
    expect(outcome.passed).toBe(true);
  });
});
