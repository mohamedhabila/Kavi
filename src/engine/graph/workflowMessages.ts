import type { Message } from '../../types/message';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { collectAgentControlGraphDelegatedCompletedToolNames } from './delegatedToolEvidence';

export function selectWorkflowScopedMessagesForRun(
  messages: ReadonlyArray<Message>,
  workflowScopeUserMessageId?: string,
): Message[] {
  const explicitScopeId = workflowScopeUserMessageId?.trim();

  if (!explicitScopeId) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        return messages.slice(index + 1);
      }
    }
    return [...messages];
  }

  const scopeStartIndex = messages.findIndex(
    (message) => message.role === 'user' && message.id === explicitScopeId,
  );
  if (scopeStartIndex < 0) {
    return [];
  }

  return messages.slice(scopeStartIndex + 1);
}

export function collectAgentControlGraphCompletedWorkflowToolNames(
  messages: ReadonlyArray<Message>,
): Set<string> {
  const completedToolNames = new Set<string>();
  for (const message of messages) {
    if (!message.isError) {
      for (const toolCall of message.toolCalls ?? []) {
        if (toolCall.status === 'completed' && toolCall.name?.trim()) {
          const toolName = normalizeToolName(toolCall.name);
          completedToolNames.add(toolName);
          for (const delegatedToolName of collectAgentControlGraphDelegatedCompletedToolNames({
            hostToolName: toolName,
            result: toolCall.result,
          })) {
            completedToolNames.add(delegatedToolName);
          }
        }
      }
    }

    if (message.role === 'tool' && !message.isError) {
      const toolName = message.toolCalls?.[0]?.name || message.toolCallId;
      if (toolName?.trim()) {
        const normalizedToolName = normalizeToolName(toolName);
        completedToolNames.add(normalizedToolName);
        for (const delegatedToolName of collectAgentControlGraphDelegatedCompletedToolNames({
          hostToolName: normalizedToolName,
          result: message.content,
          isError: message.isError,
        })) {
          completedToolNames.add(delegatedToolName);
        }
      }
    }
  }

  return completedToolNames;
}
