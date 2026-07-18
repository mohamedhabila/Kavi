import type { Conversation, ConversationLogEntry } from '../types/conversation';
import {
  MAX_PERSISTED_AGENT_RUNS,
  MAX_PERSISTED_EXACT_REPLAY_MESSAGES,
  MAX_PERSISTED_LOG_DETAIL_CHARS,
  MAX_PERSISTED_LOG_ENTRIES,
  MAX_PERSISTED_LOG_TITLE_CHARS,
  MAX_PERSISTED_MESSAGES,
  MAX_PERSISTED_REASONING_MESSAGES,
  MAX_PERSISTED_SYSTEM_PROMPT_CHARS,
  MAX_PERSISTED_TAGS,
} from './chatPersistenceLimits';
import { sanitizeAgentRun } from './chatPersistenceAgentRuns';
import { selectMessagesForPersistenceWithOpenMemoryPublicationTurns } from './chatMessageMemoryPublicationGuards';
import { sanitizeMessage } from './chatPersistenceMessages';
import { truncateText } from './chatPersistencePrimitives';
import { sanitizeUsage } from './chatPersistenceUsage';
import { normalizeSemanticMemoryHandoff } from '../services/memory/semanticMemoryHandoff';
import { isEligibleMessageMemoryPublicationSource } from '../utils/messageMemoryPublication';
import { getProtectedExecutionMessageIds } from './chatExecutionMessageProtection';

function projectValidPublicationSources(conversation: Conversation): Conversation['messages'] {
  return (conversation.messages ?? []).map((message) => {
    if (!message.memoryPublication || isEligibleMessageMemoryPublicationSource(message)) {
      return message;
    }

    const { memoryPublication: _invalidPublication, ...messageWithoutInvalidPublication } = message;
    return messageWithoutInvalidPublication;
  });
}

function sanitizeLogEntry(entry: ConversationLogEntry): ConversationLogEntry {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    kind: entry.kind,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    ...(entry.detail ? { detail: truncateText(entry.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) } : {}),
  };
}

export function sanitizeConversationForPersistence(conversation: Conversation): Conversation {
  const messages = selectMessagesForPersistenceWithOpenMemoryPublicationTurns(
    projectValidPublicationSources(conversation),
    MAX_PERSISTED_MESSAGES,
    getProtectedExecutionMessageIds(conversation),
  );
  const replayStart = Math.max(0, messages.length - MAX_PERSISTED_EXACT_REPLAY_MESSAGES);
  const reasoningStart = Math.max(0, messages.length - MAX_PERSISTED_REASONING_MESSAGES);
  const {
    semanticMemoryHandoff: rawSemanticMemoryHandoff,
    ...conversationWithoutSemanticMemoryHandoff
  } = conversation;
  const semanticMemoryHandoff = normalizeSemanticMemoryHandoff(rawSemanticMemoryHandoff);

  return {
    ...conversationWithoutSemanticMemoryHandoff,
    title: truncateText(conversation.title, MAX_PERSISTED_LOG_TITLE_CHARS) || conversation.title,
    systemPrompt:
      truncateText(conversation.systemPrompt, MAX_PERSISTED_SYSTEM_PROMPT_CHARS) ||
      conversation.systemPrompt,
    tags: conversation.tags?.slice(0, MAX_PERSISTED_TAGS),
    messages: messages.map((message, index) =>
      sanitizeMessage(message, {
        preserveReplay: index >= replayStart,
        preserveReasoning: index >= reasoningStart,
      }),
    ),
    logs: (conversation.logs ?? [])
      .slice(-MAX_PERSISTED_LOG_ENTRIES)
      .map((entry) => sanitizeLogEntry(entry)),
    agentRuns: (conversation.agentRuns ?? [])
      .slice(-MAX_PERSISTED_AGENT_RUNS)
      .map((run) => sanitizeAgentRun(run)),
    ...(conversation.usage ? { usage: sanitizeUsage(conversation.usage) } : {}),
    ...(semanticMemoryHandoff ? { semanticMemoryHandoff } : {}),
  };
}

export function partializeChatPersistState<
  T extends {
    conversations: Conversation[];
    activeConversationId: string | null;
  },
>(state: T): Pick<T, 'conversations' | 'activeConversationId'> {
  return {
    conversations: state.conversations.map((conversation) =>
      sanitizeConversationForPersistence(conversation),
    ),
    activeConversationId: state.activeConversationId,
  };
}
