import { recoverTerminalFinalResponse } from '../../src/engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import { useChatStore } from '../../src/store/useChatStore';
import type { Conversation } from '../../src/types/conversation';
import { makeTestProviderConfig } from '../fixtures/providers';
import { makeTestAgentRun } from '../helpers/factories';

const conversation: Conversation = {
  id: 'conversation-1',
  title: 'Recovered run',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
};

const candidate = {
  conversationId: conversation.id,
  runId: 'run-1',
  status: 'completed' as const,
  timestamp: 20,
};

describe('terminal final-response recovery', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [conversation] } as never);
  });

  it('records the recovered terminal turn exactly after final delivery succeeds', async () => {
    const provider = makeTestProviderConfig({ id: 'provider-1', model: 'configured-model' });
    const ensureAgentRunFinalResponse = jest.fn().mockImplementation(async () => {
      useChatStore.setState({
        conversations: [
          {
            ...conversation,
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'Recover the answer.',
                timestamp: 1,
              },
              {
                id: 'final-1',
                role: 'assistant',
                content: 'Recovered answer',
                timestamp: 20,
                assistantMetadata: { kind: 'final', completionStatus: 'complete' },
              },
            ],
            agentRuns: [
              makeTestAgentRun({
                id: candidate.runId,
                userMessageId: 'user-1',
                status: candidate.status,
              }),
            ],
          },
        ],
      });
      return 'Recovered answer';
    });
    const recordConversationTurnMemory = jest.fn();

    await expect(
      recoverTerminalFinalResponse({
        candidate,
        conversations: [conversation],
        ensureAgentRunFinalResponse,
        providerContext: {
          provider,
          model: 'sealed-model',
          systemPromptText: 'Be helpful.',
          conversationId: conversation.id,
        },
        recordConversationTurnMemory,
      }),
    ).resolves.toBe('Recovered answer');

    expect(ensureAgentRunFinalResponse).toHaveBeenCalledWith({
      conversationId: conversation.id,
      runId: candidate.runId,
      status: candidate.status,
      providerContext: expect.objectContaining({ model: 'sealed-model' }),
      timestamp: candidate.timestamp,
    });
    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ id: provider.id, model: 'sealed-model' }),
      {
        sourceEndMessageId: 'final-1',
        memoryConversationId: conversation.id,
        sourceRunId: candidate.runId,
      },
    );
  });

  it('does not close memory when final delivery cannot be recovered', async () => {
    const recordConversationTurnMemory = jest.fn();

    await expect(
      recoverTerminalFinalResponse({
        candidate,
        conversations: [conversation],
        ensureAgentRunFinalResponse: jest.fn().mockResolvedValue(undefined),
        providerContext: undefined,
        recordConversationTurnMemory,
      }),
    ).resolves.toBeUndefined();

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });
});
