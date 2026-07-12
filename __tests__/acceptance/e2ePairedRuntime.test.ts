jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  buildE2EPairedConditionPlan,
  buildE2EPairedExecutionPlan,
  type E2EPairedCondition,
} from '../../src/acceptance/e2eAgent/e2ePairedConditions';
import { buildE2EPairedInvariantConfig } from '../../src/acceptance/e2eAgent/e2ePairedInvariant';
import {
  runE2EPairedConditions,
  type E2EPairedConditionExecutionInput,
} from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { withE2EPairedStoreIsolation } from '../../src/acceptance/e2eAgent/e2ePairedStateIsolation';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';
import {
  flushChatStorePersistenceNow,
  requestChatStorePersistenceCheckpoint,
} from '../../src/store/chatStorePersistence';

jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const mockedFlushChatStorePersistenceNow = jest.mocked(flushChatStorePersistenceNow);
const mockedRequestChatStorePersistenceCheckpoint = jest.mocked(
  requestChatStorePersistenceCheckpoint,
);

const PROVIDER: LlmProviderConfig = {
  id: 'paired-provider',
  name: 'Paired provider',
  enabled: true,
  kind: 'remote',
  protocol: 'openai-chat',
  providerFamily: 'custom',
  apiKey: 'test-key',
  model: 'paired-model',
  baseUrl: 'https://example.com/v1',
};

const CLEAN_APP_SOURCE = { commitSha: 'a'.repeat(40), dirty: false } as const;

const SCENARIO: E2EScenario = {
  id: 'paired-runtime-scenario',
  conversationId: 'paired-runtime-conversation',
  contentClass: 'synthetic_public',
  execution: { initialMode: 'agentic', route: 'production_auto' },
  prompt: 'Complete the paired runtime scenario.',
  userTurns: [{ content: 'Complete the paired runtime scenario.' }],
  rubrics: [{ kind: 'min_user_turns', min: 1 }],
  systemPrompt: 'Stable paired runtime system prompt.',
};

function buildPlan(left: E2EPairedCondition, right: E2EPairedCondition, seed = 7) {
  const invariant = buildE2EPairedInvariantConfig({
    provider: PROVIDER,
    scenario: SCENARIO,
    systemPrompt: SCENARIO.systemPrompt!,
    toolSurface: ['memory_recall', 'memory_search'],
    maxTokens: 4_096,
    scenarioTimeoutMs: 60_000,
    perTurnTimeoutMs: 30_000,
    memoryTimeoutMs: 10_000,
    seed,
  });
  return buildE2EPairedExecutionPlan({
    pairId: `${left}-vs-${right}`,
    comparison: { referenceCondition: left, candidateCondition: right },
    conditions: [
      buildE2EPairedConditionPlan({ condition: left, invariantConfig: invariant }),
      buildE2EPairedConditionPlan({ condition: right, invariantConfig: invariant }),
    ],
  });
}

function successfulResult(conversationIdSuffix: string) {
  return buildFixtureResult({
    fixtureId: SCENARIO.id,
    conversationId: `${SCENARIO.conversationId}-${conversationIdSuffix}`,
    contentClass: SCENARIO.contentClass,
  });
}

function successfulExecutionResult(input: E2EPairedConditionExecutionInput) {
  const conversationIdSuffix = input.runOptions.conversationIdSuffix;
  if (!conversationIdSuffix) throw new Error('missing paired conversation identity');
  return successfulResult(conversationIdSuffix);
}

function passthroughIsolation<T>(task: () => Promise<T>): Promise<T> {
  return task();
}

describe('paired E2E runtime coordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFlushChatStorePersistenceNow.mockResolvedValue(undefined);
  });

  it('resets, executes, and records each declared condition exactly once', async () => {
    const events: string[] = [];
    const executeCondition = jest.fn(async ({ conditionPlan, runOptions }) => {
      events.push(`execute:${conditionPlan.condition}`);
      expect(runOptions.provider).toBe(PROVIDER);
      expect(runOptions.maxTokens).toBe(4_096);
      expect(runOptions.scenarioTimeoutMs).toBe(60_000);
      expect(runOptions.perTurnTimeoutMs).toBe(30_000);
      expect(runOptions.memoryTimeoutMs).toBe(10_000);
      expect(runOptions.allowedToolNames).toEqual(['memory_recall', 'memory_search']);
      return successfulExecutionResult({ conditionPlan, runOptions, scenario: SCENARIO });
    });
    const resetConditionState = jest.fn(async () => {
      events.push('reset');
    });
    const cleanupConditionState = jest.fn(async () => {
      events.push('cleanup');
    });

    const result = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off'),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition,
        resetConditionState,
        cleanupConditionState,
        withStoreIsolation: passthroughIsolation,
      },
    });

    expect(events).toEqual([
      'reset',
      'execute:memory_off',
      'reset',
      'execute:production_auto',
      'cleanup',
    ]);
    expect(executeCondition).toHaveBeenCalledTimes(2);
    expect(result.validForDeltaClaims).toBe(true);
    expect(result.cleanup).toEqual({ status: 'completed' });
    expect(result.executionSeed).toBe(7);
    expect(result.executionOrder).toEqual(['memory_off', 'production_auto']);
    expect(result.conditions.map((condition) => condition.condition)).toEqual([
      'production_auto',
      'memory_off',
    ]);
    expect(
      new Set(result.conditions.map((condition) => condition.executionIdentityHash)).size,
    ).toBe(2);
    expect(result.conditions.map((condition) => condition.status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(executeCondition.mock.calls[0][0].runOptions.routeOverride).toBeUndefined();
    expect(executeCondition.mock.calls[0][0].runOptions.disableLongTermMemory).toBe(true);
    expect(executeCondition.mock.calls[1][0].runOptions.routeOverride).toBe('production_auto');
    expect(executeCondition.mock.calls[1][0].runOptions.disableLongTermMemory).toBe(false);
    expect(executeCondition.mock.calls[0][0].runOptions.conversationIdSuffix).not.toBe(
      executeCondition.mock.calls[1][0].runOptions.conversationIdSuffix,
    );
  });

  it('rejects a dirty source before building or invoking a provider', async () => {
    const buildProvider = jest.fn(() => PROVIDER);
    const executeCondition = jest.fn(async (executionInput) =>
      successfulExecutionResult(executionInput),
    );

    const result = await runE2EPairedConditions({
      plan: buildPlan('memory_off', 'production_auto', 2),
      scenario: SCENARIO,
      dependencies: {
        captureAppSource: () => ({ ...CLEAN_APP_SOURCE, dirty: true }),
        buildProvider,
        executeCondition,
      },
    });

    expect(buildProvider).not.toHaveBeenCalled();
    expect(executeCondition).not.toHaveBeenCalled();
    expect(result.source.status).toBe('dirty');
    expect(result.validForDeltaClaims).toBe(false);
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions.every((condition) => condition.status === 'failed')).toBe(true);
    expect(result.conditions[0]).toMatchObject({ category: 'source_provenance' });
  });

  it('fails the affected condition when the source SHA changes mid-run', async () => {
    const changedSource = { commitSha: 'b'.repeat(40), dirty: false } as const;
    const captureAppSource = jest
      .fn(() => CLEAN_APP_SOURCE)
      .mockReturnValueOnce(CLEAN_APP_SOURCE)
      .mockReturnValueOnce(CLEAN_APP_SOURCE)
      .mockReturnValueOnce(CLEAN_APP_SOURCE)
      .mockReturnValue(changedSource);
    const executeCondition = jest.fn(async (executionInput) =>
      successfulExecutionResult(executionInput),
    );

    const result = await runE2EPairedConditions({
      plan: buildPlan('memory_off', 'production_auto', 2),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource,
        executeCondition,
        resetConditionState: async () => undefined,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: passthroughIsolation,
      },
    });

    expect(executeCondition).toHaveBeenCalledTimes(1);
    expect(result.source).toMatchObject({
      app: CLEAN_APP_SOURCE,
      completionApp: changedSource,
      status: 'mismatch',
    });
    expect(result.conditions[1]).toMatchObject({
      status: 'failed',
      category: 'source_provenance',
    });
    expect(result.validForDeltaClaims).toBe(false);
  });

  it('uses the low seed bit to counterbalance order without changing comparison roles', async () => {
    const executeCondition = jest.fn(async (executionInput) =>
      successfulExecutionResult(executionInput),
    );
    const result = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off', 8),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition,
        resetConditionState: async () => undefined,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: passthroughIsolation,
      },
    });

    expect(result.executionOrder).toEqual(['production_auto', 'memory_off']);
    expect(
      executeCondition.mock.calls.map(([execution]) => execution.conditionPlan.condition),
    ).toEqual(['production_auto', 'memory_off']);
    expect(result.comparison).toEqual({
      referenceCondition: 'production_auto',
      candidateCondition: 'memory_off',
    });
    expect(result.conditions.map((condition) => condition.condition)).toEqual([
      'production_auto',
      'memory_off',
    ]);
  });

  it('does not skip the second condition or discard either outcome after a failure', async () => {
    const firstError = new Error('PRIVATE-FIRST-INFRASTRUCTURE-FAILURE');
    const executeCondition = jest
      .fn(async (executionInput: E2EPairedConditionExecutionInput) =>
        successfulExecutionResult(executionInput),
      )
      .mockRejectedValueOnce(firstError);

    const result = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off', 8),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition,
        resetConditionState: async () => undefined,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: passthroughIsolation,
      },
    });

    expect(executeCondition).toHaveBeenCalledTimes(2);
    expect(result.validForDeltaClaims).toBe(false);
    expect(result.conditions[0]).toMatchObject({
      condition: 'production_auto',
      status: 'failed',
      category: 'condition_execution',
      privateError: 'Error: PRIVATE-FIRST-INFRASTRUCTURE-FAILURE',
    });
    expect(result.conditions[0]).toHaveProperty(
      'errorHash',
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    );
    expect(result.conditions[1]).toMatchObject({ condition: 'memory_off', status: 'completed' });
  });

  it('records setup, final cleanup, and store restoration failures as invalid evidence', async () => {
    const setupFailure = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off', 8),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition: async (executionInput) => successfulExecutionResult(executionInput),
        resetConditionState: jest
          .fn()
          .mockRejectedValueOnce(new Error('reset failed'))
          .mockResolvedValueOnce(undefined),
        cleanupConditionState: async () => {
          throw new Error('cleanup failed');
        },
        withStoreIsolation: passthroughIsolation,
      },
    });
    expect(setupFailure.conditions).toHaveLength(2);
    expect(setupFailure.conditions[0]).toMatchObject({ status: 'failed', category: 'state_reset' });
    expect(setupFailure.conditions[1]).toMatchObject({ status: 'completed' });
    expect(setupFailure.cleanup).toMatchObject({ status: 'failed', category: 'state_cleanup' });
    expect(setupFailure.validForDeltaClaims).toBe(false);

    const restorationFailure = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off', 8),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition: async (executionInput) => successfulExecutionResult(executionInput),
        resetConditionState: async () => undefined,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: async (task) => {
          await task();
          throw new Error('restore failed');
        },
      },
    });
    expect(restorationFailure.cleanup).toMatchObject({
      status: 'failed',
      category: 'store_restoration',
    });
    expect(restorationFailure.conditions).toHaveLength(2);
    expect(restorationFailure.validForDeltaClaims).toBe(false);
  });

  it('wires lexical retrieval and full-context diagnostics through product run options', async () => {
    const resetConditionState = jest.fn(async () => undefined);
    const executeCondition = jest.fn(async (executionInput) =>
      successfulExecutionResult(executionInput),
    );
    const result = await runE2EPairedConditions({
      plan: buildPlan('lexical_baseline', 'diagnostic_full_context', 8),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        captureAppSource: () => CLEAN_APP_SOURCE,
        executeCondition,
        resetConditionState,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: passthroughIsolation,
      },
    });
    expect(resetConditionState).toHaveBeenCalledTimes(2);
    expect(executeCondition.mock.calls[0][0].runOptions).toMatchObject({
      memoryRetrievalStrategy: 'lexical_only',
      memoryContextStrategy: 'production',
      enableCompaction: true,
    });
    expect(executeCondition.mock.calls[1][0].runOptions).toMatchObject({
      memoryRetrievalStrategy: 'production',
      memoryContextStrategy: 'full_context',
      enableCompaction: false,
    });
    expect(result.validForDeltaClaims).toBe(true);
  });

  it('restores chat, agent-run, settings, and persistence after the first condition fails', async () => {
    const originalChat = useChatStore.getState();
    const originalSettings = useSettingsStore.getState();
    const originalConversation: Conversation = {
      id: 'original-conversation',
      title: 'Original conversation',
      messages: [],
      agentRuns: [],
      providerId: PROVIDER.id,
      createdAt: 1,
      updatedAt: 1,
    };
    useChatStore.setState({
      conversations: [originalConversation],
      activeConversationId: originalConversation.id,
      isLoading: false,
    });
    useSettingsStore.setState({ systemPrompt: 'Original user prompt' });
    try {
      const result = await runE2EPairedConditions({
        plan: buildPlan('production_auto', 'memory_off', 8),
        scenario: SCENARIO,
        provider: PROVIDER,
        dependencies: {
          captureAppSource: () => CLEAN_APP_SOURCE,
          executeCondition: jest
            .fn(async (executionInput: E2EPairedConditionExecutionInput) =>
              successfulExecutionResult(executionInput),
            )
            .mockRejectedValueOnce(new Error('first failed')),
          resetConditionState: async () => {
            useChatStore.setState({
              conversations: [],
              activeConversationId: null,
              isLoading: false,
            });
          },
          cleanupConditionState: async () => undefined,
        },
      });
      expect(result.validForDeltaClaims).toBe(false);
      expect(useChatStore.getState().conversations).toEqual([originalConversation]);
      expect(useChatStore.getState().activeConversationId).toBe(originalConversation.id);
      expect(useSettingsStore.getState().systemPrompt).toBe('Original user prompt');
      expect(mockedRequestChatStorePersistenceCheckpoint).toHaveBeenCalledWith(0);
      expect(mockedFlushChatStorePersistenceNow).toHaveBeenCalled();
    } finally {
      useChatStore.setState(originalChat, true);
      useSettingsStore.setState(originalSettings, true);
    }
  });

  it('preserves the task failure if persistence restoration also fails', async () => {
    const originalError = new Error('original task failure');
    mockedFlushChatStorePersistenceNow.mockRejectedValueOnce(new Error('restore flush failure'));
    await expect(
      withE2EPairedStoreIsolation(async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);
  });
});
