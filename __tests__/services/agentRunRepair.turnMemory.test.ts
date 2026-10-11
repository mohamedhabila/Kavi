import { repairTerminalAgentRunsMissingFinalResponses } from '../../src/services/agents/agentRunRepair';

const mockPublishConversationTurnMemory = jest.fn();
const mockFlushChatStorePersistenceNow = jest.fn();
const mockAppendAgentRunCheckpoint = jest.fn();
const mockAddConversationLog = jest.fn();
let mockChatStoreState: any;

function updateConversation(conversationId: string, updater: (conversation: any) => any): void {
  mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation: any) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => mockChatStoreState },
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      activeProviderId: 'openai',
      activeModel: 'gpt-5.4',
      systemPrompt: 'You are helpful.',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-5.4',
          enabled: true,
        },
      ],
    }),
  },
}));

jest.mock('../../src/services/memory/core/memoryCapture', () => ({
  publishConversationTurnMemory: (...args: unknown[]) => mockPublishConversationTurnMemory(...args),
}));

jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: unknown[]) => mockFlushChatStorePersistenceNow(...args),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: jest.fn(() => []),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => 'generated-id'),
}));

function terminalRun() {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task.',
    status: 'completed',
    createdAt: 1,
    updatedAt: 3,
    currentPhase: 'deliver',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
  };
}

function seedConversation(
  params: {
    delivered?: boolean;
    existingDraft?: boolean;
  } = {},
): void {
  const assistantMessage = params.delivered
    ? {
        id: 'assistant-final',
        role: 'assistant',
        content: 'Already delivered.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      }
    : params.existingDraft
      ? {
          id: 'assistant-partial',
          role: 'assistant',
          content: 'Interrupted draft.',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        }
      : undefined;
  mockChatStoreState.conversations = [
    {
      id: 'conv-1',
      title: 'Turn repair',
      providerId: 'openai',
      systemPrompt: 'You are helpful.',
      createdAt: 1,
      updatedAt: 3,
      messages: [
        { id: 'user-1', role: 'user', content: 'Finish the task.', timestamp: 1 },
        ...(assistantMessage ? [assistantMessage] : []),
      ],
      agentRuns: [terminalRun()],
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
  mockChatStoreState = {
    conversations: [],
    updateMessage: (conversationId: string, messageId: string, content: string) =>
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, content } : message,
        ),
      })),
    updateMessageAssistantMetadata: (
      conversationId: string,
      messageId: string,
      assistantMetadata: any,
    ) =>
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, assistantMetadata } : message,
        ),
      })),
    updateMessageProviderReplay: jest.fn(),
    addMessage: (conversationId: string, message: any) =>
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, { ...message, timestamp: 5 }],
      })),
    appendAgentRunCheckpoint: mockAppendAgentRunCheckpoint,
    updateAgentRunSummary: jest.fn(),
    addConversationLog: mockAddConversationLog,
  };
});

describe('terminal agent-run repair turn capture', () => {
  it.each([
    { label: 'a new final', existingDraft: false, messageId: 'generated-id' },
    { label: 'a repaired draft', existingDraft: true, messageId: 'assistant-partial' },
  ])(
    'persists $label before capturing its turn and reporting delivery',
    async ({ existingDraft, messageId }) => {
      seedConversation({ existingDraft });

      await expect(
        repairTerminalAgentRunsMissingFinalResponses({
          activeSubAgents: [],
          synthesisSweepBudgetMs: 0,
        }),
      ).resolves.toEqual(['run-1']);

      expect(mockPublishConversationTurnMemory).toHaveBeenCalledWith('conv-1', messageId);
      expect(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishConversationTurnMemory.mock.invocationCallOrder[0],
      );
      expect(mockPublishConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
        mockAppendAgentRunCheckpoint.mock.invocationCallOrder[0],
      );
    },
  );

  it('leaves a historical delivered final alone', async () => {
    seedConversation({ delivered: true });

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual([]);

    expect(mockPublishConversationTurnMemory).not.toHaveBeenCalled();
    expect(mockFlushChatStorePersistenceNow).not.toHaveBeenCalled();
  });

  it('neither captures nor reports a repaired run whose final cannot be flushed', async () => {
    seedConversation({ existingDraft: true });
    mockFlushChatStorePersistenceNow.mockRejectedValueOnce(new Error('persistence failed'));

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({
        activeSubAgents: [],
        synthesisSweepBudgetMs: 0,
      }),
    ).rejects.toThrow('persistence failed');

    expect(mockPublishConversationTurnMemory).not.toHaveBeenCalled();
    expect(mockAppendAgentRunCheckpoint).not.toHaveBeenCalled();
    expect(mockAddConversationLog).not.toHaveBeenCalled();
  });
});
