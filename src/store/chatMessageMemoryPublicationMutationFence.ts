import type { Message } from '../types/message';
import {
  areMemoryIngestionSnapshotRelevantFieldsEqual,
  getMemoryPublicationMutationLockedMessageIds,
} from './chatMessageMemoryPublicationGuards';

const SOURCE_LOCKED_ERROR = 'chat_message_memory_publication_source_locked';

/**
 * Caller-provided projections cannot create or replace publication receipts.
 * An existing receipt follows its exact message identity through safe rewrites.
 */
export function preserveCodeOwnedMessageMemoryPublications(
  currentMessages: readonly Message[],
  proposedMessages: Message[],
): Message[] {
  const currentById = new Map<string, Message | undefined>();
  for (const message of currentMessages) {
    currentById.set(message.id, currentById.has(message.id) ? undefined : message);
  }

  let changed = false;
  const reconciledMessages = proposedMessages.map((message) => {
    const current = currentById.get(message.id);
    const currentPublication = current?.memoryPublication;
    if (currentPublication === undefined && message.memoryPublication === undefined) {
      return message;
    }
    if (current === message) {
      return message;
    }

    const { memoryPublication: _untrustedMemoryPublication, ...trustedMessage } = message;
    changed = true;
    return currentPublication === undefined
      ? trustedMessage
      : { ...trustedMessage, memoryPublication: currentPublication };
  });
  return changed ? reconciledMessages : proposedMessages;
}

/** Fail closed when an open or enqueued immutable source window is changed or removed. */
export function assertMemoryPublicationLockedSourcesUnchanged(
  currentMessages: readonly Message[],
  proposedMessages: readonly Message[],
): void {
  const lockedIds = getMemoryPublicationMutationLockedMessageIds(currentMessages);
  if (lockedIds.size === 0) return;

  const proposedById = new Map<string, Message | undefined>();
  for (const message of proposedMessages) {
    proposedById.set(message.id, proposedById.has(message.id) ? undefined : message);
  }

  for (const current of currentMessages) {
    if (!lockedIds.has(current.id)) continue;
    const proposed = proposedById.get(current.id);
    if (!proposed || !areMemoryIngestionSnapshotRelevantFieldsEqual(current, proposed)) {
      throw new Error(SOURCE_LOCKED_ERROR);
    }
  }
}
