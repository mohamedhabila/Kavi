import { renderHook, waitFor } from '@testing-library/react-native';
import {
  recoverTerminalFinalResponse,
  useForegroundRunRecoveryEffects,
} from '../../src/engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import { useChatStore } from '../../src/store/useChatStore';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
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
    providerId: 'provider-1',
    systemPrompt: '',
    agentRuns: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function finalMessage(id = 'final-1'): Message {
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
  });
}

function recoveredConversation(params?: { finals?: Message[] }): Conversation {
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
  });
}

function recoveryDependencies(params?: { flushChatState?: jest.Mock<Promise<void>, []> }) {
  return {
    flushChatState: params?.flushChatState ?? jest.fn().mockResolvedValue(undefined),
    getConversations: () => useChatStore.getState().conversations,
    recordConversationTurnMemory: jest.fn(),
  };
}

function installRecoveredFinal(finals?: Message[]): void {
  useChatStore.setState({ conversations: [recoveredConversation({ finals })] });
}

describe('terminal final-response recovery', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [conversation()] });
  });

  it('persists the repaired final before capturing its turn', async () => {
    const provider = makeTestProviderConfig({ id: 'provider-1', model: 'configured-model' });
    const events: string[] = [];
    const flushChatState = jest.fn(async () => {
      events.push('flush');
    });
    const dependencies = recoveryDependencies({ flushChatState });
    dependencies.recordConversationTurnMemory.mockImplementation(() => events.push('capture'));
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
        dependencies,
      ),
    ).resolves.toBe('Recovered answer');

    expect(events).toEqual(['flush', 'capture']);
    expect(dependencies.recordConversationTurnMemory).toHaveBeenCalledWith(
      candidate.conversationId,
      'final-1',
    );
    expect(ensureAgentRunFinalResponse).toHaveBeenCalledWith({
      conversationId: candidate.conversationId,
      runId: candidate.runId,
      status: candidate.status,
      providerContext: expect.objectContaining({ model: 'sealed-model' }),
      timestamp: candidate.timestamp,
    });
  });

  it('captures the latest exact assistant projection while ignoring worker events', async () => {
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

    expect(dependencies.recordConversationTurnMemory).toHaveBeenCalledWith(
      candidate.conversationId,
      'final-latest',
    );
  });

  it('returns a final that already existed without synthesis', async () => {
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
    expect(dependencies.recordConversationTurnMemory).not.toHaveBeenCalled();
  });

  it('captures nothing when final delivery cannot be recovered', async () => {
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
    expect(dependencies.recordConversationTurnMemory).not.toHaveBeenCalled();
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
    expect(dependencies.recordConversationTurnMemory).not.toHaveBeenCalled();
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
    const failure = new Error('final synthesis unavailable');
    const ensureAgentRunFinalResponse = jest.fn().mockRejectedValue(failure);

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
        '[foreground-recovery] Terminal final response recovery failed:',
        failure,
      ),
    );

    hook.unmount();
    warning.mockRestore();
  });
});
