import type { Message } from '../../../types/message';
import {
  type AgentRunMessageScope,
  getAgentRunMessageSlice,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { isAssistantFinalResponsePlaceholder } from '../../../utils/assistantMessageMetadata';

export function isReusableAgentRunAssistantMessage(message: Message): boolean {
  return message.role === 'assistant' && !message.subAgentEvent;
}

function isPreferredAgentRunFinalCandidate(message: Message): boolean {
  const metadata = message.assistantMetadata;
  return (
    metadata?.kind === 'final' &&
    (metadata.completionStatus === 'complete' ||
      (metadata.completionStatus === 'incomplete' &&
        metadata.finishReason === 'terminal_review_pending'))
  );
}

function shouldSkipAgentRunAssistantLookupMessage(message: Message): boolean {
  return message.role === 'tool' || (message.role === 'assistant' && !!message.subAgentEvent);
}

export function hasVisibleAssistantOutput(
  message: Pick<Message, 'content' | 'reasoning' | 'attachments' | 'effectId'>,
): boolean {
  return (
    message.content.trim().length > 0 ||
    !!message.reasoning?.trim().length ||
    (message.attachments?.length ?? 0) > 0 ||
    !!message.effectId
  );
}

export function findLatestAgentRunAssistantMessageId(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, scope);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (message.role === 'system') {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      if (!hasVisibleAssistantOutput(message)) {
        return undefined;
      }

      return message.id;
    }

    return undefined;
  }

  return undefined;
}

export function findLatestPreferredAgentRunAssistantMessageId(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, scope);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (message.role === 'system') {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      if (!hasVisibleAssistantOutput(message)) {
        return undefined;
      }

      if (isAssistantFinalResponsePlaceholder(message)) {
        return undefined;
      }

      if (!isPreferredAgentRunFinalCandidate(message)) {
        return undefined;
      }

      return message.id;
    }

    return undefined;
  }

  return undefined;
}

export function findAgentRunReplaceableAssistantMessageId(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, scope);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      return (message.toolCalls?.length ?? 0) === 0 ? message.id : undefined;
    }

    return undefined;
  }

  return undefined;
}

export function findLatestIncompleteAgentRunAssistantMessage(
  messages: Message[],
  scope: string | AgentRunMessageScope,
): Message | undefined {
  const runMessages = getAgentRunMessageSlice(messages, scope);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (message.role === 'system') {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      const visibleOutput = hasVisibleAssistantOutput(message);

      if (message.assistantMetadata?.completionStatus === 'incomplete' && visibleOutput) {
        return message;
      }

      if (!visibleOutput) {
        return undefined;
      }

      return undefined;
    }

    return undefined;
  }

  return undefined;
}
