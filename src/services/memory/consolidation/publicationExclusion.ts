import type { Message } from '../../../types/message';
import {
  isEligibleMessageMemoryPublicationSource,
  normalizeMessageMemoryPublication,
} from '../../../utils/messageMemoryPublication';
import { getConsolidationState, upsertState } from './schedulerState';

function fail(code: string): never {
  throw new Error(code);
}

function excludedByReceipt(message: Message): boolean {
  const publication = normalizeMessageMemoryPublication(message.memoryPublication);
  return publication?.disposition === 'opt_out' || publication?.disposition === 'withdrawn';
}

function findUniqueMessageIndex(messages: ReadonlyArray<Message>, messageId: string): number {
  const matches = messages.flatMap((message, index) => (message.id === messageId ? [index] : []));
  if (matches.length !== 1) return fail('memory_publication_exclusion_source_invalid');
  return matches[0]!;
}

export function latestExcludedMemoryPublicationIndex(
  messages: ReadonlyArray<Message>,
  lastConsolidatedMessageId: string | null | undefined,
): number {
  const cursorIndex = lastConsolidatedMessageId
    ? messages.findIndex((message) => message.id === lastConsolidatedMessageId)
    : -1;
  let excludedIndex = cursorIndex;
  for (let index = cursorIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (isEligibleMessageMemoryPublicationSource(message) && excludedByReceipt(message)) {
      excludedIndex = index;
    }
  }
  return excludedIndex;
}

/** Persist a monotonic cursor past exact turns that policy permanently excludes from memory. */
export function advanceConsolidationCursorPastExcludedPublications(input: {
  threadId: string;
  messages: ReadonlyArray<Message>;
  sourceEndMessageIds?: ReadonlyArray<string>;
  now?: number;
}): string | null {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    return fail('memory_publication_exclusion_timestamp_invalid');
  }
  const state = getConsolidationState(input.threadId);
  let targetIndex = latestExcludedMemoryPublicationIndex(
    input.messages,
    state?.lastConsolidatedMessageId,
  );
  for (const sourceEndMessageId of input.sourceEndMessageIds ?? []) {
    const index = findUniqueMessageIndex(input.messages, sourceEndMessageId);
    const source = input.messages[index];
    if (!source || !isEligibleMessageMemoryPublicationSource(source)) {
      return fail('memory_publication_exclusion_source_invalid');
    }
    targetIndex = Math.max(targetIndex, index);
  }
  const target = input.messages[targetIndex];
  if (!target || target.id === state?.lastConsolidatedMessageId) {
    return state?.lastConsolidatedMessageId ?? null;
  }
  upsertState({
    threadId: input.threadId,
    lastConsolidatedMessageId: target.id,
    lastConsolidatedAt:
      typeof target.timestamp === 'number'
        ? Math.max(target.timestamp, state?.lastConsolidatedAt ?? 0)
        : Math.max(now, state?.lastConsolidatedAt ?? 0),
    turnsSinceLast: 0,
    now,
  });
  return target.id;
}
