import type { Conversation } from '../types/conversation';
import type { Message } from '../types/message';
import { repairReadFileContinuationSummary } from '../services/context/compactionSummary';

function isCodeOwnedCompactionSummary(message: Message): boolean {
  return (
    message.role === 'system' &&
    message.compactionProvenance?.version === 1 &&
    message.compactionProvenance.dependency === 'transcript_only'
  );
}

/** Prevent model-context repair/observation rows from becoming durable chat. */
export function selectDurableCompactionMessages(
  conversation: Pick<Conversation, 'messages'>,
  candidateMessages: Message[],
): Message[] {
  const durableMessageIds = new Set(conversation.messages.map((message) => message.id));
  return candidateMessages
    .filter((message) => durableMessageIds.has(message.id) || isCodeOwnedCompactionSummary(message))
    .map((message) =>
      isCodeOwnedCompactionSummary(message)
        ? {
            ...message,
            content: repairReadFileContinuationSummary(message.content, conversation.messages),
          }
        : message,
    );
}

/**
 * The transcript after a compaction. Compaction sees the model's messages, not the
 * transcript, so rows the transcript keeps for the person alone (sub-agent cards) are not
 * among them. The summary goes first, then every transcript message from the first one
 * compaction kept, in compaction's version where it has one; the messages before that are
 * the ones the summary replaced.
 */
export function selectCompactedTranscript(
  conversation: Pick<Conversation, 'messages'>,
  candidateMessages: Message[],
): Message[] {
  const durable = selectDurableCompactionMessages(conversation, candidateMessages);
  const transcriptIds = new Set(conversation.messages.map((message) => message.id));
  const keptById = new Map(
    durable
      .filter((message) => transcriptIds.has(message.id))
      .map((message) => [message.id, message] as const),
  );
  const summaries = durable.filter((message) => !transcriptIds.has(message.id));
  const tailStart = conversation.messages.findIndex((message) => keptById.has(message.id));
  if (tailStart < 0) return summaries;
  return [
    ...summaries,
    ...conversation.messages.slice(tailStart).map((message) => keptById.get(message.id) ?? message),
  ];
}
