import { purgeArchivedHistoryOfDeletedConversations } from '../../../src/services/transcriptArchive/startupPurge';

// Archived history is a second copy of the person's conversations. The launch purge may
// only remove what belongs to conversations that are really gone.

function deps(
  overrides: Partial<Parameters<typeof purgeArchivedHistoryOfDeletedConversations>[0]>,
) {
  return {
    waitForHydration: jest.fn().mockResolvedValue(undefined),
    isHydrated: () => true,
    getConversationIds: () => ['c1', 'c2'],
    purge: jest.fn(() => 1),
    ...overrides,
  };
}

describe('purgeArchivedHistoryOfDeletedConversations', () => {
  it('keeps the history of every loaded conversation', async () => {
    const options = deps({});

    await expect(purgeArchivedHistoryOfDeletedConversations(options)).resolves.toBe(1);
    expect(options.purge).toHaveBeenCalledWith(new Set(['c1', 'c2']));
  });

  it('waits for conversations to load before deciding anything', async () => {
    const order: string[] = [];
    const options = deps({
      waitForHydration: jest.fn(async () => {
        order.push('hydrated');
      }),
      purge: jest.fn(() => {
        order.push('purged');
        return 0;
      }),
    });

    await purgeArchivedHistoryOfDeletedConversations(options);

    expect(order).toEqual(['hydrated', 'purged']);
  });

  it('purges nothing if conversations never loaded', async () => {
    const options = deps({ isHydrated: () => false });

    await purgeArchivedHistoryOfDeletedConversations(options);

    expect(options.purge).not.toHaveBeenCalled();
  });

  it('purges nothing from an empty store, which may be one that failed to load', async () => {
    const options = deps({ getConversationIds: () => [] });

    await purgeArchivedHistoryOfDeletedConversations(options);

    expect(options.purge).not.toHaveBeenCalled();
  });
});
