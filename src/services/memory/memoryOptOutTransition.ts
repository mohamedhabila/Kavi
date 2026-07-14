import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
} from '../../utils/messageMemoryPublication';
import { advanceConsolidationCursorPastExcludedPublications } from './consolidation/publicationExclusion';
import { retireActiveMemoryPublicationsBeforeOptOut } from './memoryOptOutRetirement';

function publicationKey(sourceThreadId: string, sourceEndMessageId: string): string {
  return JSON.stringify([sourceThreadId, sourceEndMessageId]);
}

/** Late binding prevents the settings and chat Zustand shells from importing each other. */
function getChatStore(): typeof import('../../store/useChatStore').useChatStore {
  const module = require('../../store/useChatStore') as typeof import('../../store/useChatStore');
  return module.useChatStore;
}

/** Fence unfinished durable work and settle every open receipt before policy becomes disabled. */
export function prepareLongTermMemoryOptOut(): void {
  const chatStore = getChatStore();
  const snapshot = chatStore.getState();
  if (new Set(snapshot.conversations.map(({ id }) => id)).size !== snapshot.conversations.length) {
    throw new Error('memory_opt_out_conversation_identity_invalid');
  }
  const candidates: Array<{
    conversationId: string;
    sourceEndMessageId: string;
    disposition: null | 'enqueued';
  }> = [];
  for (const conversation of snapshot.conversations) {
    const receiptIds = new Set<string>();
    for (const message of conversation.messages) {
      if (message.memoryPublication === undefined) continue;
      const publication = normalizeMessageMemoryPublication(message.memoryPublication);
      if (!publication || !isEligibleMessageMemoryPublicationSource(message)) {
        throw new Error('memory_opt_out_publication_receipt_invalid');
      }
      if (receiptIds.has(message.id)) {
        throw new Error('memory_opt_out_publication_identity_invalid');
      }
      receiptIds.add(message.id);
      if (publication.disposition === null || publication.disposition === 'enqueued') {
        candidates.push({
          conversationId: conversation.id,
          sourceEndMessageId: message.id,
          disposition: publication.disposition,
        });
      }
    }
  }
  const retirement = retireActiveMemoryPublicationsBeforeOptOut();
  const activePublicationKeys = new Set(
    retirement.publicationWithdrawals.map((withdrawal) =>
      publicationKey(withdrawal.sourceThreadId, withdrawal.sourceEndMessageId),
    ),
  );
  const transitions = candidates.flatMap((candidate) => {
    const activePublication = activePublicationKeys.has(
      publicationKey(candidate.conversationId, candidate.sourceEndMessageId),
    );
    if (candidate.disposition === 'enqueued' && !activePublication) return [];
    return [
      {
        conversationId: candidate.conversationId,
        sourceEndMessageId: candidate.sourceEndMessageId,
        disposition: activePublication ? ('withdrawn' as const) : ('opt_out' as const),
      },
    ];
  });
  for (const conversation of snapshot.conversations) {
    const sourceEndMessageIds = transitions
      .filter((transition) => transition.conversationId === conversation.id)
      .map((transition) => transition.sourceEndMessageId);
    if (sourceEndMessageIds.length === 0) continue;
    advanceConsolidationCursorPastExcludedPublications({
      threadId: conversation.id,
      messages: conversation.messages,
      sourceEndMessageIds,
    });
  }
  for (const transition of transitions) {
    const result = chatStore
      .getState()
      .transitionMessageMemoryPublication(
        transition.conversationId,
        transition.sourceEndMessageId,
        transition.disposition,
      );
    if (result.status !== 'applied') {
      throw new Error(`memory_opt_out_publication_commit_${result.reason}`);
    }
  }
}
