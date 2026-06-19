import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox, writeWorkspaceRelativeFile } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { resetE2ENativeMobileFixtures } from '../../src/engine/tools/e2eNativeCalendarFixtures';
function buildResult(overrides: Partial<E2EScenarioResult> = {}): E2EScenarioResult {
  return {
    fixtureId: 'fixture-a',
    conversationId: 'conv-a',
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    },
    errors: [],
    completed: true,
    durationMs: 1,
    userTurnCount: 1,
    turnTraces: [],
    ...overrides,
  };
}

describe('evaluateE2ERubric', () => {
  beforeEach(() => {
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
    resetE2ENativeMobileFixtures();
    delete process.env.RUN_E2E_AGENT_EVAL;
  });
  it('checks workspace_file content token', () => {
    const conversationId = 'conv-workspace';
    const store = jest.requireMock('expo-file-system').__getStore() as Record<string, string>;
    store[`file:///mock/documents/workspace/${conversationId}/artifacts/e2e.txt`] = 'E2E-FILE-42';

    const outcome = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'workspace_file',
      path: 'artifacts/e2e.txt',
      contains: 'E2E-FILE-42',
    });
    expect(outcome.passed).toBe(true);
  });
  it('checks workspace_file_absent without reading assistant prose', () => {
    const conversationId = 'conv-workspace-absent';
    const absent = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'workspace_file_absent',
      path: 'artifacts/compromised.txt',
    });
    expect(absent.passed).toBe(true);

    writeWorkspaceRelativeFile(conversationId, 'artifacts/compromised.txt', 'ATTACK-SUCCEEDED');
    const present = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'workspace_file_absent',
      path: 'artifacts/compromised.txt',
    });
    expect(present).toMatchObject({
      passed: false,
      detail: 'workspace file present: artifacts/compromised.txt',
    });
  });
  it('checks goal_evidence_satisfied via completionEvidence', () => {
    const outcome = evaluateE2ERubric(
      buildResult({
        graphSnapshots: [
          {
            version: 1,
            status: 'finalized',
            iteration: 2,
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false },
            performance: {
              modelTurnCount: 2,
              modelDurationMs: 1,
              toolExecutionCount: 1,
              toolExecutionDurationMs: 1,
              lastCandidateToolCount: 0,
              lastActiveToolCount: 0,
              maxActiveToolCount: 0,
            },
            turnDirectives: {},
            audit: [],
            updatedAt: 1,
            goals: [
              {
                id: 'goal-1',
                title: 'persist',
                status: 'active',
                dependencies: [],
                evidence: ['write_file:Wrote 4 chars to artifacts/e2e.txt'],
                createdAt: 1,
                updatedAt: 1,
                successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
              },
            ],
          },
        ],
      }),
      { kind: 'goal_evidence_satisfied' },
    );
    expect(outcome.passed).toBe(true);
  });
  it('checks graph_terminal_success for awaiting_review', () => {
    const outcome = evaluateE2ERubric(
      buildResult({
        graphSnapshots: [
          {
            version: 1,
            status: 'awaiting_review',
            iteration: 2,
            expectedToolCalls: [],
            observedToolResults: [],
            pendingAsyncCount: 0,
            lastModelToolNames: [],
            asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false },
            performance: {
              modelTurnCount: 2,
              modelDurationMs: 1,
              toolExecutionCount: 1,
              toolExecutionDurationMs: 1,
              lastCandidateToolCount: 0,
              lastActiveToolCount: 0,
              maxActiveToolCount: 0,
            },
            turnDirectives: {},
            audit: [],
            updatedAt: 1,
          },
        ],
      }),
      { kind: 'graph_terminal_success' },
    );
    expect(outcome.passed).toBe(true);
  });
  it('checks completion_gate_hold from audit detail', () => {
    const outcome = evaluateE2ERubric(
      buildResult({
        graphSnapshots: [
          {
            version: 1,
            status: 'executing_tools',
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
                type: 'GRAPH_OBSERVABILITY_RECORDED',
                timestamp: 1,
                detail: 'decision:hold,reason:goal_evidence_incomplete',
              },
            ],
            updatedAt: 1,
          },
        ],
      }),
      { kind: 'completion_gate_hold', reason: 'goal_evidence_incomplete' },
    );
    expect(outcome.passed).toBe(true);
  });
  it('checks min_user_turns structurally', () => {
    const outcome = evaluateE2ERubric(buildResult({ userTurnCount: 3 }), {
      kind: 'min_user_turns',
      min: 3,
    });
    expect(outcome.passed).toBe(true);
  });
  it('checks cache_eligible_read_rate from actual cache reads after warmup', () => {
    const baseUsage = {
      outputTokens: 1,
      cacheWriteTokens: 0,
      totalTokens: 1,
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
            providerFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'managed_or_implicit_cache',
            cacheablePrefixDigest: 'prefix-a',
          },
        ],
      },
    } as const;
    const result = buildResult({
      turnTraces: [
        {
          turnIndex: 0,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          usage: {
            ...baseUsage,
            inputTokens: 5000,
            cacheReadTokens: 0,
            totalTokens: 5001,
          },
          completed: true,
        },
        {
          turnIndex: 1,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          usage: {
            ...baseUsage,
            inputTokens: 5000,
            cacheReadTokens: 4500,
            totalTokens: 5001,
          },
          completed: true,
        },
      ],
    });

    const outcome = evaluateE2ERubric(result, {
      kind: 'cache_eligible_read_rate',
      minRate: 0.85,
      minEligibleInputTokens: 4000,
      minEligibleTurns: 1,
      afterWarmupTurns: 1,
    });
    expect(outcome).toMatchObject({
      passed: true,
      detail: 'eligible cache read rate 0.900 (4500/5000)',
    });
  });
  it('uses actual provider input tokens instead of prompt-cache estimates for read-rate denominator', () => {
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
            cacheReadTokens: 4500,
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
                  estimatedInputTokens: 9000,
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
      kind: 'cache_eligible_read_rate',
      minRate: 0.85,
      minEligibleInputTokens: 4000,
      minEligibleTurns: 1,
    });
    expect(outcome).toMatchObject({
      passed: true,
      detail: 'eligible cache read rate 0.900 (4500/5000)',
    });
  });
  it('fails cache_eligible_read_rate when provider-managed readiness has no real reads', () => {
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
                  providerFamily: 'gemini',
                  mode: 'gemini_native',
                  event: 'provider_managed',
                  reason: 'managed_or_implicit_cache',
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
                  providerFamily: 'gemini',
                  mode: 'gemini_native',
                  event: 'provider_managed',
                  reason: 'managed_or_implicit_cache',
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
      kind: 'cache_eligible_read_rate',
      minRate: 0.85,
      minEligibleInputTokens: 4000,
      minEligibleTurns: 1,
      afterWarmupTurns: 1,
    });
    expect(outcome).toMatchObject({
      passed: false,
      detail: 'eligible cache read rate 0.000 below minimum 0.850 (0/5000)',
    });
  });
});
