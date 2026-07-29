import type { Message } from '../../types/message';
import type { RequestContinuation, RequestFrame } from '../../services/agents/requestFrame';
import { filterModelVisibleAttachments } from '../../utils/messageAttachments';
import { getUserMessagePromptContent } from '../prompts/orchestratorPromptSections';
import { selectAgentControlGraphModelContextMessages } from './modelContext';
import { buildGraphEntryRequestFrame } from './requestEntrySignals';

type PrepareAgentControlGraphRequestContextParams = {
  graphOwnedRun: boolean;
  memoryScopedMessages: ReadonlyArray<Message>;
  continuation: RequestContinuation;
  workflowScopeUserMessageId?: string;
};

export type AgentControlGraphRequestContext = {
  graphOwnedModelContextMessages: Message[];
  hasWorkflowScopeAnchor: boolean;
  lastUserMessageText: string;
  missingWorkflowScopeAnchorId?: string;
  requestFrame: RequestFrame;
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
  const requestFrame = buildGraphEntryRequestFrame({
    text: lastUserMessageText,
    attachmentCount:
      filterModelVisibleAttachments(requestContextLastUserMessage?.attachments)?.length ?? 0,
    mode: params.graphOwnedRun ? 'agentic' : 'chitchat',
    continuation: params.continuation,
  });
  const workflowCandidateRequest = requestFrame.decision.action === 'act';
  const graphOwnedModelContextMessages =
    params.graphOwnedRun && workflowCandidateRequest
      ? selectAgentControlGraphModelContextMessages({
          memoryScopedMessages: [...params.memoryScopedMessages],
          graphOwnedRun: params.graphOwnedRun,
        })
      : [...params.memoryScopedMessages];
  const requestContextUserMessages = selectUserMessages(graphOwnedModelContextMessages);
  const hasWorkflowScopeAnchor =
    workflowCandidateRequest && normalizedWorkflowScopeUserMessageId
      ? graphOwnedModelContextMessages.some(
          (message) =>
            message.role === 'user' && message.id === normalizedWorkflowScopeUserMessageId,
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
      ? workflowCandidateRequest
        ? { missingWorkflowScopeAnchorId: normalizedWorkflowScopeUserMessageId }
        : {}
      : {}),
    requestFrame,
    ...(effectiveRequestContextLastUserMessage
      ? { requestContextLastUserMessage: effectiveRequestContextLastUserMessage }
      : {}),
  };
}
