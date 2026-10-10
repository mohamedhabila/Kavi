/**
 * Drop archived history whose conversation no longer exists — left behind when a deletion
 * landed while the archive was unavailable.
 *
 * Runs only once conversations are actually loaded: deciding before hydration would read
 * every conversation as deleted. An empty store is a fresh install (nothing to purge) or a
 * store that failed to load, where the archive may be the only copy of the person's
 * history left, so it purges nothing then either.
 */
export async function purgeArchivedHistoryOfDeletedConversations(deps: {
  waitForHydration: () => Promise<void>;
  isHydrated: () => boolean;
  getConversationIds: () => string[];
  purge: (liveConversationIds: ReadonlySet<string>) => number;
}): Promise<number> {
  await deps.waitForHydration();
  if (!deps.isHydrated()) return 0;
  const conversationIds = deps.getConversationIds();
  if (conversationIds.length === 0) return 0;
  return deps.purge(new Set(conversationIds));
}
