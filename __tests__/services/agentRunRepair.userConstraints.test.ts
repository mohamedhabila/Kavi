import { repairTerminalAgentRunsMissingFinalResponses } from '../../src/services/agents/agentRunRepair';

const mockSynthesizeAgentRunFinalAnswer = jest.fn();
const mockFlushChatStorePersistenceNow = jest.fn();
const mockUpdateAgentRunControlGraph = jest.fn();
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

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('test-key'),
}));

jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: unknown[]) => mockFlushChatStorePersistenceNow(...args),
}));

jest.mock('../../src/services/agents/lifecycle/finalizePhase', () => {
  const actual = jest.requireActual('../../src/services/agents/lifecycle/finalizePhase');
  return {
    ...actual,
    synthesizeAgentRunFinalAnswer: (...args: unknown[]) =>
      mockSynthesizeAgentRunFinalAnswer(...args),
  };
});

jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: jest.fn(() => []),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => 'generated-id'),
}));

function controlGraph() {
  return {
    version: 1,
    status: 'finalized',
    iteration: 1,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    lastModelToolNames: [],
    goals: [
      {
        id: 'deliver',
        title: 'Deliver exact answer',
        status: 'completed',
        dependencies: [],
        evidence: ['Verified report'],
        successCriteria: ['Deliver in Dutch.'],
        completionPolicy: 'blocking',
        userConstraints: [{ text: 'Answer in Dutch.', sourceMessageId: 'user-1' }],
        userConstraintDeliveryPending: true,
        createdAt: 1,
        updatedAt: 3,
        completedAt: 3,
      },
    ],
    asyncWork: { awaitingBackgroundWorkers: false, pendingOperations: [], updatedAt: 3 },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 1,
      toolExecutionDurationMs: 1,
      lastCandidateToolCount: 1,
      lastActiveToolCount: 1,
      maxActiveToolCount: 1,
      lastActiveToolTokenEstimate: 1,
      maxActiveToolTokenEstimate: 1,
      updatedAt: 3,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 3,
  };
}

function terminalRun(status: 'completed' | 'failed' = 'completed') {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Answer in Dutch.',
    status,
    createdAt: 1,
    updatedAt: 3,
    currentPhase: status === 'completed' ? 'deliver' : 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: controlGraph(),
  };
}

function seed(params: { delivered?: boolean; status?: 'completed' | 'failed' } = {}): void {
  const messages: any[] = [
    { id: 'user-1', role: 'user', content: 'Answer in Dutch.', timestamp: 1 },
    {
      id: 'assistant-partial',
      role: 'assistant',
      content: 'Verified report evidence is available.',
      timestamp: 2,
      assistantMetadata: {
        kind: 'final',
        completionStatus: params.delivered ? 'complete' : 'incomplete',
        finishReason: params.delivered ? 'stop' : 'response_failed',
      },
    },
  ];
  mockChatStoreState = {
    conversations: [
      {
        id: 'conv-1',
        title: 'Constrained repair',
        providerId: 'openai',
        systemPrompt: 'You are helpful.',
        createdAt: 1,
        updatedAt: 4,
        messages,
        agentRuns: [terminalRun(params.status)],
      },
    ],
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
    addMessage: jest.fn(),
    transitionMessageMemoryPublication: (
      conversationId: string,
      messageId: string,
      disposition: any,
    ) => {
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
    appendAgentRunCheckpoint: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    addConversationLog: jest.fn(),
    updateAgentRunControlGraph: mockUpdateAgentRunControlGraph.mockImplementation(
      (conversationId: string, nextControlGraph: any, runId: string) =>
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          agentRuns: conversation.agentRuns.map((run: any) =>
            run.id === runId ? { ...run, controlGraph: nextControlGraph } : run,
          ),
        })),
    ),
  };
}

describe('terminal agent-run constraint delivery repair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
    mockSynthesizeAgentRunFinalAnswer.mockResolvedValue({});
    seed();
  });

  it('persists and re-reads constrained synthesis before acknowledging delivery', async () => {
    mockSynthesizeAgentRunFinalAnswer.mockResolvedValue({ output: 'Het rapport is geverifieerd.' });

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual(['run-1']);

    expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingUserConstraints: [{ goalId: 'deliver', text: 'Answer in Dutch.' }],
      }),
    );
    expect(mockFlushChatStorePersistenceNow).toHaveBeenCalledTimes(2);
    expect(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateAgentRunControlGraph.mock.invocationCallOrder[0],
    );
    const repairedGraph = mockChatStoreState.conversations[0].agentRuns[0].controlGraph;
    expect(repairedGraph.goals[0]).not.toHaveProperty('userConstraintDeliveryPending');
    expect(repairedGraph.goals[0]).not.toHaveProperty('userConstraints');
    expect(repairedGraph.audit.slice(-2).map((event: any) => event.type)).toEqual([
      'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED',
      'FINALIZED',
    ]);
  });

  it('does not acknowledge when answer persistence fails', async () => {
    mockSynthesizeAgentRunFinalAnswer.mockResolvedValue({ output: 'Het rapport is geverifieerd.' });
    mockFlushChatStorePersistenceNow.mockRejectedValueOnce(new Error('persistence failed'));

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).rejects.toThrow('persistence failed');
    expect(mockUpdateAgentRunControlGraph).not.toHaveBeenCalled();
  });

  it('does not acknowledge a failed run', async () => {
    seed({ status: 'failed' });

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual(['run-1']);
    expect(mockUpdateAgentRunControlGraph).not.toHaveBeenCalled();
  });

  it('does not acknowledge an incomplete constrained synthesis', async () => {
    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual([]);
    expect(mockUpdateAgentRunControlGraph).not.toHaveBeenCalled();
    expect(mockFlushChatStorePersistenceNow).not.toHaveBeenCalled();
  });

  it('does not report a no-op graph update as a repaired acknowledgement', async () => {
    seed({ delivered: true });
    mockUpdateAgentRunControlGraph.mockImplementationOnce(() => undefined);

    await expect(
      repairTerminalAgentRunsMissingFinalResponses({ activeSubAgents: [] }),
    ).resolves.toEqual([]);
    expect(mockUpdateAgentRunControlGraph).toHaveBeenCalledTimes(1);
    expect(mockFlushChatStorePersistenceNow).not.toHaveBeenCalled();
  });
});
