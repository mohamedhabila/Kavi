import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { executeMemoryRemember } from '../../src/engine/tools/builtin-memory';
import {
  buildScopedMemoryEvidenceDelta,
  captureScopedMemoryEvidence,
} from '../../src/services/memory/evidenceSnapshot';
import {
  resetE2ENativeMobileFixtures,
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
  tryExecuteE2ENativeMobileTool,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { withIngestionSourceSnapshot } from '../helpers/ingestionSourceSnapshotFixture';
function buildResult(overrides: Partial<E2EScenarioResult> = {}): E2EScenarioResult {
  return {
    contentClass: 'synthetic_public',
    fixtureId: 'fixture-a',
    conversationId: 'conv-a',
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    memoryFinalState: {
      capturedAt: 1,
      scope: { memoryConversationId: 'conv-a', sourceThreadId: 'conv-a' },
      facts: [],
      episodes: [],
      workingBlocks: [],
      ingestionJobs: [],
    },
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

function buildResultWithMemoryEvidence(
  conversationId: string,
  overrides: Partial<E2EScenarioResult> = {},
): E2EScenarioResult {
  const scope = { memoryConversationId: conversationId, sourceThreadId: conversationId };
  const before = {
    capturedAt: 0,
    scope,
    facts: [],
    episodes: [],
    workingBlocks: [],
    ingestionJobs: [],
  };
  const after = captureScopedMemoryEvidence(scope);
  return buildResult({
    conversationId,
    memoryFinalState: after,
    ...overrides,
    turnTraces: [
      {
        memoryEvidence: {
          delta: buildScopedMemoryEvidenceDelta(before, after),
        },
      } as E2EScenarioResult['turnTraces'][number],
    ],
  });
}

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
    const job = enqueueIngestionJob(
      withIngestionSourceSnapshot({
        personaId: 'default',
        threadId: conversationId,
        threadTitle: null,
        memoryConversationId: conversationId,
        taskId: null,
        sourceStartMessageId: null,
        sourceEndMessageId: 'a-1',
        sourceRunId: null,
        sourceAt: 100,
        chatProviderId: null,
        chatModel: null,
        reason: 'turn_completed',
        providerEnrichment: true,
        now: 100,
      }),
    );
    const db = require('../../src/services/memory/database').getMemoryDb();
    db.runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'completed_structural',
              provider_outcome = 'structural_only',
              structural_completed_at = ?,
              completed_at = ?
        WHERE id = ?`,
      200,
      200,
      job!.id,
    );

    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();
    const outcome = evaluateE2ERubric(result, {
      kind: 'ingestion_job_completed',
      minCount: 1,
    });
    expect(outcome.passed).toBe(true);
  });
  it('separates durable structural checkpoints from optional enrichment completion', () => {
    const conversationId = 'conv-checkpointed';
    const { enqueueIngestionJob } = require('../../src/services/memory/ingestionQueue');
    const job = enqueueIngestionJob(
      withIngestionSourceSnapshot({
        personaId: 'default',
        threadId: conversationId,
        threadTitle: null,
        memoryConversationId: conversationId,
        taskId: null,
        sourceStartMessageId: 'u-1',
        sourceEndMessageId: 'a-1',
        sourceRunId: null,
        sourceAt: 100,
        chatProviderId: null,
        chatModel: null,
        reason: 'turn_completed',
        providerEnrichment: true,
        now: 100,
      }),
    );
    const db = require('../../src/services/memory/database').getMemoryDb();
    db.runSync(
      `UPDATE memory_ingestion_jobs
          SET status = 'retrying',
              attempt_count = 1,
              provider_outcome = 'provider_error',
              outcome_code = 'provider_request_failed',
              structural_completed_at = ?,
              next_attempt_at = ?,
              completed_at = NULL
        WHERE id = ?`,
      200,
      300,
      job!.id,
    );

    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();

    expect(evaluateE2ERubric(result, { kind: 'ingestion_job_checkpointed', minCount: 1 })).toEqual(
      expect.objectContaining({ passed: true }),
    );
    expect(evaluateE2ERubric(result, { kind: 'ingestion_job_completed', minCount: 1 })).toEqual(
      expect.objectContaining({
        passed: false,
        detail: 'completed ingestion jobs 0 (expected >= 1)',
      }),
    );
  });
  it('checks memory_episode_count for the scenario conversation', () => {
    const conversationId = 'conv-episodes';
    const { recordThreadLocalEpisode } = require('../../src/services/memory/episodes/mutations');
    recordThreadLocalEpisode({
      threadId: conversationId,
      conversationId,
      summary: 'episode-a',
      startedAt: 1,
      endedAt: 2,
    });

    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();
    const outcome = evaluateE2ERubric(result, {
      kind: 'memory_episode_count',
      min: 1,
    });
    expect(outcome.passed).toBe(true);
  });
  it('checks native_fixture_state from deterministic native side effects', async () => {
    process.env.RUN_E2E_AGENT_EVAL = '1';
    const stateBefore = getE2ENativeMobileFixtureStateSnapshot();
    await tryExecuteE2ENativeMobileTool('device_permissions', '{}');
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
  it('checks working_block_token in conversation-scoped working memory', () => {
    const conversationId = 'conv-focus';
    const { editWorkingBlock } = require('../../src/services/memory/workingBlocks');
    editWorkingBlock('active_focus', 'weekend-planning-thread', {
      conversationId,
      threadId: conversationId,
    });

    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();
    const outcome = evaluateE2ERubric(result, {
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
      buildResultWithMemoryEvidence(conversationId, {
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
    const conversationId = 'conv-memory-fact';
    const rememberResult = executeMemoryRemember({
      subject: 'e2e-entity-i1',
      predicate: 'artifact_token',
      value: 'E2E-MEM-42',
      scope: 'conversation',
      originConversationId: conversationId,
      originThreadId: conversationId,
    });
    expect(JSON.parse(rememberResult).ok).toBe(true);

    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();
    const outcome = evaluateE2ERubric(result, {
      kind: 'memory_fact',
      subject: 'e2e-entity-i1',
      predicate: 'artifact_token',
      value: 'E2E-MEM-42',
      scope: 'conversation',
    });
    expect(outcome.passed).toBe(true);
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'wrong-subject',
        predicate: 'artifact_token',
        value: 'E2E-MEM-42',
        scope: 'conversation',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'e2e-entity-i1',
        predicate: 'artifact_token',
        value: 'E2E-MEM-42',
        scope: 'global',
      }),
    ).toMatchObject({ passed: false });
  });
  it('checks memory_fact_absent from currently valid sqlite facts', () => {
    const conversationId = 'conv-memory-fact-update';
    const oldResult = JSON.parse(
      executeMemoryRemember({
        subject: 'e2e-entity-update',
        predicate: 'artifact_token',
        value: 'E2E-OLD',
        scope: 'conversation',
        originConversationId: conversationId,
        originThreadId: conversationId,
      }),
    );
    expect(oldResult.ok).toBe(true);
    const newResult = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'e2e-entity-update',
          predicate: 'artifact_token',
          value: 'E2E-NEW',
          scope: 'conversation',
          originConversationId: conversationId,
          originThreadId: conversationId,
        },
        {
          requestEvidence: {
            memoryConversationId: conversationId,
            sourceThreadId: conversationId,
            taskId: null,
            userMessageId: 'msg-memory-fact-update',
            userMessageText: 'Correction: e2e-entity-update artifact token is E2E-NEW.',
          },
        },
      ),
    );
    expect(newResult.ok).toBe(true);

    const result = buildResultWithMemoryEvidence(conversationId);
    const absent = evaluateE2ERubric(result, {
      kind: 'memory_fact_absent',
      subject: 'e2e-entity-update',
      predicate: 'artifact_token',
      value: 'E2E-OLD',
      scope: 'conversation',
    });
    const present = evaluateE2ERubric(result, {
      kind: 'memory_fact_absent',
      subject: 'e2e-entity-update',
      predicate: 'artifact_token',
      value: 'E2E-NEW',
      scope: 'conversation',
    });

    expect(absent.passed).toBe(true);
    expect(present.passed).toBe(false);
  });

  it('does not treat an expired fact as current memory evidence', () => {
    const conversationId = 'conv-memory-expired';
    executeMemoryRemember({
      subject: 'e2e-expired-subject',
      predicate: 'temporary_code',
      value: 'EXPIRED-CODE',
      originConversationId: conversationId,
      originThreadId: conversationId,
    });
    const { getMemoryDb } = require('../../src/services/memory/database');
    getMemoryDb().runSync(
      `UPDATE memory_facts SET expires_at = ? WHERE origin_conversation_id = ?`,
      1,
      conversationId,
    );

    const result = buildResultWithMemoryEvidence(conversationId);
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'e2e-expired-subject',
        predicate: 'temporary_code',
        value: 'EXPIRED-CODE',
        scope: 'global',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact_absent',
        subject: 'e2e-expired-subject',
        predicate: 'temporary_code',
        value: 'EXPIRED-CODE',
        scope: 'global',
      }),
    ).toMatchObject({ passed: true });
  });
});
