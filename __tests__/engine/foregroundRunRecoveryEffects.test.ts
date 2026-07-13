import { renderHook, waitFor } from '@testing-library/react-native';
import {
  recoverTerminalFinalResponse,
  useForegroundRunRecoveryEffects,
} from '../../src/engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import { useChatStore } from '../../src/store/useChatStore';
import type { Conversation } from '../../src/types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../../src/types/message';
import { makeTestProviderConfig } from '../fixtures/providers';
import { makeTestAgentRun } from '../helpers/factories';

const candidate = {
  conversationId: 'conversation-1',
  runId: 'run-1',
  status: 'completed' as const,
  timestamp: 20,
};

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  } as Message;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: candidate.conversationId,
    title: 'Recovered run',
    messages: [],
    agentRuns: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function finalMessage(id = 'final-1', publication?: MessageMemoryPublicationDisposition): Message {
  return message({
    id,
    role: 'assistant',
    content: `Recovered answer from ${id}`,
    timestamp: 20,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'graph_finalized',
    },
    ...(publication !== undefined
      ? { memoryPublication: { version: 1, disposition: publication } }
      : {}),
  });
}

function recoveredConversation(params?: {
  finals?: Message[];
  isSideThread?: boolean;
}): Conversation {
  return conversation({
    messages: [
      message({ id: 'user-1', role: 'user', content: 'Recover the answer.', timestamp: 1 }),
      ...(params?.finals ?? [finalMessage()]),
    ],
    agentRuns: [
      makeTestAgentRun({
        id: candidate.runId,
        userMessageId: 'user-1',
        status: candidate.status,
      }),
    ],
    ...(params?.isSideThread ? { isSideThread: true } : {}),
  });
}

function recoveryDependencies(params?: {
  flushChatState?: jest.Mock<Promise<void>, []>;
  isMemoryEnabled?: boolean;
  settleMemoryPublication?: jest.Mock;
}) {
  return {
    flushChatState: params?.flushChatState ?? jest.fn().mockResolvedValue(undefined),
    getConversations: () => useChatStore.getState().conversations,
    isMemoryEnabled: () => params?.isMemoryEnabled ?? true,
    settleMemoryPublication:
      params?.settleMemoryPublication ??
      jest.fn().mockResolvedValue({
        conversationId: candidate.conversationId,
        sourceEndMessageId: 'final-1',
        status: 'terminal',
        disposition: 'enqueued',
      }),
    transitionMessageMemoryPublication: (
      conversationId: string,
      sourceEndMessageId: string,
      disposition: MessageMemoryPublicationDisposition,
    ) =>
      useChatStore
        .getState()
        .transitionMessageMemoryPublication(conversationId, sourceEndMessageId, disposition),
  };
}

function installRecoveredFinal(finals?: Message[], isSideThread = false): void {
  useChatStore.setState({
    conversations: [recoveredConversation({ finals, isSideThread })],
  });
}

describe('terminal final-response recovery', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [conversation()] });
  });

  it('flushes an open code-owned receipt before awaiting exact settlement', async () => {
    const provider = makeTestProviderConfig({ id: 'provider-1', model: 'configured-model' });
    const events: string[] = [];
    const flushChatState = jest.fn(async () => {
      events.push('flush');
      expect(useChatStore.getState().conversations[0].messages[1].memoryPublication).toEqual({
        version: 1,
        disposition: null,
      });
    });
    const settleMemoryPublication = jest.fn(async () => {
      events.push('settle');
      useChatStore
        .getState()
        .transitionMessageMemoryPublication(candidate.conversationId, 'final-1', 'enqueued');
      return {
        conversationId: candidate.conversationId,
        sourceEndMessageId: 'final-1',
        status: 'settled' as const,
        disposition: 'enqueued' as const,
      };
    });
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      installRecoveredFinal();
      return 'Recovered answer';
    });

    await expect(
      recoverTerminalFinalResponse(
        {
          candidate,
          ensureAgentRunFinalResponse,
          providerContext: {
            provider,
            model: 'sealed-model',
            systemPromptText: 'Be helpful.',
            conversationId: candidate.conversationId,
          },
        },
        recoveryDependencies({ flushChatState, settleMemoryPublication }),
      ),
    ).resolves.toBe('Recovered answer');

    expect(events).toEqual(['flush', 'settle']);
    expect(settleMemoryPublication).toHaveBeenCalledWith({
      conversationId: candidate.conversationId,
      sourceEndMessageId: 'final-1',
      sourceRunId: candidate.runId,
      activeChatProvider: expect.objectContaining({ id: provider.id, model: 'sealed-model' }),
    });
    expect(ensureAgentRunFinalResponse).toHaveBeenCalledWith({
      conversationId: candidate.conversationId,
      runId: candidate.runId,
      status: candidate.status,
      providerContext: expect.objectContaining({ model: 'sealed-model' }),
      timestamp: candidate.timestamp,
    });
  });

  it.each([
    { isMemoryEnabled: false, isSideThread: false, expected: 'opt_out' as const },
    { isMemoryEnabled: true, isSideThread: true, expected: 'ephemeral_thread' as const },
  ])('persists $expected before settling the recovered final', async (testCase) => {
    const settleMemoryPublication = jest.fn(async () => {
      expect(useChatStore.getState().conversations[0].messages[1].memoryPublication).toEqual({
        version: 1,
        disposition: testCase.expected,
      });
      return {
        conversationId: candidate.conversationId,
        sourceEndMessageId: 'final-1',
        status: 'terminal' as const,
        disposition: testCase.expected,
      };
    });
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      installRecoveredFinal(undefined, testCase.isSideThread);
      return 'Recovered answer';
    });
    const dependencies = recoveryDependencies({
      isMemoryEnabled: testCase.isMemoryEnabled,
      settleMemoryPublication,
    });

    await recoverTerminalFinalResponse(
      { candidate, ensureAgentRunFinalResponse, providerContext: undefined },
      dependencies,
    );

    expect(dependencies.flushChatState).toHaveBeenCalledTimes(1);
    expect(settleMemoryPublication).toHaveBeenCalledTimes(1);
  });

  it('leaves a durably open receipt and propagates settlement failure', async () => {
    const failure = new Error('settlement unavailable');
    const settleMemoryPublication = jest.fn().mockRejectedValue(failure);
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      installRecoveredFinal();
      return 'Recovered answer';
    });
    const dependencies = recoveryDependencies({ settleMemoryPublication });

    await expect(
      recoverTerminalFinalResponse(
        { candidate, ensureAgentRunFinalResponse, providerContext: undefined },
        dependencies,
      ),
    ).rejects.toBe(failure);

    expect(dependencies.flushChatState).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversations[0].messages[1].memoryPublication).toEqual({
      version: 1,
      disposition: null,
    });
  });

  it('publishes the latest exact assistant projection while ignoring worker events', async () => {
    const latest = finalMessage('final-latest');
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      installRecoveredFinal([
        finalMessage('final-old'),
        message({
          id: 'worker-event',
          role: 'assistant',
          content: 'Worker observation',
          timestamp: 30,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'worker-1',
              parentConversationId: candidate.conversationId,
              depth: 1,
              startedAt: 2,
              updatedAt: 30,
              status: 'completed',
              sandboxPolicy: 'inherit',
            },
          },
        }),
        latest,
      ]);
      return latest.content;
    });
    const dependencies = recoveryDependencies();

    await recoverTerminalFinalResponse(
      { candidate, ensureAgentRunFinalResponse, providerContext: undefined },
      dependencies,
    );

    expect(dependencies.settleMemoryPublication).toHaveBeenCalledWith(
      expect.objectContaining({ sourceEndMessageId: 'final-latest' }),
    );
    expect(useChatStore.getState().conversations[0].messages[1].memoryPublication).toBeUndefined();
    expect(useChatStore.getState().conversations[0].messages[3].memoryPublication).toEqual({
      version: 1,
      disposition: null,
    });
  });

  it('does not infer a missing receipt for a final that already existed', async () => {
    installRecoveredFinal();
    const ensureAgentRunFinalResponse = jest.fn();
    const dependencies = recoveryDependencies();

    await expect(
      recoverTerminalFinalResponse(
        { candidate, ensureAgentRunFinalResponse, providerContext: undefined },
        dependencies,
      ),
    ).resolves.toBe('Recovered answer from final-1');

    expect(ensureAgentRunFinalResponse).not.toHaveBeenCalled();
    expect(dependencies.flushChatState).not.toHaveBeenCalled();
    expect(dependencies.settleMemoryPublication).not.toHaveBeenCalled();
    expect(useChatStore.getState().conversations[0].messages[1].memoryPublication).toBeUndefined();
  });

  it('retries an explicit open receipt without re-running final synthesis', async () => {
    installRecoveredFinal([finalMessage('final-1', null)]);
    const ensureAgentRunFinalResponse = jest.fn();
    const dependencies = recoveryDependencies();

    await recoverTerminalFinalResponse(
      { candidate, ensureAgentRunFinalResponse, providerContext: undefined },
      dependencies,
    );

    expect(ensureAgentRunFinalResponse).not.toHaveBeenCalled();
    expect(dependencies.flushChatState).toHaveBeenCalledTimes(1);
    expect(dependencies.settleMemoryPublication).toHaveBeenCalledTimes(1);
  });

  it('does not initialize memory when final delivery cannot be recovered', async () => {
    const dependencies = recoveryDependencies();

    await expect(
      recoverTerminalFinalResponse(
        {
          candidate,
          ensureAgentRunFinalResponse: jest.fn().mockResolvedValue(undefined),
          providerContext: undefined,
        },
        dependencies,
      ),
    ).resolves.toBeUndefined();

    expect(dependencies.flushChatState).not.toHaveBeenCalled();
    expect(dependencies.settleMemoryPublication).not.toHaveBeenCalled();
  });

  it('fails closed when synthesis reports success without an exact complete final', async () => {
    const dependencies = recoveryDependencies();

    await expect(
      recoverTerminalFinalResponse(
        {
          candidate,
          ensureAgentRunFinalResponse: jest.fn().mockResolvedValue('Unpersisted preview'),
          providerContext: undefined,
        },
        dependencies,
      ),
    ).rejects.toThrow('terminal_final_recovery_final_unavailable');

    expect(dependencies.flushChatState).not.toHaveBeenCalled();
    expect(dependencies.settleMemoryPublication).not.toHaveBeenCalled();
  });

  it('catches and reports effect recovery failures without an unhandled rejection', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gap = conversation({
      messages: [
        message({ id: 'user-1', role: 'user', content: 'Do work', timestamp: 1 }),
        message({ id: 'draft-1', role: 'assistant', content: 'Draft', timestamp: 2 }),
      ],
      agentRuns: [
        makeTestAgentRun({
          id: candidate.runId,
          userMessageId: 'user-1',
          status: 'failed',
          updatedAt: candidate.timestamp,
        }),
      ],
    });
    useChatStore.setState({ conversations: [gap] });
    const duplicateFinal = finalMessage('duplicate-final');
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      installRecoveredFinal([duplicateFinal, { ...duplicateFinal }]);
      return duplicateFinal.content;
    });

    const hook = renderHook(() =>
      useForegroundRunRecoveryEffects({
        conversations: [gap],
        ensureAgentRunFinalResponse,
        queueTerminalBackgroundReview: jest.fn().mockResolvedValue(undefined),
        resolveConversationFinalizationContext: jest.fn().mockResolvedValue(undefined),
        subAgentActivityVersion: 0,
      }),
    );

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        '[foreground-recovery] Terminal final memory publication remains pending:',
        expect.objectContaining({
          message: 'terminal_final_recovery_memory_publication_source_identity_invalid',
        }),
      ),
    );

    hook.unmount();
    warning.mockRestore();
  });
});
