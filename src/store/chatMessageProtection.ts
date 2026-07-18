import type { Conversation } from '../types/conversation';
import type { Message } from '../types/message';

type RequestProtectionConversation = Pick<
  Conversation,
  'agentRuns' | 'messages' | 'modelProjectionOwner'
>;

/** Request rows required to prove ownership of active model and agent executions. */
export function getProtectedRequestMessageIds(
  conversation: Pick<RequestProtectionConversation, 'agentRuns' | 'modelProjectionOwner'>,
): Set<string> {
  const protectedIds = new Set<string>();
  const projectionRequestId = conversation.modelProjectionOwner?.requestMessageId;
  if (projectionRequestId) protectedIds.add(projectionRequestId);

  for (const run of conversation.agentRuns ?? []) {
    if (
      run.status === 'running' &&
      run.userMessageId &&
      run.workflowTaskAnchor?.sourceMessageId === run.userMessageId
    ) {
      protectedIds.add(run.userMessageId);
    }
  }
  return protectedIds;
}

/**
 * Compaction may summarize old transcript rows, but an active run's exact user
 * request remains durable until the run is terminal so restart ownership can
 * still be proven. Missing protected requests are inserted after summaries.
 */
export function preserveProtectedRequestMessages(
  conversation: RequestProtectionConversation,
  candidateMessages: Message[],
): Message[] {
  const protectedIds = getProtectedRequestMessageIds(conversation);
  if (protectedIds.size === 0) return candidateMessages;

  const protectedMessages = conversation.messages.filter(
    (message) => message.role === 'user' && protectedIds.has(message.id),
  );
  if (protectedMessages.length === 0) return candidateMessages;

  const protectedById = new Map(protectedMessages.map((message) => [message.id, message]));
  let changed = false;
  const normalizedCandidates = candidateMessages.map((message) => {
    const protectedMessage = protectedById.get(message.id);
    if (!protectedMessage || protectedMessage === message) return message;
    changed = true;
    return protectedMessage;
  });
  const candidateIds = new Set(normalizedCandidates.map((message) => message.id));
  const missing = protectedMessages.filter((message) => !candidateIds.has(message.id));
  if (missing.length === 0) return changed ? normalizedCandidates : candidateMessages;

  const leadingSystemCount = normalizedCandidates.findIndex(
    (message) => message.role !== 'system',
  );
  const insertionIndex = leadingSystemCount < 0 ? normalizedCandidates.length : leadingSystemCount;
  return [
    ...normalizedCandidates.slice(0, insertionIndex),
    ...missing,
    ...normalizedCandidates.slice(insertionIndex),
  ];
}
