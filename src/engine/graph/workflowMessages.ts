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

export function selectWorkflowScopedUserMessagesForRun(
  messages: ReadonlyArray<Message>,
  workflowScopeUserMessageId?: string,
): Message[] {
  const explicitScopeId = workflowScopeUserMessageId?.trim();
  if (!explicitScopeId) {
    const fallbackLastUser = [...messages].reverse().find((message) => message.role === 'user');
    return fallbackLastUser ? [fallbackLastUser] : [];
  }

  const scopeStartIndex = messages.findIndex(
    (message) => message.role === 'user' && message.id === explicitScopeId,
  );
  if (scopeStartIndex < 0) {
    return [];
  }

  const scopedUserMessages = messages
    .slice(scopeStartIndex)
    .filter((message) => message.role === 'user');

  return scopedUserMessages;
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

export interface ScopedToolResult {
  toolName: string;
  result: string;
  status: 'completed' | 'failed';
  timestamp: number;
  argumentsText?: string;
}

export function collectScopedToolResults(messages: ReadonlyArray<Message>): ScopedToolResult[] {
  const toolCallsById = new Map<string, { name: string; arguments?: string; status?: string }>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const toolCallId = toolCall.id?.trim();
      if (!toolCallId) {
        continue;
      }
      toolCallsById.set(toolCallId, {
        name: normalizeToolName(toolCall.name),
        arguments: toolCall.arguments,
        status: toolCall.status,
      });
    }
  }

  const results: ScopedToolResult[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') {
      continue;
    }

    const toolCallId = message.toolCallId?.trim();
    const linkedToolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
    const embeddedToolCall = message.toolCalls?.[0];
    const toolName = normalizeToolName(linkedToolCall?.name || embeddedToolCall?.name || '');
    if (!toolName) {
      continue;
    }

    const status =
      message.isError ||
      linkedToolCall?.status === 'failed' ||
      embeddedToolCall?.status === 'failed'
        ? 'failed'
        : 'completed';
    const argumentsText = linkedToolCall?.arguments ?? embeddedToolCall?.arguments;

    results.push({
      toolName,
      result: message.content,
      status,
      timestamp: message.timestamp,
      ...(argumentsText ? { argumentsText } : {}),
    });
  }

  return results;
}
