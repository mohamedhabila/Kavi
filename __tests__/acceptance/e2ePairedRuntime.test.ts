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
import { runE2EPairedConditions } from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
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

function buildPlan(left: E2EPairedCondition, right: E2EPairedCondition) {
  const invariant = buildE2EPairedInvariantConfig({
    provider: PROVIDER,
    scenario: SCENARIO,
    systemPrompt: SCENARIO.systemPrompt!,
    toolSurface: ['memory_recall', 'memory_search'],
    maxTokens: 4_096,
    scenarioTimeoutMs: 60_000,
    perTurnTimeoutMs: 30_000,
    memoryTimeoutMs: 10_000,
    seed: 7,
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

function successfulResult() {
  return buildFixtureResult({
    fixtureId: SCENARIO.id,
    conversationId: SCENARIO.conversationId,
    contentClass: SCENARIO.contentClass,
  });
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
      return successfulResult();
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
        executeCondition,
        resetConditionState,
        cleanupConditionState,
        withStoreIsolation: passthroughIsolation,
      },
    });

    expect(events).toEqual([
      'reset',
      'execute:production_auto',
      'reset',
      'execute:memory_off',
      'cleanup',
    ]);
    expect(executeCondition).toHaveBeenCalledTimes(2);
    expect(result.validForDeltaClaims).toBe(true);
    expect(result.cleanup).toEqual({ status: 'completed' });
    expect(result.conditions.map((condition) => condition.status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(executeCondition.mock.calls[0][0].runOptions.routeOverride).toBe('production_auto');
    expect(executeCondition.mock.calls[0][0].runOptions.disableLongTermMemory).toBe(false);
    expect(executeCondition.mock.calls[1][0].runOptions.routeOverride).toBeUndefined();
    expect(executeCondition.mock.calls[1][0].runOptions.disableLongTermMemory).toBe(true);
  });

  it('does not skip the second condition or discard either outcome after a failure', async () => {
    const firstError = new Error('PRIVATE-FIRST-INFRASTRUCTURE-FAILURE');
    const executeCondition = jest
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(successfulResult());

    const result = await runE2EPairedConditions({
      plan: buildPlan('production_auto', 'memory_off'),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
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
      plan: buildPlan('production_auto', 'memory_off'),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        executeCondition: async () => successfulResult(),
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
      plan: buildPlan('production_auto', 'memory_off'),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        executeCondition: async () => successfulResult(),
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

  it('fails closed for condition modes whose product hooks are not installed', async () => {
    const resetConditionState = jest.fn(async () => undefined);
    const result = await runE2EPairedConditions({
      plan: buildPlan('lexical_baseline', 'diagnostic_full_context'),
      scenario: SCENARIO,
      provider: PROVIDER,
      dependencies: {
        resetConditionState,
        cleanupConditionState: async () => undefined,
        withStoreIsolation: passthroughIsolation,
      },
    });
    expect(resetConditionState).toHaveBeenCalledTimes(2);
    expect(result.conditions).toEqual([
      expect.objectContaining({
        condition: 'lexical_baseline',
        status: 'failed',
        category: 'condition_execution',
      }),
      expect.objectContaining({
        condition: 'diagnostic_full_context',
        status: 'failed',
        category: 'condition_execution',
      }),
    ]);
    expect(result.validForDeltaClaims).toBe(false);
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
        plan: buildPlan('production_auto', 'memory_off'),
        scenario: SCENARIO,
        provider: PROVIDER,
        dependencies: {
          executeCondition: jest
            .fn()
            .mockRejectedValueOnce(new Error('first failed'))
            .mockResolvedValueOnce(successfulResult()),
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
