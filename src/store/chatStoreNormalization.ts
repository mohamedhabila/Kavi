import type { AgentRun } from '../types/agentRun';
import type { Conversation } from '../types/conversation';
import type { Message } from '../types/message';
import { normalizePersistedAgentRun } from './agentRuns/shared';
import { sanitizeConversationForPersistence } from './chatPersistence';
import { capMessages } from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';
import { isValidModelProjectionOwner } from '../utils/modelProjectionOwner';
import { getProtectedExecutionMessageIds } from './chatExecutionMessageProtection';
import { hydrateSubAgentTerminationCause } from '../utils/subAgentTermination';

function normalizePersistedMessages(messages: Message[] | undefined): Message[] {
  return (messages ?? []).map((message) =>
    message.subAgentEvent
      ? {
          ...message,
          subAgentEvent: {
            ...message.subAgentEvent,
            snapshot: hydrateSubAgentTerminationCause(message.subAgentEvent.snapshot),
          },
        }
      : message,
  );
}

function normalizePersistedConversation(conversation: Conversation): Conversation {
  const normalizedRuns = (conversation.agentRuns ?? []).map((run) =>
    normalizePersistedAgentRun(run as AgentRun),
  );
  const activeAgentRunId = normalizedRuns.some(
    (run) => run.id === conversation.activeAgentRunId && run.status === 'running',
  )
    ? conversation.activeAgentRunId
    : undefined;

  const modelProjectionOwner = isValidModelProjectionOwner(conversation.modelProjectionOwner)
    ? conversation.modelProjectionOwner
    : undefined;

  const normalizedConversation = {
    ...conversation,
    messages: normalizePersistedMessages(conversation.messages),
    logs: conversation.logs ?? [],
    agentRuns: normalizedRuns,
    activeAgentRunId,
    modelProjectionOwner,
  };
  return sanitizeConversationForPersistence({
    ...normalizedConversation,
    messages: capMessages(
      normalizedConversation.messages,
      getProtectedExecutionMessageIds(normalizedConversation),
    ),
  });
}

export function normalizePersistedChatState(
  state: Partial<ChatState> | undefined,
): Pick<ChatState, 'conversations' | 'activeConversationId'> {
  const conversations = (state?.conversations ?? []).map((conversation) =>
    normalizePersistedConversation(conversation as Conversation),
  );
  const activeConversationId =
    typeof state?.activeConversationId === 'string' &&
    conversations.some((conversation) => conversation.id === state.activeConversationId)
      ? state.activeConversationId
      : null;
  return { conversations, activeConversationId };
}
