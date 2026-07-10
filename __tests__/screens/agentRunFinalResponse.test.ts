import {
  createAgentRunFinalResponse,
  type CreateAgentRunFinalResponseParams,
  type ResolveConversationFinalizationContext,
} from '../../src/screens/agentRunFinalResponse';
import { synthesizeAgentRunCompletion } from '../../src/screens/agentRunCompletionSynthesis';
import {
  recordAgentRunFinalResponseDelivery,
  writeSynthesizedFinalResponse,
} from '../../src/screens/agentRunFinalResponseDelivery';
import { resolvePreferredAgentRunFinalResponseMessageId } from '../../src/screens/agentRunFinalResponseSelection';
import { tryDeliverPreferredFinalResponse } from '../../src/screens/agentRunPreferredFinalResponse';
import {
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
} from '../../src/services/agents/lifecycle/agentRunStateMachine';
import { createAgentRunIdentityKey } from '../../src/services/agents/agentRunIdentity';
import { useChatStore } from '../../src/store/useChatStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import { makeTestProviderConfig } from '../fixtures/providers';

jest.mock('../../src/screens/agentRunCompletionSynthesis', () => ({
  synthesizeAgentRunCompletion: jest.fn(),
}));
jest.mock('../../src/screens/agentRunFinalResponseDelivery', () => ({
  recordAgentRunFinalResponseDelivery: jest.fn(),
  writeSynthesizedFinalResponse: jest.fn(),
}));
jest.mock('../../src/screens/agentRunFinalResponseSelection', () => ({
  resolvePreferredAgentRunFinalResponseMessageId: jest.fn(),
}));
jest.mock('../../src/screens/agentRunPreferredFinalResponse', () => ({
  tryDeliverPreferredFinalResponse: jest.fn(),
}));
jest.mock('../../src/services/agents/lifecycle/agentRunStateMachine', () => {
  const actual = jest.requireActual('../../src/services/agents/lifecycle/agentRunStateMachine');
  return {
    ...actual,
    getLatestFinalAssistantResponsePreview: jest.fn(),
    hasDeliveredFinalAssistantResponse: jest.fn(),
  };
});

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'user-1',
    goal: 'Finish the task',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'review',
    phases: [],
    checkpoints: [],
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

function seedConversation(run = makeRun()): Conversation {
  const conversation: Conversation = {
    id: 'conversation-1',
    title: 'Test conversation',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Finish the task',
        timestamp: 1,
      },
    ],
    providerId: 'provider-1',
    systemPrompt: 'Be helpful.',
    createdAt: 1,
    updatedAt: 2,
    agentRuns: [run],
  };
  useChatStore.setState({
    conversations: [conversation],
    activeConversationId: conversation.id,
    isLoading: false,
  });
  return conversation;
}

function createDependencies(params: {
  pending: Map<string, Promise<string | undefined>>;
  getResolver?: () => ResolveConversationFinalizationContext | undefined;
}): CreateAgentRunFinalResponseParams {
  return {
    appendAgentRunCheckpoint: jest.fn(),
    appendConversationLog: jest.fn(),
    pendingAgentRunFinalizations: params.pending,
    getResolveConversationFinalizationContext: params.getResolver ?? (() => undefined),
    setAgentRunPhase: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    updateMessage: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
    updateMessageProviderReplay: jest.fn(),
  };
}

describe('createAgentRunFinalResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    jest.mocked(hasDeliveredFinalAssistantResponse).mockReturnValue(false);
    jest.mocked(getLatestFinalAssistantResponsePreview).mockReturnValue(undefined);
    jest.mocked(resolvePreferredAgentRunFinalResponseMessageId).mockReturnValue(undefined);
    jest.mocked(tryDeliverPreferredFinalResponse).mockReturnValue(undefined);
  });

  it('shares one in-flight synthesis and records one final delivery', async () => {
    seedConversation();
    const pending = new Map<string, Promise<string | undefined>>();
    const dependencies = createDependencies({ pending });
    const resolver = jest.fn();
    let resolveSynthesis: ((value: { output: string; source: 'graph' }) => void) | undefined;
    jest.mocked(synthesizeAgentRunCompletion).mockReturnValue(
      new Promise((resolve) => {
        resolveSynthesis = resolve;
      }),
    );
    jest.mocked(writeSynthesizedFinalResponse).mockReturnValue('Final preview');

    const ensureFinalResponse = createAgentRunFinalResponse({
      ...dependencies,
      getResolveConversationFinalizationContext: () => resolver,
    });
    const request = {
      conversationId: 'conversation-1',
      runId: 'run-1',
      status: 'completed' as const,
    };

    const first = ensureFinalResponse(request);
    const second = ensureFinalResponse(request);

    expect(synthesizeAgentRunCompletion).toHaveBeenCalledTimes(1);
    const runIdentityKey = createAgentRunIdentityKey(request);
    expect(pending.has(runIdentityKey)).toBe(true);
    resolveSynthesis?.({ output: 'Final answer', source: 'graph' });

    await expect(Promise.all([first, second])).resolves.toEqual(['Final preview', 'Final preview']);
    expect(writeSynthesizedFinalResponse).toHaveBeenCalledTimes(1);
    expect(recordAgentRunFinalResponseDelivery).toHaveBeenCalledTimes(1);
    expect(pending.has(runIdentityKey)).toBe(false);
  });

  it('runs identical run ids independently across conversations', async () => {
    const firstConversation = seedConversation();
    const secondConversation: Conversation = {
      ...firstConversation,
      id: 'conversation-2',
      title: 'Second conversation',
      messages: firstConversation.messages.map((message) => ({ ...message })),
      agentRuns: [makeRun()],
    };
    useChatStore.setState({
      conversations: [firstConversation, secondConversation],
      activeConversationId: firstConversation.id,
      isLoading: false,
    });

    const pending = new Map<string, Promise<string | undefined>>();
    const ensureFinalResponse = createAgentRunFinalResponse(createDependencies({ pending }));
    const synthesisResolvers = new Map<
      string,
      (value: { output: string; source: 'graph' }) => void
    >();
    jest.mocked(synthesizeAgentRunCompletion).mockImplementation(
      ({ conversationId }) =>
        new Promise((resolve) => {
          synthesisResolvers.set(conversationId, resolve);
        }),
    );
    jest
      .mocked(writeSynthesizedFinalResponse)
      .mockImplementation(({ conversation }) => `Final preview for ${conversation.id}`);

    const first = ensureFinalResponse({
      conversationId: firstConversation.id,
      runId: 'run-1',
      status: 'completed',
    });
    const second = ensureFinalResponse({
      conversationId: secondConversation.id,
      runId: 'run-1',
      status: 'completed',
    });

    expect(synthesizeAgentRunCompletion).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(2);
    synthesisResolvers.get(firstConversation.id)?.({ output: 'First', source: 'graph' });
    await expect(first).resolves.toBe('Final preview for conversation-1');
    expect(pending.size).toBe(1);
    expect(
      pending.has(
        createAgentRunIdentityKey({
          conversationId: secondConversation.id,
          runId: 'run-1',
        }),
      ),
    ).toBe(true);

    synthesisResolvers.get(secondConversation.id)?.({ output: 'Second', source: 'graph' });
    await expect(second).resolves.toBe('Final preview for conversation-2');
    expect(pending.size).toBe(0);
    expect(recordAgentRunFinalResponseDelivery).toHaveBeenCalledTimes(2);
  });

  it('reads the current finalization resolver when a run reaches synthesis', async () => {
    const conversation = seedConversation();
    const pending = new Map<string, Promise<string | undefined>>();
    const firstResolver = jest.fn();
    const latestResolver = jest.fn();
    let currentResolver: ResolveConversationFinalizationContext = firstResolver;
    const ensureFinalResponse = createAgentRunFinalResponse(
      createDependencies({
        pending,
        getResolver: () => currentResolver,
      }),
    );
    currentResolver = latestResolver;
    jest.mocked(synthesizeAgentRunCompletion).mockResolvedValue({
      output: 'Final answer',
      source: 'graph',
    });
    jest.mocked(writeSynthesizedFinalResponse).mockReturnValue('Final preview');

    await ensureFinalResponse({
      conversationId: conversation.id,
      runId: 'run-1',
      status: 'completed',
    });

    expect(synthesizeAgentRunCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        resolveConversationFinalizationContext: latestResolver,
      }),
    );
  });

  it('keeps an existing delivered response without synthesizing another one', async () => {
    const conversation = seedConversation(makeRun({ status: 'completed' }));
    const provider = makeTestProviderConfig({ id: 'provider-1' });
    jest.mocked(hasDeliveredFinalAssistantResponse).mockReturnValue(true);
    jest.mocked(getLatestFinalAssistantResponsePreview).mockReturnValue('Existing answer');
    const ensureFinalResponse = createAgentRunFinalResponse(
      createDependencies({ pending: new Map() }),
    );

    await expect(
      ensureFinalResponse({
        conversationId: conversation.id,
        runId: 'run-1',
        status: 'completed',
        providerContext: {
          provider,
          model: provider.model,
          systemPromptText: conversation.systemPrompt,
          conversationId: conversation.id,
        },
      }),
    ).resolves.toBe('Existing answer');

    expect(synthesizeAgentRunCompletion).not.toHaveBeenCalled();
    expect(writeSynthesizedFinalResponse).not.toHaveBeenCalled();
  });
});
