import {
  buildAgentRunMessageScope,
  getAgentRunMessageSlice,
} from '../../services/agents/lifecycle/agentRunStateMachine';
import type { AgentRun } from '../../types/agentRun';
import type { Message } from '../../types/message';
import {
  hasCompleteFinalAssistantMetadata,
  isPendingReviewAssistantMessage,
} from '../../utils/assistantMessageMetadata';

export function isRenderableDisplayMessage(message: Message): boolean {
  return message.role !== 'system' && !isPendingReviewAssistantMessage(message);
}

export function isVisibleAssistantMessageForAgentRun(message: Message, run?: AgentRun): boolean {
  if (!isRenderableDisplayMessage(message)) {
    return false;
  }

  if (message.role !== 'assistant' || !run || run.status !== 'running') {
    return true;
  }

  return !hasCompleteFinalAssistantMetadata(message);
}

export function filterVisibleAssistantMessagesForAgentRun(
  messages: Message[],
  run?: AgentRun,
): Message[] {
  return messages.filter((message) => isVisibleAssistantMessageForAgentRun(message, run));
}

export function findAgentRunDisplayAnchorMessageId(
  messages: Message[],
  run: AgentRun,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, buildAgentRunMessageScope(run));
  if (!runMessages.length) {
    return undefined;
  }

  const assistantMessages = filterVisibleAssistantMessagesForAgentRun(
    runMessages.filter((message) => message.role === 'assistant'),
    run,
  );
  if (!assistantMessages.length) {
    return undefined;
  }

  const preferredMessage =
    [...assistantMessages].reverse().find((message) => !message.subAgentEvent) ??
    assistantMessages[assistantMessages.length - 1];

  return preferredMessage?.id;
}
