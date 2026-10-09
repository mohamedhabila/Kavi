const mockStopConversationWork = jest.fn();
const mockHasConversationWork = jest.fn();
const mockWaitForModelProjectionAvailability = jest.fn();
const mockDeleteConversation = jest.fn();
let mockConversations: Array<{ id: string }> = [];

jest.mock('../../src/services/conversationWorkStop', () => ({
  stopConversationWork: (...args: unknown[]) => mockStopConversationWork(...args),
  hasConversationWork: (...args: unknown[]) => mockHasConversationWork(...args),
}));

jest.mock('../../src/store/modelProjectionOwnership', () => ({
  waitForModelProjectionAvailability: (...args: unknown[]) =>
    mockWaitForModelProjectionAvailability(...args),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => ({
      conversations: mockConversations,
      deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
    }),
  },
}));

import { deleteConversationStoppingWork } from '../../src/services/conversationDeletion';

describe('deleteConversationStoppingWork', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversations = [{ id: 'conversation-1' }];
    mockHasConversationWork.mockReturnValue(false);
    mockStopConversationWork.mockResolvedValue(undefined);
    mockWaitForModelProjectionAvailability.mockResolvedValue(undefined);
  });

  it('deletes an idle conversation without stopping anything', async () => {
    await deleteConversationStoppingWork('conversation-1');

    expect(mockStopConversationWork).not.toHaveBeenCalled();
    expect(mockWaitForModelProjectionAvailability).not.toHaveBeenCalled();
    expect(mockDeleteConversation).toHaveBeenCalledWith('conversation-1');
  });

  it('stops running work and waits for the reply to release before deleting', async () => {
    const order: string[] = [];
    mockHasConversationWork.mockReturnValue(true);
    mockStopConversationWork.mockImplementation(async () => order.push('stop'));
    mockWaitForModelProjectionAvailability.mockImplementation(async () => order.push('released'));
    mockDeleteConversation.mockImplementation(() => order.push('delete'));

    await deleteConversationStoppingWork('conversation-1');

    expect(order).toEqual(['stop', 'released', 'delete']);
    expect(mockStopConversationWork).toHaveBeenCalledWith({ id: 'conversation-1' });
    expect(mockWaitForModelProjectionAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-1', timeoutMs: 5_000 }),
    );
  });

  it('still deletes when the stopped reply does not release in time', async () => {
    mockHasConversationWork.mockReturnValue(true);
    mockWaitForModelProjectionAvailability.mockRejectedValue(
      new Error('model_projection_wait_timeout'),
    );

    await deleteConversationStoppingWork('conversation-1');

    expect(mockDeleteConversation).toHaveBeenCalledWith('conversation-1');
  });

  it('does nothing for a conversation that is already gone', async () => {
    await deleteConversationStoppingWork('missing');

    expect(mockStopConversationWork).not.toHaveBeenCalled();
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('surfaces a deletion the store refuses, so the caller can say it failed', async () => {
    mockDeleteConversation.mockImplementation(() => {
      throw new Error('conversation_delete_identity_invalid');
    });

    await expect(deleteConversationStoppingWork('conversation-1')).rejects.toThrow(
      'conversation_delete_identity_invalid',
    );
  });

  it('does not delete when stopping the work fails', async () => {
    mockHasConversationWork.mockReturnValue(true);
    mockStopConversationWork.mockRejectedValue(new Error('journal_unavailable'));

    await expect(deleteConversationStoppingWork('conversation-1')).rejects.toThrow(
      'journal_unavailable',
    );
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });
});
