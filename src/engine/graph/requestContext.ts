import type { Message } from '../../types/message';
import { getUserMessagePromptContent } from '../prompts/orchestratorPromptSections';
import { sanitizeGraphOwnedModelContextMessages } from './modelContextSanitization';

type PrepareAgentControlGraphRequestContextParams = {
  memoryScopedMessages: ReadonlyArray<Message>;
  workflowScopeUserMessageId?: string;
};

export type AgentControlGraphRequestContext = {
  graphOwnedModelContextMessages: Message[];
  hasWorkflowScopeAnchor: boolean;
  lastUserMessageText: string;
  missingWorkflowScopeAnchorId?: string;
  requestContextLastUserMessage?: Message;
};

function selectUserMessages(messages: ReadonlyArray<Message>): Message[] {
  return messages.filter((message) => message.role === 'user');
}

export function prepareAgentControlGraphRequestContext(
  params: PrepareAgentControlGraphRequestContextParams,
): AgentControlGraphRequestContext {
  const normalizedWorkflowScopeUserMessageId = params.workflowScopeUserMessageId?.trim() || '';
  const memoryScopedUserMessages = selectUserMessages(params.memoryScopedMessages);
  const requestContextLastUserMessage =
    memoryScopedUserMessages[memoryScopedUserMessages.length - 1];
  const lastUserMessageText = requestContextLastUserMessage
    ? getUserMessagePromptContent(requestContextLastUserMessage)
    : '';
  const graphOwnedModelContextMessages = sanitizeGraphOwnedModelContextMessages(
    params.memoryScopedMessages,
  );
  const requestContextUserMessages = selectUserMessages(graphOwnedModelContextMessages);
  const hasWorkflowScopeAnchor = normalizedWorkflowScopeUserMessageId
    ? graphOwnedModelContextMessages.some(
        (message) => message.role === 'user' && message.id === normalizedWorkflowScopeUserMessageId,
      )
    : false;
  const effectiveRequestContextLastUserMessage =
    requestContextUserMessages[requestContextUserMessages.length - 1] ??
    requestContextLastUserMessage;
  return {
    graphOwnedModelContextMessages,
    hasWorkflowScopeAnchor,
    lastUserMessageText,
    ...(normalizedWorkflowScopeUserMessageId && !hasWorkflowScopeAnchor
      ? { missingWorkflowScopeAnchorId: normalizedWorkflowScopeUserMessageId }
      : {}),
    ...(effectiveRequestContextLastUserMessage
      ? { requestContextLastUserMessage: effectiveRequestContextLastUserMessage }
      : {}),
  };
}
