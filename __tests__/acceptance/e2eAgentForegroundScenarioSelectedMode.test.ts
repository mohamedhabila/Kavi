jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { runOrchestrator } from '../../src/engine/orchestrator';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { getIngestionJob, type IngestionJob } from '../../src/services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../src/services/memory/lifecycle';
import { flushChatStorePersistenceNow } from '../../src/store/chatStorePersistence';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

jest.mock('../../src/engine/orchestrator', () => ({ runOrchestrator: jest.fn() }));
jest.mock('../../src/engine/graph/foregroundRun/semanticMemoryHandoffGate', () => ({
  enforceSemanticMemoryHandoffGate: jest.fn().mockResolvedValue('continued'),
}));
jest.mock('../../src/services/memory/ingestionQueue', () => ({
  cancelScheduledIngestionDrain: jest.fn(),
  drainIngestionQueueWithWakeup: jest.fn(),
  getIngestionJob: jest.fn(),
  requestScheduledIngestionDrain: jest.fn(),
}));
jest.mock('../../src/services/memory/lifecycle', () => ({
  loadIngestionJobRuntimeContext: jest.fn(() => ({})),
  recordCompletedTurnForMemory: jest.fn(),
}));
jest.mock('../../src/services/memory/ingestionReceiptStore', () => ({
  listIngestionPersistenceReceipts: jest.fn(() => []),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const mockedRunOrchestrator = jest.mocked(runOrchestrator);
const mockedRecordCompletedTurnForMemory = jest.mocked(recordCompletedTurnForMemory);
const mockedGetIngestionJob = jest.mocked(getIngestionJob);
const mockedFlushChatStorePersistenceNow = jest.mocked(flushChatStorePersistenceNow);
const completeFinalMetadata = buildAssistantMessageMetadata('final', {
  completionStatus: 'complete',
  finishReason: 'stop',
});

function completedMemoryJob(id: string): IngestionJob {
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

function makeProvider(): LlmProviderConfig {
  return {
    id: 'scenario-provider',
    name: 'scenario-provider',
    enabled: true,
    kind: 'remote',
    protocol: 'openai-chat',
    providerFamily: 'custom',
    baseUrl: 'https://scenario-provider.example.com',
    apiKey: 'scenario-provider-key',
    model: 'scenario-provider-model',
  };
}

describe('foreground scenario selected mode and outer deadline', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetE2EMemorySandbox();
    await useChatStore.persist.rehydrate();
    await useSettingsStore.persist.rehydrate();
    useChatStore.setState({ conversations: [], activeConversationId: null, isLoading: false });
    useSettingsStore.setState({
      providers: [makeProvider()],
      activeProviderId: 'scenario-provider',
      activeModel: 'scenario-provider-model',
      defaultConversationMode: 'chitchat',
    });
    const jobs = new Map<string, IngestionJob>();
    let memorySequence = 0;
    mockedRecordCompletedTurnForMemory.mockImplementation(async () => {
      const jobId = `selected-mode-memory-${++memorySequence}`;
      jobs.set(jobId, completedMemoryJob(jobId));
      return {
        processed: true,
        enqueued: true,
        jobId,
        episodeId: null,
        factIds: [],
        activeFocusUpdated: false,
        openThreadsUpdated: false,
        enriched: false,
      };
    });
    mockedGetIngestionJob.mockImplementation((jobId) => jobs.get(jobId) ?? null);
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Completed.', undefined, undefined, completeFinalMetadata);
      callbacks.onAgentControlGraphStateChange(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves production_auto attribution when the user changes the persisted app mode', async () => {
    const result = await runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      turns: [
        { content: 'Complete the task.', route: 'production_auto', selectedMode: 'agentic' },
        { content: 'Thanks, let us chat.', route: 'production_auto', selectedMode: 'chitchat' },
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
    expect(result.turns.map((turn) => turn.route)).toEqual([
      { directive: 'production_auto', mode: 'agentic', personaId: 'super-agent' },
      { directive: 'production_auto', mode: 'chitchat', personaId: 'default' },
    ]);
  });

  it('rejects an unsupported selected app mode before running a turn', async () => {
    await expect(
      runForegroundScenario({
        provider: makeProvider(),
        conversationId: 'scenario-conversation',
        conversationTitle: 'Scenario title',
        systemPrompt: 'Scenario prompt',
        defaultMode: 'chitchat',
        scenarioTimeoutMs: 60_000,
        turns: [
          {
            content: 'How are you?',
            route: 'production_auto',
            selectedMode: 'unsupported' as never,
          },
        ],
      }),
    ).rejects.toThrow('selectedMode must be agentic or chitchat');
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('passes image attachments through the exact foreground chat entry point', async () => {
    const attachment = {
      id: 'current-screen',
      type: 'image' as const,
      uri: 'inline://current-screen.png',
      name: 'current-screen.png',
      mimeType: 'image/png',
      size: 4,
      base64: 'AQIDBA==',
    };

    const result = await runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      turns: [{ content: '', attachments: [attachment], route: 'production_auto' }],
    });

    const providerUserMessage = mockedRunOrchestrator.mock.calls[0][0].messages.find(
      (message) => message.role === 'user',
    );
    // The chat entry point imports attachments into the conversation workspace before
    // the turn runs, so the provider sees the workspace-backed copy rather than the
    // raw composer attachment.
    const importedAttachment = {
      ...attachment,
      uri: expect.stringContaining('attachments/images/'),
      workspacePath: expect.stringContaining('attachments/images/'),
    };
    expect(providerUserMessage?.attachments).toEqual([importedAttachment]);
    expect(providerUserMessage?.attachments?.[0]).not.toBe(attachment);
    expect(
      result.turns[0].messages.find((message) => message.role === 'user')?.attachments,
    ).toEqual([importedAttachment]);
    expect(Object.isFrozen(result.turns[0].messages[0]?.attachments)).toBe(true);
    expect(attachment).toEqual(expect.objectContaining({ base64: 'AQIDBA==' }));
  });

  it('rejects a foreground turn with neither text nor attachments', async () => {
    await expect(
      runForegroundScenario({
        provider: makeProvider(),
        conversationId: 'scenario-conversation',
        conversationTitle: 'Scenario title',
        systemPrompt: 'Scenario prompt',
        defaultMode: 'chitchat',
        scenarioTimeoutMs: 60_000,
        turns: [{ content: '  ', route: 'production_auto' }],
      }),
    ).rejects.toThrow('must contain text or an attachment');
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('starts a product-created conversation with no prior raw chat and shared durable memory', async () => {
    const userMessageCounts: number[] = [];
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      userMessageCounts.push(options.messages.filter((message) => message.role === 'user').length);
      callbacks.onAssistantMessage('Completed.', undefined, undefined, completeFinalMetadata);
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const result = await runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 60_000,
      turns: [
        { content: 'Remember this preference.', route: 'production_auto' },
        {
          content: 'What do you remember?',
          route: 'production_auto',
          lifecycleBefore: 'new_conversation',
        },
      ],
    });

    expect(userMessageCounts).toEqual([1, 1]);
    expect(result.turns[1]?.lifecycleBefore).toEqual({
      boundary: 'new_conversation',
      chatStore: 'fresh_conversation',
      memoryStore: 'shared_global',
      previousConversationMessageCount: 2,
      newConversationInitialMessageCount: 0,
    });
    expect(
      result.finalConversation.messages.some((message) =>
        message.content.includes('Remember this preference.'),
      ),
    ).toBe(false);
    expect(result.finalConversation.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'What do you remember?' })]),
    );
  });

  it('enforces the outer deadline while durable memory closeout is pending', async () => {
    jest.useFakeTimers();
    mockedRecordCompletedTurnForMemory.mockImplementationOnce(() => new Promise(() => undefined));
    const run = runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 25,
      timeoutMs: 1_000,
      memoryTimeoutMs: 1_000,
      turns: [{ content: 'Complete, then settle memory.', route: 'production_auto' }],
    });
    const rejection = expect(run).rejects.toThrow(
      'Timed-out foreground execution did not settle before cleanup.',
    );
    await jest.advanceTimersByTimeAsync(25);
    await rejection;
    jest.useRealTimers();
  });

  it('does not let post-turn persistence outlive the outer deadline', async () => {
    jest.useFakeTimers();
    mockedFlushChatStorePersistenceNow
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise(() => undefined));
    const run = runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 25,
      timeoutMs: 1_000,
      turns: [{ content: 'Complete, then persist.', route: 'production_auto' }],
    });
    const rejection = expect(run).rejects.toThrow(
      'Timed-out foreground execution did not settle before cleanup.',
    );
    await jest.advanceTimersByTimeAsync(25);
    await rejection;
    jest.useRealTimers();
  });
});
