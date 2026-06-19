// ---------------------------------------------------------------------------
// E2E rubric evaluators — structural unit tests (no live LLM)
// ---------------------------------------------------------------------------

import {
  evaluateE2ERubric,
  evaluateE2EScenario,
} from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  resetE2EWorkspaceSandbox,
  writeWorkspaceRelativeFile,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { executeMemoryRemember } from '../../src/engine/tools/builtin-memory';
import {
  resetE2ENativeMobileFixtures,
  tryExecuteE2ENativeMobileTool,
} from '../../src/engine/tools/e2eNativeCalendarFixtures';

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

  it('checks goal_status from latest graph snapshot', () => {
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
                id: 'weekend-trip',
                title: 'Trip',
                status: 'completed',
                dependencies: [],
                evidence: ['write_file:done'],
                createdAt: 1,
                updatedAt: 1,
                successCriteria: ['evidence.min:1'],
              },
            ],
          },
        ],
      }),
      { kind: 'goal_status', goalId: 'weekend-trip', status: 'completed' },
    );
    expect(outcome.passed).toBe(true);
  });

  it('checks ingestion_job_completed for the scenario conversation', () => {
    const conversationId = 'conv-ingest';
    const { enqueueIngestionJob } = require('../../src/services/memory/ingestionQueue');
    const job = enqueueIngestionJob({
      threadId: conversationId,
      sourceEndMessageId: 'a-1',
      now: 100,
    });
    const db = require('../../src/services/memory/sqlite-store').getMemoryDb();
    db.runSync(
      `UPDATE memory_ingestion_jobs SET status = 'completed', completed_at = ? WHERE id = ?`,
      200,
      job!.id,
    );

    const outcome = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'ingestion_job_completed',
      minCount: 1,
    });
    expect(outcome.passed).toBe(true);
  });

  it('checks memory_episode_count for the scenario conversation', () => {
    const conversationId = 'conv-episodes';
    const { recordEpisode } = require('../../src/services/memory/episodes/mutations');
    recordEpisode({
      threadId: conversationId,
      conversationId,
      summary: 'episode-a',
      startedAt: 1,
      endedAt: 2,
    });

    const outcome = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'memory_episode_count',
      min: 1,
    });
    expect(outcome.passed).toBe(true);
  });

  it('checks native_fixture_state from deterministic native side effects', async () => {
    process.env.RUN_E2E_AGENT_EVAL = '1';
    await tryExecuteE2ENativeMobileTool('device_permissions', '{}');

    const outcome = evaluateE2ERubric(buildResult(), {
      kind: 'native_fixture_state',
      path: 'permissions.location',
      expectedValue: 'denied',
    });
    expect(outcome.passed).toBe(true);
  });

  it('checks working_block_token in conversation-scoped working memory', () => {
    const conversationId = 'conv-focus';
    const { editWorkingBlock } = require('../../src/services/memory/workingBlocks');
    editWorkingBlock('active_focus', 'weekend-planning-thread', {
      conversationId,
      threadId: conversationId,
    });

    const outcome = evaluateE2ERubric(buildResult({ conversationId }), {
      kind: 'working_block_token',
      label: 'active_focus',
      token: 'weekend-planning-thread',
    });
    expect(outcome.passed).toBe(true);
  });

  it('checks working_block_token using task scope from latest graph snapshot', () => {
    const conversationId = 'conv-task-scope';
    const { editWorkingBlock } = require('../../src/services/memory/workingBlocks');
    editWorkingBlock('active_focus', 'conversation-only-focus', {
      conversationId,
      threadId: conversationId,
    });
    editWorkingBlock('active_focus', 'meal-planning-scope', {
      conversationId,
      threadId: conversationId,
      taskId: 'meal-plan',
    });

    const outcome = evaluateE2ERubric(
      buildResult({
        conversationId,
        graphSnapshots: [
          {
            version: 1,
            status: 'finalized',
            iteration: 2,
            activeTaskId: 'meal-plan',
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
                id: 'meal-plan',
                title: 'meal-planning-scope',
                status: 'active',
                dependencies: [],
                evidence: [],
                createdAt: 1,
                updatedAt: 1,
                successCriteria: [],
              },
            ],
          },
        ],
      }),
      {
        kind: 'working_block_token',
        label: 'active_focus',
        token: 'meal-planning-scope',
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

  it('checks goal_criterion via completionEvidence', () => {
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
            asyncWork: { pendingOperations: [], awaitingBackgroundWorkers: false, updatedAt: 1 },
            performance: { iterationDurationsMs: [], toolCallCounts: {}, updatedAt: 1 },
            turnDirectives: {
              forceFinalText: false,
              requireWorkflowTool: false,
              incompleteFinalTextRecoveryCount: 0,
            },
            audit: [],
            updatedAt: 2,
            goals: [
              {
                id: 'goal-json',
                title: 'verify-json',
                status: 'active',
                dependencies: [],
                evidence: ['calendar_list:{"status":"ok"}'],
                successCriteria: ['evidence.json_field:status:ok'],
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          },
        ],
      }),
      {
        kind: 'goal_criterion',
        goalId: 'goal-json',
        criterion: 'evidence.json_field:status:ok',
        met: true,
      },
    );
    expect(outcome.passed).toBe(true);
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

  it('checks memory_fact from sqlite store', () => {
    const rememberResult = executeMemoryRemember({
      subject: 'e2e-entity-i1',
      predicate: 'artifact_token',
      value: 'E2E-MEM-42',
    });
    expect(JSON.parse(rememberResult).ok).toBe(true);

    const outcome = evaluateE2ERubric(buildResult(), {
      kind: 'memory_fact',
      predicate: 'artifact_token',
      value: 'E2E-MEM-42',
    });
    expect(outcome.passed).toBe(true);
  });

  it('checks memory_fact_absent from currently valid sqlite facts', () => {
    const oldResult = JSON.parse(
      executeMemoryRemember({
        subject: 'e2e-entity-update',
        predicate: 'artifact_token',
        value: 'E2E-OLD',
      }),
    );
    expect(oldResult.ok).toBe(true);
    const newResult = JSON.parse(
      executeMemoryRemember({
        subject: 'e2e-entity-update',
        predicate: 'artifact_token',
        value: 'E2E-NEW',
        supersedePrior: true,
      }),
    );
    expect(newResult.ok).toBe(true);

    const absent = evaluateE2ERubric(buildResult(), {
      kind: 'memory_fact_absent',
      predicate: 'artifact_token',
      value: 'E2E-OLD',
    });
    const present = evaluateE2ERubric(buildResult(), {
      kind: 'memory_fact_absent',
      predicate: 'artifact_token',
      value: 'E2E-NEW',
    });

    expect(absent.passed).toBe(true);
    expect(present.passed).toBe(false);
  });
});

describe('evaluateE2EScenario', () => {
  it('aggregates rubric failures into scenario outcome', () => {
    const outcome = evaluateE2EScenario(buildResult({ completed: false }), [
      { kind: 'graph_terminal_success' },
    ]);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain('orchestrator did not complete');
  });
});
