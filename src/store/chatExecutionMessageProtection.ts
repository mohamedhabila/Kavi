import type { Conversation } from '../types/conversation';
import type { Message } from '../types/message';

type ExecutionProtectionConversation = Pick<
  Conversation,
  'agentRuns' | 'messages' | 'modelProjectionOwner'
>;

/** Transcript rows required to prove and mutate active model/agent executions. */
export function getProtectedExecutionMessageIds(
  conversation: Pick<ExecutionProtectionConversation, 'agentRuns' | 'modelProjectionOwner'>,
): Set<string> {
  const protectedIds = new Set<string>();
  const projectionOwner = conversation.modelProjectionOwner;
  if (projectionOwner) {
    protectedIds.add(projectionOwner.requestMessageId);
    protectedIds.add(projectionOwner.assistantMessageId);
  }

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
 * Compaction may summarize old transcript rows, but exact active execution
 * anchors remain durable. Request rows follow summaries; the current assistant
 * projection remains the transcript tail so streamed/tool mutations still bind.
 */
export function preserveProtectedExecutionMessages(
  conversation: ExecutionProtectionConversation,
  candidateMessages: Message[],
): Message[] {
  const protectedIds = getProtectedExecutionMessageIds(conversation);
  if (protectedIds.size === 0) return candidateMessages;

  const projectionOwner = conversation.modelProjectionOwner;
  const protectedMessages = conversation.messages.filter((message) => {
    if (!protectedIds.has(message.id)) return false;
    if (message.id === projectionOwner?.assistantMessageId) return message.role === 'assistant';
    return message.role === 'user';
  });
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
  const missingRequests = protectedMessages.filter(
    (message) => message.role === 'user' && !candidateIds.has(message.id),
  );
  const missingAssistant = protectedMessages.find(
    (message) => message.role === 'assistant' && !candidateIds.has(message.id),
  );
  if (missingRequests.length === 0 && !missingAssistant) {
    return changed ? normalizedCandidates : candidateMessages;
  }

  const leadingSystemCount = normalizedCandidates.findIndex(
    (message) => message.role !== 'system',
  );
  const requestInsertionIndex =
    leadingSystemCount < 0 ? normalizedCandidates.length : leadingSystemCount;
  const withRequests = [
    ...normalizedCandidates.slice(0, requestInsertionIndex),
    ...missingRequests,
    ...normalizedCandidates.slice(requestInsertionIndex),
  ];
  return missingAssistant ? [...withRequests, missingAssistant] : withRequests;
}
