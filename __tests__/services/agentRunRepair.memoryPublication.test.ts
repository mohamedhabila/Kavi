import { repairTerminalAgentRunsMissingFinalResponses } from '../../src/services/agents/agentRunRepair';

const mockTransitionMessageMemoryPublication = jest.fn();
const mockFlushChatStorePersistenceNow = jest.fn();
const mockAppendAgentRunCheckpoint = jest.fn();
const mockAddConversationLog = jest.fn();
let mockDisableLongTermMemory = false;
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
      disableLongTermMemory: mockDisableLongTermMemory,
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
    isSideThread?: boolean;
  } = {},
): void {
  const assistantMessage = params.delivered
    ? {
        id: 'assistant-final',
        role: 'assistant',
        content: 'Already delivered.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
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
      title: 'Publication repair',
      providerId: 'openai',
      systemPrompt: 'You are helpful.',
      createdAt: 1,
      updatedAt: 3,
      isSideThread: params.isSideThread,
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
  mockDisableLongTermMemory = false;
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
    transitionMessageMemoryPublication: mockTransitionMessageMemoryPublication.mockImplementation(
      (conversationId: string, messageId: string, disposition: any) => {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId
              ? { ...message, memoryPublication: { version: 1, disposition } }
              : message,
          ),
        }));
        return {
          status: 'applied',
          changed: true,
          publication: { version: 1, disposition },
        };
      },
    ),
    appendAgentRunCheckpoint: mockAppendAgentRunCheckpoint,
    updateAgentRunSummary: jest.fn(),
    addConversationLog: mockAddConversationLog,
  };
});

describe('terminal agent-run repair memory publication', () => {
  it.each([
    {
      label: 'an enabled canonical thread',
      disableLongTermMemory: false,
      existingDraft: false,
      isSideThread: false,
      messageId: 'generated-id',
      disposition: null,
    },
    {
      label: 'a memory opt-out',
      disableLongTermMemory: true,
      existingDraft: true,
      isSideThread: false,
      messageId: 'assistant-partial',
      disposition: 'opt_out',
    },
    {
      label: 'a side thread',
      disableLongTermMemory: false,
      existingDraft: true,
      isSideThread: true,
      messageId: 'assistant-partial',
      disposition: 'ephemeral_thread',
    },
  ])(
    'persists the repaired final and publication intent for $label before reporting delivery',
    async ({ disableLongTermMemory, disposition, existingDraft, isSideThread, messageId }) => {
      mockDisableLongTermMemory = disableLongTermMemory;
      seedConversation({ existingDraft, isSideThread });

      await expect(
        repairTerminalAgentRunsMissingFinalResponses({
          activeSubAgents: [],
          synthesisSweepBudgetMs: 0,
        }),
      ).resolves.toEqual(['run-1']);

      expect(mockTransitionMessageMemoryPublication).toHaveBeenCalledWith(
        'conv-1',
        messageId,
        disposition,
      );
      expect(
        mockChatStoreState.conversations[0].messages.find(
          (message: any) => message.id === messageId,
        ).memoryPublication,
      ).toEqual({ version: 1, disposition });
      expect(mockTransitionMessageMemoryPublication.mock.invocationCallOrder[0]).toBeLessThan(
        mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0],
      );
      expect(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
        mockAppendAgentRunCheckpoint.mock.invocationCallOrder[0],
      );
    },
  );

  it('leaves an absent receipt absent on a historical delivered final', async () => {
    seedConversation({ delivered: true });

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual([]);

    expect(mockTransitionMessageMemoryPublication).not.toHaveBeenCalled();
    expect(mockFlushChatStorePersistenceNow).not.toHaveBeenCalled();
    expect(mockChatStoreState.conversations[0].messages[1].memoryPublication).toBeUndefined();
  });

  it('fails before durability or success bookkeeping when receipt initialization is rejected', async () => {
    seedConversation({ existingDraft: true });
    mockTransitionMessageMemoryPublication.mockReturnValueOnce({
      status: 'rejected',
      reason: 'transition_conflict',
    });

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({
        activeSubAgents: [],
        synthesisSweepBudgetMs: 0,
      }),
    ).rejects.toThrow('agent_run_repair_memory_publication_transition_conflict');

    expect(mockFlushChatStorePersistenceNow).not.toHaveBeenCalled();
    expect(mockAppendAgentRunCheckpoint).not.toHaveBeenCalled();
    expect(mockAddConversationLog).not.toHaveBeenCalled();
  });

  it('does not report a repaired run when the final and receipt cannot be flushed', async () => {
    seedConversation({ existingDraft: true });
    mockFlushChatStorePersistenceNow.mockRejectedValueOnce(new Error('persistence failed'));

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({
        activeSubAgents: [],
        synthesisSweepBudgetMs: 0,
      }),
    ).rejects.toThrow('persistence failed');

    expect(mockTransitionMessageMemoryPublication).toHaveBeenCalledTimes(1);
    expect(mockAppendAgentRunCheckpoint).not.toHaveBeenCalled();
    expect(mockAddConversationLog).not.toHaveBeenCalled();
  });
});
