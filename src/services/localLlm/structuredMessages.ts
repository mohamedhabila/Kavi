import {
  flattenMessageContent,
  parseJsonLikeLocalValue,
} from './promptContent';
import type {
  LocalChatMessage,
  LocalStructuredMessage,
  LocalStructuredMessageGroup,
  LocalStructuredToolCall,
  LocalStructuredToolResponse,
} from './types';

export function extractLocalStructuredToolCalls(
  message: LocalChatMessage,
  toolNameById: Map<string, string>,
): LocalStructuredToolCall[] {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
        return null;
      }

      const rawFunction =
        toolCall.function &&
        typeof toolCall.function === 'object' &&
        !Array.isArray(toolCall.function)
          ? toolCall.function
          : undefined;
      const name = typeof rawFunction?.name === 'string' ? rawFunction.name.trim() : '';
      if (!name) {
        return null;
      }

      const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
      if (id) {
        toolNameById.set(id, name);
      }

      const parsedArguments =
        typeof rawFunction?.arguments === 'string'
          ? parseJsonLikeLocalValue(rawFunction.arguments)
          : rawFunction?.arguments;

      return {
        name,
        arguments:
          parsedArguments && typeof parsedArguments === 'object' && !Array.isArray(parsedArguments)
            ? (parsedArguments as Record<string, any>)
            : {},
      };
    })
    .filter((toolCall): toolCall is LocalStructuredToolCall => Boolean(toolCall));
}

export function buildStructuredLocalMessages(messages: LocalChatMessage[]): {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
} {
  const systemParts: string[] = [];
  const structuredMessages: LocalStructuredMessage[] = [];
  const toolNameById = new Map<string, string>();
  let pendingToolResponses: LocalStructuredToolResponse[] = [];

  const flushPendingToolResponses = () => {
    if (pendingToolResponses.length === 0) {
      return;
    }

    structuredMessages.push({
      role: 'tool',
      toolResponses: pendingToolResponses,
    });
    pendingToolResponses = [];
  };

  for (const message of messages) {
    if (message.role === 'system') {
      flushPendingToolResponses();
      const content = flattenMessageContent(message.content);
      if (content) {
        systemParts.push(content);
      }
      continue;
    }

    if (message.role === 'tool') {
      const content = flattenMessageContent(message.content);
      if (!content) {
        continue;
      }

      const toolCallId =
        typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
      const resolvedName =
        typeof message.name === 'string' && message.name.trim().length > 0
          ? message.name.trim()
          : (toolCallId ? toolNameById.get(toolCallId) : undefined) || toolCallId || 'tool_result';

      pendingToolResponses.push({
        name: resolvedName,
        response: parseJsonLikeLocalValue(content),
      });
      continue;
    }

    flushPendingToolResponses();

    if (message.role === 'assistant') {
      const content = flattenMessageContent(message.content);
      const toolCalls = extractLocalStructuredToolCalls(message, toolNameById);
      if (!content && toolCalls.length === 0) {
        continue;
      }

      structuredMessages.push({
        role: 'assistant',
        ...(content ? { content } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      continue;
    }

    const content = flattenMessageContent(message.content);
    if (!content) {
      continue;
    }

    structuredMessages.push({
      role: 'user',
      content,
    });
  }

  flushPendingToolResponses();

  return {
    ...(systemParts.length > 0 ? { systemPrompt: systemParts.join('\n\n') } : {}),
    messages: structuredMessages,
  };
}

export function groupStructuredLocalMessages(
  messages: LocalStructuredMessage[],
): LocalStructuredMessageGroup[] {
  const groups: LocalStructuredMessageGroup[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];

    if (current.role === 'assistant' && current.toolCalls?.length && next?.role === 'tool') {
      groups.push([current, next]);
      index += 1;
      continue;
    }

    groups.push([current]);
  }

  return groups;
}
