import type { Message } from '../types/message';
import { normalizeMessageMemoryPublication } from '../utils/messageMemoryPublication';
import {
  areMemoryIngestionSnapshotRelevantFieldsEqual,
  getMemoryPublicationMutationLockedMessageIds,
} from './chatMessageMemoryPublicationGuards';

const SOURCE_LOCKED_ERROR = 'chat_message_memory_publication_source_locked';

interface PublicationSourceWindow {
  finalId: string;
  disposition: null | 'enqueued';
  messages: readonly Message[];
}

function getPublicationSourceWindows(
  messages: readonly Message[],
): readonly PublicationSourceWindow[] {
  if (getMemoryPublicationMutationLockedMessageIds(messages).size === 0) return [];

  const windows: PublicationSourceWindow[] = [];
  for (let finalIndex = 0; finalIndex < messages.length; finalIndex += 1) {
    const final = messages[finalIndex]!;
    const publication = normalizeMessageMemoryPublication(final.memoryPublication);
    if (
      !publication ||
      (publication.disposition !== null && publication.disposition !== 'enqueued')
    ) {
      continue;
    }

    let startIndex = 0;
    for (let index = finalIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        startIndex = index;
        break;
      }
    }
    windows.push({
      finalId: final.id,
      disposition: publication.disposition,
      messages: messages.slice(startIndex, finalIndex + 1),
    });
  }
  return windows;
}

function arePublicationSourceWindowsExact(
  current: PublicationSourceWindow,
  proposed: PublicationSourceWindow | undefined,
): boolean {
  if (
    !proposed ||
    current.disposition !== proposed.disposition ||
    current.messages.length !== proposed.messages.length
  ) {
    return false;
  }
  return current.messages.every((message, index) => {
    const proposedMessage = proposed.messages[index];
    return (
      proposedMessage?.id === message.id &&
      areMemoryIngestionSnapshotRelevantFieldsEqual(message, proposedMessage)
    );
  });
}

function failIfSourceWindowChanged(
  current: PublicationSourceWindow,
  proposed: PublicationSourceWindow | undefined,
): void {
  if (!arePublicationSourceWindowsExact(current, proposed)) {
    throw new Error(SOURCE_LOCKED_ERROR);
  }
}

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
  const currentWindows = getPublicationSourceWindows(currentMessages);
  if (currentWindows.length === 0) return;
  const proposedByFinalId = new Map(
    getPublicationSourceWindows(proposedMessages).map((window) => [window.finalId, window]),
  );

  for (const current of currentWindows) {
    failIfSourceWindowChanged(current, proposedByFinalId.get(current.finalId));
  }
}

/**
 * Compaction may remove a source after its immutable snapshot is enqueued. Open
 * sources, and any enqueued source whose final remains, must stay exact.
 */
export function assertConversationCompactionMemoryPublicationSourcesSafe(
  currentMessages: readonly Message[],
  proposedMessages: readonly Message[],
): void {
  const currentWindows = getPublicationSourceWindows(currentMessages);
  if (currentWindows.length === 0) return;
  const proposedByFinalId = new Map(
    getPublicationSourceWindows(proposedMessages).map((window) => [window.finalId, window]),
  );
  const proposedIds = new Set(proposedMessages.map((message) => message.id));

  for (const current of currentWindows) {
    if (current.disposition === 'enqueued' && !proposedIds.has(current.finalId)) {
      continue;
    }
    failIfSourceWindowChanged(current, proposedByFinalId.get(current.finalId));
  }
}
