const mockStopForegroundConversationRuns = jest.fn();
const mockRequestChatStorePersistenceCheckpoint = jest.fn();
const mockAbortForConversation = jest.fn(() => true);
const mockClearForConversation = jest.fn(() => true);

let mockStoreState: any;

jest.mock('../../src/engine/graph/foregroundRun/requestRegistry', () => ({
  appForegroundRequestRegistry: {
    abortForConversation: (...args: unknown[]) => mockAbortForConversation(...args),
    clearForConversation: (...args: unknown[]) => mockClearForConversation(...args),
  },
}));

jest.mock('../../src/engine/graph/foregroundConversationCancellation', () => ({
  stopForegroundConversationRuns: (...args: unknown[]) =>
    mockStopForegroundConversationRuns(...args),
}));

jest.mock('../../src/store/chatStorePersistence', () => ({
  requestChatStorePersistenceCheckpoint: (...args: unknown[]) =>
    mockRequestChatStorePersistenceCheckpoint(...args),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => mockStoreState },
}));

import { terminalizeAndroidLongHorizonConversation } from '../../src/services/androidLongHorizonRunCancellation';

describe('Android notification run cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const conversation = {
      id: 'conversation-1',
      agentRuns: [{ id: 'run-1', status: 'running' }],
    };
    mockStoreState = {
      conversations: [conversation],
      addConversationLog: jest.fn(),
      completeAgentRun: jest.fn((_conversationId, _effect, runId) => {
        const run = conversation.agentRuns.find((candidate) => candidate.id === runId);
        if (run) run.status = 'cancelled';
      }),
      updateAgentRunControlGraph: jest.fn(),
    };
    mockStopForegroundConversationRuns.mockImplementation(async (params) => {
      params.actions.clearForegroundRequestForConversation(params.conversationId);
      params.actions.completeAgentRun(params.conversationId, { status: 'cancelled' }, 'run-1');
    });
  });

  it('terminalizes and checkpoints every persisted running run', async () => {
    await expect(terminalizeAndroidLongHorizonConversation('conversation-1')).resolves.toBe(true);

    expect(mockStopForegroundConversationRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        conversation: expect.objectContaining({ id: 'conversation-1' }),
      }),
    );
    expect(mockClearForConversation).toHaveBeenCalledWith('conversation-1');
    expect(mockRequestChatStorePersistenceCheckpoint).toHaveBeenCalledWith(0);
  });

  it('does not invent a run when the conversation has no running work', async () => {
    mockStoreState.conversations[0].agentRuns[0].status = 'completed';

    await expect(terminalizeAndroidLongHorizonConversation('conversation-1')).resolves.toBe(false);

    expect(mockClearForConversation).toHaveBeenCalledWith('conversation-1');
    expect(mockStopForegroundConversationRuns).not.toHaveBeenCalled();
  });
});
