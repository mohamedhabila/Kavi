jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runOrchestrator } from '../../src/engine/orchestrator';
import {
  cancelMemoryExtraction,
  scheduleMemoryExtraction,
  waitForMemoryExtractionIdle,
} from '../../src/services/memory/core/memoryExtractionWorker';
import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resolveForegroundScenarioFinalAssistant } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import {
  makeForegroundScenarioProvider as makeProvider,
  makeOriginalForegroundScenarioConversation as makeOriginalConversation,
} from '../helpers/foregroundScenarioDriverFixtures';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));
jest.mock('../../src/services/memory/core/memoryExtractionWorker', () => ({
  cancelMemoryExtraction: jest.fn(),
  scheduleMemoryExtraction: jest.fn(),
  waitForMemoryExtractionIdle: jest.fn(async () => true),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const mockedRunOrchestrator = jest.mocked(runOrchestrator);
const completedOrchestratorRun = { terminalDisposition: 'final_candidate' as const };
const mockedScheduleMemoryExtraction = jest.mocked(scheduleMemoryExtraction);
const mockedCancelMemoryExtraction = jest.mocked(cancelMemoryExtraction);
const mockedWaitForMemoryExtractionIdle = jest.mocked(waitForMemoryExtractionIdle);
const completeFinalMetadata = buildAssistantMessageMetadata('final', {
  completionStatus: 'complete',
  finishReason: 'stop',
});

describe('runForegroundScenario', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetE2EMemorySandbox();
    await useChatStore.persist.rehydrate();
    await useSettingsStore.persist.rehydrate();

    const originalProvider = makeProvider('original-provider');
    useChatStore.setState({
      conversations: [makeOriginalConversation()],
      activeConversationId: 'original-conversation',
      isLoading: false,
    });
    useSettingsStore.setState({
      providers: [originalProvider],
      activeProviderId: originalProvider.id,
      activeModel: originalProvider.model,
      systemPrompt: 'Original prompt',
      defaultConversationMode: 'agentic',
    });

    mockedWaitForMemoryExtractionIdle.mockResolvedValue(true);
    let responseSequence = 0;
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      responseSequence += 1;
      expect(useSettingsStore.getState()).toMatchObject({
        memoryConsolidationMode: 'active_provider',
        consolidationProvider: null,
      });
      callbacks.onAssistantMessage(
        `Response ${responseSequence}`,
        undefined,
        undefined,
        completeFinalMetadata,
      );
      callbacks.onAgentControlGraphStateChange(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onUsage?.({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        model: options.model,
      });
      callbacks.onDone();
      return completedOrchestratorRun;
    });
  });

  it('covers chitchat-to-chitchat and chitchat-to-agentic route rotations', async () => {
    const provider = makeProvider('scenario-provider');
    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      maxTokens: 777,
      turns: [
        { content: 'Hello there.', route: 'forced_chitchat', timestamp: 10 },
        {
          content: 'Create a calendar event tomorrow at noon.',
          route: 'forced_agentic',
          timestamp: 20,
        },
      ],
    });

    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: 'scenario-conversation',
        maxTokens: 777,
        personaId: 'default',
      }),
      expect.any(Object),
    );
    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'scenario-conversation',
        maxTokens: 777,
        personaId: 'super-agent',
      }),
      expect.any(Object),
    );
    expect(mockedScheduleMemoryExtraction).toHaveBeenCalledTimes(2);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({
      completion: {
        assistantStatus: 'complete',
        executionCompleted: true,
        finalResponseCompleted: true,
        runStatus: 'not_applicable',
        runCompleted: null,
      },
      finalAssistant: {
        text: 'Response 1',
        completionStatus: 'complete',
        finishReason: 'stop',
        terminalReason: null,
      },
      finalAssistantCandidateCount: 1,
      route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
      run: null,
      timedOut: false,
      user: { text: 'Hello there.', timestamp: 10 },
      memoryExtractionSettled: true,
    });
    expect(result.turns[1].route).toEqual({
      directive: 'forced_agentic',
      mode: 'agentic',
      personaId: 'super-agent',
    });
    expect(result.turns[1].run).toMatchObject({
      userMessageId: result.turns[1].userMessageId,
      status: 'completed',
    });
    expect(result.turns[1].completion).toMatchObject({
      assistantStatus: 'complete',
      executionCompleted: true,
      finalResponseCompleted: true,
      runStatus: 'completed',
      runCompleted: true,
    });
    expect(result.memoryItems.indexedTurnCount).toBe(2);
    expect(result.turns[0].usage?.totalTokens).toBe(15);
    expect(result.turns[1].usage?.totalTokens).toBe(15);
    expect(Object.isFrozen(result.turns[1].messages)).toBe(true);
    expect(Object.isFrozen(result.turns[1].finalAssistant)).toBe(true);
    expect(Object.isFrozen(result.turns[1].completion)).toBe(true);
    expect(Object.isFrozen(result.turns[1].user)).toBe(true);
    expect(Object.isFrozen(result.memoryItems)).toBe(true);
    expect(result.turns[1].messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(Object.isFrozen(result.finalConversation)).toBe(true);

    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
    expect(useChatStore.getState().activeConversationId).toBe('original-conversation');
    expect(useSettingsStore.getState().providers.map((entry) => entry.id)).toEqual([
      'original-provider',
    ]);
    expect(useSettingsStore.getState().systemPrompt).toBe('Original prompt');
    expect(mockedCancelMemoryExtraction).toHaveBeenCalledTimes(1);
  });

  it('covers agentic-to-agentic and agentic-to-chitchat route rotations', async () => {
    const provider = makeProvider('scenario-provider');
    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'agentic',
      scenarioTimeoutMs: 60_000,
      turns: [
        {
          content: 'Create a calendar event tomorrow at noon.',
          route: 'forced_agentic',
        },
        { content: 'Thanks, how are you?', route: 'forced_chitchat' },
      ],
    });

    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ personaId: 'super-agent' }),
      expect.any(Object),
    );
    expect(mockedRunOrchestrator).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ personaId: 'default' }),
      expect.any(Object),
    );
    expect(result.turns[0].route).toEqual({
      directive: 'forced_agentic',
      mode: 'agentic',
      personaId: 'super-agent',
    });
    expect(result.turns[0].run).toMatchObject({
      userMessageId: result.turns[0].userMessageId,
      status: 'completed',
    });
    expect(result.turns[1]).toMatchObject({
      route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
      run: null,
    });
    expect(mockedScheduleMemoryExtraction).toHaveBeenCalledTimes(2);
    expect(result.memoryItems.indexedTurnCount).toBe(2);
    expect(result.turns.every((turn) => turn.error === null)).toBe(true);
  });

  it('does not mutate the configured route for production_auto turns', async () => {
    const provider = makeProvider('scenario-provider');
    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      enableCompaction: false,
      turns: [{ content: 'How are you?', route: 'production_auto', maxTokens: 321 }],
    });

    expect(result.turns[0].route).toEqual({
      directive: 'production_auto',
      mode: 'chitchat',
      personaId: 'default',
    });
    expect(mockedRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 321,
        personaId: 'default',
        enableCompaction: false,
      }),
      expect.any(Object),
    );
    expect(mockedScheduleMemoryExtraction).toHaveBeenCalledTimes(1);
    expect(result.turns[0].finalAssistantCandidateCount).toBe(1);
    expect(result.turns[0].memoryPrompt).toEqual({ status: 'missing', builds: [] });
  });

  it('reports background extraction separately from foreground completion', async () => {
    mockedWaitForMemoryExtractionIdle.mockResolvedValue(false);

    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      memoryTimeoutMs: 5,
      turns: [{ content: 'How are you?', route: 'production_auto' }],
    });

    expect(result.turns[0]).toMatchObject({
      error: null,
      completion: {
        executionCompleted: true,
        finalResponseCompleted: true,
      },
      memoryExtractionSettled: false,
    });
    expect(mockedWaitForMemoryExtractionIdle).toHaveBeenCalledWith(5);
  });

  it('applies the product memory opt-out, exact tool surface, and pre-turn identity hook', async () => {
    const beforeTurns = jest.fn(async () => {
      expect(useSettingsStore.getState().disableLongTermMemory).toBe(true);
    });
    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      disableLongTermMemory: true,
      allowedToolNames: ['memory_search'],
      beforeTurns,
      turns: [{ content: 'How are you?', route: 'production_auto' }],
    });

    expect(beforeTurns).toHaveBeenCalledWith({
      conversationId: 'scenario-conversation',
      workspaceConversationId: 'scenario-conversation',
    });
    const toolFilter = mockedRunOrchestrator.mock.calls[0][0].toolFilter;
    expect(toolFilter?.('memory_search')).toBe(true);
    expect(toolFilter?.('memory_remember')).toBe(false);
    expect(mockedRunOrchestrator.mock.calls[0][0].explicitToolSurfaceToolNames).toBeUndefined();
    expect(result.turns[0].memoryPrompt).toEqual({ status: 'opt_out', builds: [] });
    expect(result.turns[0]).toMatchObject({
      completion: {
        assistantStatus: 'complete',
        executionCompleted: true,
        finalResponseCompleted: true,
      },
      error: null,
    });
    expect(result.memoryItems.indexedTurnCount).toBe(0);
    expect(mockedScheduleMemoryExtraction).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
  });

  it('can run the agentic foreground graph with its tool surface disabled', async () => {
    await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'agentic',
      scenarioTimeoutMs: 60_000,
      disableTools: true,
      turns: [{ content: 'Inspect this request without acting.', route: 'forced_agentic' }],
    });

    const toolFilter = mockedRunOrchestrator.mock.calls[0][0].toolFilter;
    expect(toolFilter?.('memory_search')).toBe(false);
    expect(toolFilter?.('device_info')).toBe(false);
    expect(mockedRunOrchestrator.mock.calls[0][0]).toMatchObject({ disableTooling: true });
  });

  it('rejects invalid evaluator controls before running a turn', async () => {
    const base = {
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat' as const,
      scenarioTimeoutMs: 60_000,
      turns: [{ content: 'How are you?', route: 'production_auto' as const }],
    };
    await expect(
      runForegroundScenario({ ...base, allowedToolNames: ['not_a_product_tool'] }),
    ).rejects.toThrow('unique canonical tool names');
    await expect(
      runForegroundScenario({ ...base, allowedToolNames: ['memory_search', 'memory_search'] }),
    ).rejects.toThrow('unique canonical tool names');
    await expect(
      runForegroundScenario({ ...base, disableTools: true, allowedToolNames: ['memory_search'] }),
    ).rejects.toThrow('cannot be configured together');
    await expect(
      runForegroundScenario({
        ...base,
        turns: [{ content: 'How are you?', route: 'production_auto' as const, delayBeforeMs: 0 }],
      }),
    ).rejects.toThrow('delayBeforeMs must be a positive finite number');
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('does not count an incomplete final response as a completed turn', async () => {
    mockedRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage(
        'I could not finish.',
        undefined,
        undefined,
        buildAssistantMessageMetadata('final', {
          completionStatus: 'incomplete',
          finishReason: 'length',
          terminalReason: 'tool_failure',
        }),
      );
      callbacks.onDone();
      return completedOrchestratorRun;
    });

    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      turns: [{ content: 'Finish this.', route: 'production_auto' }],
    });

    expect(result.turns[0]).toMatchObject({
      error: null,
      finalAssistant: {
        text: 'I could not finish.',
        completionStatus: 'incomplete',
        finishReason: 'length',
        terminalReason: 'tool_failure',
      },
      completion: {
        assistantStatus: 'incomplete',
        executionCompleted: true,
        finalResponseCompleted: false,
        runStatus: 'not_applicable',
        runCompleted: null,
      },
    });
  });

  it('diagnoses duplicate explicit finals and selects the last persisted response', () => {
    const resolution = resolveForegroundScenarioFinalAssistant([
      {
        id: 'assistant-first',
        role: 'assistant',
        content: 'First final.',
        timestamp: 1,
        assistantMetadata: completeFinalMetadata,
      },
      {
        id: 'assistant-second',
        role: 'assistant',
        content: 'Second final.',
        timestamp: 2,
        assistantMetadata: buildAssistantMessageMetadata('final', {
          completionStatus: 'incomplete',
          finishReason: 'length',
        }),
      },
    ]);

    expect(resolution).toEqual({
      candidateCount: 2,
      selected: {
        messageId: 'assistant-second',
        text: 'Second final.',
        timestamp: 2,
        completionStatus: 'incomplete',
        finishReason: 'length',
        terminalReason: null,
      },
    });
  });

  it('aborts timed-out turns and restores both global stores', async () => {
    let abortedExecutionSettled = false;
    mockedCancelMemoryExtraction.mockImplementationOnce(() => {
      expect(abortedExecutionSettled).toBe(true);
    });
    mockedRunOrchestrator.mockImplementationOnce(async (options) => {
      await new Promise<void>((resolve) => {
        const signal = options.signal?.signal;
        const settleAbort = () => setTimeout(resolve, 10);
        if (signal?.aborted) settleAbort();
        else signal?.addEventListener('abort', settleAbort, { once: true });
      });
      abortedExecutionSettled = true;
      const error = new Error('Timed out');
      error.name = 'AbortError';
      throw error;
    });

    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      timeoutMs: 5,
      turns: [{ content: 'Wait forever.', route: 'production_auto' }],
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      timedOut: true,
      error: 'Foreground scenario turn timed out after 5ms.',
    });
    expect(abortedExecutionSettled).toBe(true);
    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
    expect(useSettingsStore.getState().activeProviderId).toBe('original-provider');
    expect(mockedCancelMemoryExtraction).toHaveBeenCalledTimes(1);
  });

  it('stops after a preflight error instead of running later turns', async () => {
    const provider = { ...makeProvider('scenario-provider'), apiKey: '' };

    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'agentic',
      scenarioTimeoutMs: 60_000,
      turns: [
        { content: 'First turn.', route: 'production_auto' },
        { content: 'Must not run.', route: 'production_auto' },
      ],
    });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      error: 'The selected provider has no API key.',
      timedOut: false,
    });
    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
  });
});
