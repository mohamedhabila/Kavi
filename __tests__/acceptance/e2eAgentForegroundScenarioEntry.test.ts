jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { runOrchestrator } from '../../src/engine/orchestrator';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { flushChatStorePersistenceNow } from '../../src/store/chatStorePersistence';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { buildAssistantMessageMetadata } from '../../src/utils/assistantMessageMetadata';

jest.mock('../../src/engine/orchestrator', () => ({ runOrchestrator: jest.fn() }));
jest.mock('../../src/services/memory/core/memoryExtractionWorker', () => ({
  bindConversationFocus: jest.fn(),
  cancelMemoryExtraction: jest.fn(),
  scheduleMemoryExtraction: jest.fn(),
  waitForMemoryExtractionIdle: jest.fn(async () => true),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: jest.fn(async () => undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

const mockedRunOrchestrator = jest.mocked(runOrchestrator);
const mockedFlushChatStorePersistenceNow = jest.mocked(flushChatStorePersistenceNow);
const completeFinalMetadata = buildAssistantMessageMetadata('final', {
  completionStatus: 'complete',
  finishReason: 'stop',
});

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

describe('foreground scenario entry point and outer deadline', () => {
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
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Completed.', undefined, undefined, completeFinalMetadata);
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
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
      scenarioTimeoutMs: 60_000,
      turns: [{ content: '', attachments: [attachment] }],
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
        scenarioTimeoutMs: 60_000,
        turns: [{ content: '  ' }],
      }),
    ).rejects.toThrow('must contain text or an attachment');
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('starts a product-created conversation with no prior raw chat and shared durable memory', async () => {
    const userMessageCounts: number[] = [];
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      userMessageCounts.push(options.messages.filter((message) => message.role === 'user').length);
      callbacks.onAssistantMessage('Completed.', undefined, undefined, completeFinalMetadata);
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const result = await runForegroundScenario({
      provider: makeProvider(),
      conversationId: 'scenario-conversation',
      conversationTitle: 'Scenario title',
      systemPrompt: 'Scenario prompt',
      scenarioTimeoutMs: 60_000,
      turns: [
        { content: 'Remember this preference.' },
        {
          content: 'What do you remember?',
          lifecycleBefore: 'context_reset',
        },
      ],
    });

    expect(userMessageCounts).toEqual([1, 1]);
    expect(result.turns[1]?.lifecycleBefore).toEqual({
      boundary: 'context_reset',
      chatStore: 'context_archived',
      memoryStore: 'shared_global',
      previousLiveMessageCount: 2,
      liveMessageCountAfter: 0,
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
      scenarioTimeoutMs: 25,
      timeoutMs: 1_000,
      turns: [{ content: 'Complete, then persist.' }],
    });
    const rejection = expect(run).rejects.toThrow(
      'Timed-out foreground execution did not settle before cleanup.',
    );
    await jest.advanceTimersByTimeAsync(25);
    await rejection;
    jest.useRealTimers();
  });
});
