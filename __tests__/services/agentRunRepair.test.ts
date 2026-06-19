import { repairTerminalAgentRunsMissingFinalResponses } from '../../src/services/agents/agentRunRepair';

const mockGetProviderApiKey = jest.fn().mockResolvedValue(undefined);
const mockUpdateMessage = jest.fn();
const mockUpdateMessageAssistantMetadata = jest.fn();
const mockUpdateMessageProviderReplay = jest.fn();
const mockAddMessage = jest.fn();
const mockAppendAgentRunCheckpoint = jest.fn();
const mockUpdateAgentRunSummary = jest.fn();
const mockAddConversationLog = jest.fn();

let mockChatStoreState: any;

function updateConversation(conversationId: string, updater: (conversation: any) => any) {
  mockChatStoreState.conversations = mockChatStoreState.conversations.map((conversation: any) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatStoreState,
  },
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

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: jest.fn(() => []),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => 'generated-id'),
}));

function createTerminalRun(overrides: Partial<any> = {}) {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Complete the task.',
    status: 'completed',
    createdAt: 1,
    updatedAt: 3,
    currentPhase: 'deliver',
    phases: [],
    checkpoints: [],
    latestSummary: 'Recovering the final response from verified results.',
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockChatStoreState = {
    conversations: [],
    updateMessage: mockUpdateMessage.mockImplementation(
      (conversationId: string, messageId: string, content: string) => {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, content } : message,
          ),
        }));
      },
    ),
    updateMessageAssistantMetadata: mockUpdateMessageAssistantMetadata.mockImplementation(
      (conversationId: string, messageId: string, assistantMetadata: any) => {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, assistantMetadata } : message,
          ),
        }));
      },
    ),
    updateMessageProviderReplay: mockUpdateMessageProviderReplay,
    addMessage: mockAddMessage.mockImplementation((conversationId: string, message: any) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, { ...message, timestamp: 5 }],
      }));
    }),
    appendAgentRunCheckpoint: mockAppendAgentRunCheckpoint,
    updateAgentRunSummary: mockUpdateAgentRunSummary,
    addConversationLog: mockAddConversationLog,
  };
});

describe('repairTerminalAgentRunsMissingFinalResponses', () => {
  it('repairs terminal runs from live worker snapshots even when the completion message was never persisted', async () => {
    mockChatStoreState.conversations = [
      {
        id: 'conv-1',
        title: 'Repo audit',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        createdAt: 1,
        updatedAt: 4,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Audit the repository.',
            timestamp: 1,
          },
          {
            id: 'assistant-partial',
            role: 'assistant',
            content: '',
            timestamp: 2,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ],
        agentRuns: [
          createTerminalRun({
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          }),
        ],
      },
    ];

    const repairedRunIds = await repairTerminalAgentRunsMissingFinalResponses({
      activeSubAgents: [
        {
          sessionId: 'sub-1',
          parentConversationId: 'conv-1',
          agentRunId: 'run-1',
          depth: 1,
          startedAt: 2,
          updatedAt: 4,
          status: 'completed',
          sandboxPolicy: 'inherit',
          output:
            'Repository audit complete after verifying the workflow repairs and passing the targeted tests.',
          toolsUsed: ['sessions_spawn'],
        },
      ],
    });

    expect(repairedRunIds).toEqual(['run-1']);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      'Repository audit complete after verifying the workflow repairs and passing the targeted tests.',
    );
    expect(mockChatStoreState.conversations[0].messages[1]).toEqual(
      expect.objectContaining({
        content:
          'Repository audit complete after verifying the workflow repairs and passing the targeted tests.',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
    expect(mockUpdateMessageProviderReplay).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      undefined,
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        title: 'Final response delivered',
      }),
      'run-1',
    );
  });

  it('promotes an interrupted assistant draft to a final response when synthesis is unavailable', async () => {
    mockChatStoreState.conversations = [
      {
        id: 'conv-1',
        title: 'Cleanup',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        createdAt: 1,
        updatedAt: 3,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Summarize the cleanup.',
            timestamp: 1,
          },
          {
            id: 'assistant-partial',
            role: 'assistant',
            content: 'Interrupted draft answer',
            timestamp: 2,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ],
        agentRuns: [createTerminalRun()],
      },
    ];

    const repairedRunIds = await repairTerminalAgentRunsMissingFinalResponses({
      activeSubAgents: [],
    });

    expect(repairedRunIds).toEqual(['run-1']);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      'The run completed, but no final response was generated.',
    );
    expect(mockUpdateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'complete',
      }),
    );
    expect(mockChatStoreState.conversations[0].messages[1]).toEqual(
      expect.objectContaining({
        content: 'The run completed, but no final response was generated.',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
  });

  it('uses a safe failure fallback instead of promoting an interrupted draft for failed runs', async () => {
    mockChatStoreState.conversations = [
      {
        id: 'conv-1',
        title: 'Cleanup',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        createdAt: 1,
        updatedAt: 3,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Summarize the cleanup.',
            timestamp: 1,
          },
          {
            id: 'assistant-partial',
            role: 'assistant',
            content: 'Interrupted draft answer',
            timestamp: 2,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ],
        agentRuns: [createTerminalRun({ status: 'failed', currentPhase: 'work' })],
      },
    ];

    const repairedRunIds = await repairTerminalAgentRunsMissingFinalResponses({
      activeSubAgents: [],
    });

    expect(repairedRunIds).toEqual(['run-1']);
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      'The run failed before it generated a final response.',
    );
    expect(mockUpdateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conv-1',
      'assistant-partial',
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'complete',
      }),
    );
  });

  it('does not repair an older terminal run while a newer run in the same conversation is still active', async () => {
    mockChatStoreState.conversations = [
      {
        id: 'conv-1',
        title: 'Research',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        createdAt: 1,
        updatedAt: 6,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Complete the first research task.',
            timestamp: 1,
          },
          {
            id: 'user-2',
            role: 'user',
            content: 'Continue with a second research task.',
            timestamp: 5,
          },
          {
            id: 'assistant-running',
            role: 'assistant',
            content: '',
            timestamp: 6,
            toolCalls: [
              {
                id: 'tool-running',
                name: 'web_fetch',
                arguments: '{"urls":["https://example.com"]}',
                status: 'running',
                createdAt: 6,
                updatedAt: 6,
              },
            ],
          },
        ],
        agentRuns: [
          createTerminalRun({
            id: 'run-terminal',
            userMessageId: 'user-1',
            createdAt: 1,
            updatedAt: 4,
          }),
          {
            ...createTerminalRun({
              id: 'run-active',
              userMessageId: 'user-2',
              createdAt: 5,
              updatedAt: 6,
            }),
            status: 'running',
            currentPhase: 'work',
          },
        ],
      },
    ];

    const repairedRunIds = await repairTerminalAgentRunsMissingFinalResponses({
      activeSubAgents: [],
    });

    expect(repairedRunIds).toEqual([]);
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockAppendAgentRunCheckpoint).not.toHaveBeenCalled();
  });
});
