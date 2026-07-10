import { recoverTerminalFinalResponse } from '../../src/engine/graph/foregroundRun/useForegroundRunRecoveryEffects';
import type { Conversation } from '../../src/types/conversation';
import { makeTestProviderConfig } from '../fixtures/providers';

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
  it('records the recovered terminal turn exactly after final delivery succeeds', async () => {
    const provider = makeTestProviderConfig({ id: 'provider-1', model: 'configured-model' });
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue('Recovered answer');
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
      { memoryConversationId: conversation.id, sourceRunId: candidate.runId },
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
