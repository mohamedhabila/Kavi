import {
  getMemoryLastUpdatedAt,
  notifyStructuredMemoryChanged,
  subscribeToMemoryChanges,
} from '../../../src/services/memory/changeNotifications';

describe('memory change notifications', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes structured changes and records their timestamp', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_234);
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);

    notifyStructuredMemoryChanged('conversation-1');

    expect(listener).toHaveBeenCalledWith({
      scope: 'structured',
      updatedAt: 1_234,
      conversationId: 'conversation-1',
    });
    expect(getMemoryLastUpdatedAt()).toBe(1_234);

    unsubscribe();
    notifyStructuredMemoryChanged('conversation-2');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
