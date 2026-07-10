jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runOrchestrator } from '../../src/engine/orchestrator';
import {
  cancelScheduledIngestionDrain,
  drainIngestionQueueWithWakeup,
  getIngestionJob,
  type IngestionJob,
} from '../../src/services/memory/ingestionQueue';
import {
  listIngestionPersistenceReceipts,
  type IngestionPersistenceReceipt,
} from '../../src/services/memory/ingestionReceiptStore';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  resolveForegroundScenarioFinalAssistant,
  settleForegroundScenarioMemory,
} from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));
jest.mock('../../src/services/memory/ingestionQueue', () => ({
  cancelScheduledIngestionDrain: jest.fn(),
  drainIngestionQueueWithWakeup: jest.fn(async () => ({
    attempted: 0,
    completed: 0,
    completedStructural: 0,
    completedEnriched: 0,
    retrying: 0,
    degraded: 0,
    deferred: 0,
    sourceDeferred: 0,
    resourceDeferred: 0,
    failed: 0,
  })),
  getIngestionJob: jest.fn(),
}));
jest.mock('../../src/services/memory/lifecycle', () => ({
  loadIngestionJobRuntimeContext: jest.fn(() => ({})),
  recordCompletedTurnForMemory: jest.fn(),
}));
jest.mock('../../src/services/memory/ingestionReceiptStore', () => ({
  listIngestionPersistenceReceipts: jest.fn(),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const mockedRunOrchestrator = jest.mocked(runOrchestrator);
const mockedRecordCompletedTurnForMemory = jest.mocked(recordCompletedTurnForMemory);
const mockedGetIngestionJob = jest.mocked(getIngestionJob);
const mockedDrainIngestionQueueWithWakeup = jest.mocked(drainIngestionQueueWithWakeup);
const mockedCancelScheduledIngestionDrain = jest.mocked(cancelScheduledIngestionDrain);
const mockedListIngestionPersistenceReceipts = jest.mocked(listIngestionPersistenceReceipts);

function makeProvider(id: string): LlmProviderConfig {
  return {
    id,
    name: id,
    enabled: true,
    kind: 'remote',
    protocol: 'openai-chat',
    providerFamily: 'custom',
    baseUrl: `https://${id}.example.com`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
  };
}

function makeOriginalConversation(): Conversation {
  return {
    id: 'original-conversation',
    title: 'Original conversation',
    messages: [],
    providerId: 'original-provider',
    systemPrompt: 'Original prompt',
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeCompletedJob(id: string): IngestionJob {
  return {
    id,
    threadId: 'scenario-conversation',
    threadTitle: 'Scenario title',
    memoryConversationId: 'scenario-conversation',
    taskId: null,
    sourceRunId: null,
    chatProviderId: 'scenario-provider',
    chatModel: 'scenario-provider-model',
    sourceStartMessageId: null,
    sourceEndMessageId: `assistant-${id}`,
    sourceAt: 1,
    reason: 'turn_completed',
    status: 'completed_enriched',
    attemptCount: 1,
    providerEnrichment: true,
    providerOutcome: 'valid',
    outcomeCode: null,
    nextAttemptAt: null,
    leaseExpiresAt: null,
    claimToken: null,
    structuralCompletedAt: 2,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
}

function makeReceipt(
  jobId: string,
  overrides: Partial<IngestionPersistenceReceipt> = {},
): IngestionPersistenceReceipt {
  return {
    jobId,
    attemptNumber: 1,
    episodeId: `episode-${jobId}`,
    deterministicFactIds: [`deterministic-${jobId}`],
    providerFactIds: [`provider-${jobId}`],
    invalidatedFactIds: [],
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    providerOutcome: 'valid',
    providerOutcomeCode: null,
    persistedAt: 2,
    ...overrides,
  };
}

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

    let memorySequence = 0;
    const jobs = new Map<string, IngestionJob>();
    mockedRecordCompletedTurnForMemory.mockImplementation(async () => {
      const jobId = `job-${++memorySequence}`;
      jobs.set(jobId, makeCompletedJob(jobId));
      return {
        processed: true,
        enqueued: true,
        jobId,
        episodeId: null,
        factIds: [],
        activeFocusUpdated: true,
        openThreadsUpdated: false,
        enriched: false,
      };
    });
    mockedGetIngestionJob.mockImplementation((jobId) => jobs.get(jobId) ?? null);
    mockedListIngestionPersistenceReceipts.mockImplementation((jobId) => [makeReceipt(jobId)]);

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
        buildAssistantMessageMetadata('final'),
      );
      callbacks.onUsage?.({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        model: options.model,
      });
      callbacks.onDone();
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
    expect(mockedRecordCompletedTurnForMemory).toHaveBeenCalledTimes(2);
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
        finishReason: null,
        terminalReason: null,
      },
      finalAssistantCandidateCount: 1,
      route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
      run: null,
      timedOut: false,
      user: { text: 'Hello there.', timestamp: 10 },
      memory: [
        {
          lifecycle: { processed: true, enqueued: true },
          job: { status: 'completed_enriched' },
          receipts: [{ jobId: 'job-1', attemptNumber: 1, providerOutcome: 'valid' }],
        },
      ],
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
    expect(result.turns[1].memory).toHaveLength(1);
    expect(result.turns[1].memory[0]?.receipts).toEqual([makeReceipt('job-2')]);
    expect(mockedListIngestionPersistenceReceipts.mock.calls).toEqual([['job-1'], ['job-2']]);
    expect(Object.isFrozen(result.turns[1].memory[0]?.receipts)).toBe(true);
    expect(Object.isFrozen(result.turns[1].memory[0]?.receipts[0])).toBe(true);
    expect(Object.keys(result.turns[1].memory[0]?.receipts[0] ?? {}).sort()).toEqual(
      [
        'activeFocusUpdated',
        'agentRunMemoryFactIds',
        'attemptNumber',
        'bridgedEvidenceFactIds',
        'deterministicFactIds',
        'episodeId',
        'invalidatedFactIds',
        'jobId',
        'openThreadsUpdated',
        'persistedAt',
        'providerFactIds',
        'providerOutcome',
        'providerOutcomeCode',
      ].sort(),
    );
    expect(JSON.stringify(result.turns[1].memory)).not.toContain('Response 2');
    expect(result.turns[0].usage?.totalTokens).toBe(15);
    expect(result.turns[1].usage?.totalTokens).toBe(15);
    expect(Object.isFrozen(result.turns[1].messages)).toBe(true);
    expect(Object.isFrozen(result.turns[1].finalAssistant)).toBe(true);
    expect(Object.isFrozen(result.turns[1].completion)).toBe(true);
    expect(Object.isFrozen(result.turns[1].user)).toBe(true);
    expect(Object.isFrozen(result.memoryFinalState)).toBe(true);
    expect(result.memoryFinalState.scope).toEqual({
      memoryConversationId: 'scenario-conversation',
      sourceThreadId: 'scenario-conversation',
    });
    expect(result.turns[0].memoryEvidence.delta).toMatchObject({
      facts: { createdIds: [], updatedIds: [], removedIds: [] },
      episodes: { createdIds: [], updatedIds: [], removedIds: [] },
    });
    expect(result.turns[1].messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(Object.isFrozen(result.finalConversation)).toBe(true);

    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
    expect(useChatStore.getState().activeConversationId).toBe('original-conversation');
    expect(useSettingsStore.getState().providers.map((entry) => entry.id)).toEqual([
      'original-provider',
    ]);
    expect(useSettingsStore.getState().systemPrompt).toBe('Original prompt');
    expect(mockedCancelScheduledIngestionDrain).toHaveBeenCalledTimes(1);
  });

  it('covers agentic-to-agentic and agentic-to-chitchat route rotations', async () => {
    const provider = makeProvider('scenario-provider');
    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'agentic',
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
    expect(result.turns[0].memory).toHaveLength(1);
    expect(result.turns[1]).toMatchObject({
      route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
      run: null,
      memory: [
        {
          lifecycle: { processed: true, enqueued: true },
          job: { status: 'completed_enriched' },
        },
      ],
    });
    expect(mockedRecordCompletedTurnForMemory).toHaveBeenCalledTimes(2);
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
      turns: [{ content: 'How are you?', route: 'production_auto', maxTokens: 321 }],
    });

    expect(result.turns[0].route).toEqual({
      directive: 'production_auto',
      mode: 'chitchat',
      personaId: 'default',
    });
    expect(mockedRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 321, personaId: 'default' }),
      expect.any(Object),
    );
    expect(result.turns[0].memory).toHaveLength(1);
    expect(result.turns[0].finalAssistantCandidateCount).toBe(1);
    expect(result.turns[0].retrieval).toMatchObject({
      instrumentationStatus: 'missing',
      events: [],
    });
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
      disableLongTermMemory: true,
      allowedToolNames: ['memory_recall'],
      beforeTurns,
      turns: [{ content: 'How are you?', route: 'production_auto' }],
    });

    expect(beforeTurns).toHaveBeenCalledWith({
      conversationId: 'scenario-conversation',
      workspaceConversationId: 'scenario-conversation',
    });
    const toolFilter = mockedRunOrchestrator.mock.calls[0][0].toolFilter;
    expect(toolFilter?.('memory_recall')).toBe(true);
    expect(toolFilter?.('memory_search')).toBe(false);
    expect(result.turns[0].retrieval).toEqual({
      sourceThreadIdHash: null,
      instrumentationStatus: 'opt_out',
      events: [],
    });
    expect(useSettingsStore.getState().disableLongTermMemory).toBe(false);
  });

  it('rejects unknown or duplicate tool allowlists before running a turn', async () => {
    const base = {
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat' as const,
      turns: [{ content: 'How are you?', route: 'production_auto' as const }],
    };
    await expect(
      runForegroundScenario({ ...base, allowedToolNames: ['not_a_product_tool'] }),
    ).rejects.toThrow('unique canonical tool names');
    await expect(
      runForegroundScenario({ ...base, allowedToolNames: ['memory_recall', 'memory_recall'] }),
    ).rejects.toThrow('unique canonical tool names');
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
    });

    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
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
        assistantMetadata: buildAssistantMessageMetadata('final'),
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
    mockedRunOrchestrator.mockImplementationOnce(async (options) => {
      await new Promise<never>((_resolve, reject) => {
        const signal = options.signal?.signal;
        const rejectAbort = () => {
          const error = new Error('Timed out');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    });

    const result = await runForegroundScenario({
      provider: makeProvider('scenario-provider'),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      timeoutMs: 5,
      turns: [{ content: 'Wait forever.', route: 'production_auto' }],
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      timedOut: true,
      error: 'Foreground scenario turn timed out after 5ms.',
      memory: [],
    });
    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
    expect(useSettingsStore.getState().activeProviderId).toBe('original-provider');
    expect(mockedCancelScheduledIngestionDrain).toHaveBeenCalledTimes(1);
  });

  it('stops after a preflight error instead of running later turns', async () => {
    const provider = { ...makeProvider('scenario-provider'), apiKey: '' };

    const result = await runForegroundScenario({
      provider,
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'agentic',
      turns: [
        { content: 'First turn.', route: 'production_auto' },
        { content: 'Must not run.', route: 'production_auto' },
      ],
    });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      error: 'The selected provider has no API key.',
      memory: [],
      timedOut: false,
    });
    expect(useChatStore.getState().conversations).toEqual([makeOriginalConversation()]);
  });

  it('accepts a future pending memory attempt as a stable deferred outcome', async () => {
    const pendingJob: IngestionJob = {
      ...makeCompletedJob('job-deferred'),
      status: 'pending',
      nextAttemptAt: Date.now() + 60_000,
      completedAt: null,
    };
    mockedGetIngestionJob.mockReturnValue(pendingJob);
    const priorAttemptReceipt = makeReceipt(pendingJob.id, {
      providerOutcome: 'malformed',
      providerOutcomeCode: 'invalid_json',
      providerFactIds: [],
    });
    mockedListIngestionPersistenceReceipts.mockReturnValue([priorAttemptReceipt]);
    mockedDrainIngestionQueueWithWakeup.mockResolvedValueOnce({
      attempted: 1,
      completed: 0,
      completedStructural: 0,
      completedEnriched: 0,
      retrying: 0,
      degraded: 0,
      deferred: 1,
      sourceDeferred: 0,
      resourceDeferred: 0,
      failed: 0,
    });

    await expect(
      settleForegroundScenarioMemory(
        [
          {
            promise: Promise.resolve({
              processed: true,
              enqueued: true,
              jobId: pendingJob.id,
              episodeId: null,
              factIds: [],
              activeFocusUpdated: true,
              openThreadsUpdated: false,
              enriched: false,
            }),
          },
        ],
        100,
      ),
    ).resolves.toEqual([
      {
        lifecycle: {
          processed: true,
          enqueued: true,
          jobId: pendingJob.id,
          episodeId: null,
          factIds: [],
          activeFocusUpdated: true,
          openThreadsUpdated: false,
          enriched: false,
        },
        job: pendingJob,
        receipts: [priorAttemptReceipt],
      },
    ]);
    expect(mockedListIngestionPersistenceReceipts).toHaveBeenCalledWith(pendingJob.id);
  });

});
