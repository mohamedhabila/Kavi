import { isPlainRecord } from '../core/json';
import type { ChatCompletionMessage } from './contracts';

/**
 * Provider APIs require historical function arguments to remain JSON objects.
 * Keep valid arguments byte-for-byte stable, but use an empty object when a
 * provider emitted malformed arguments that the tool runtime already rejected.
 * The persisted message and tool error remain untouched so the next model turn
 * can repair the call without making the entire conversation unreplayable.
 */
export function normalizeToolArgumentsForProviderReplay(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainRecord(parsed) ? value : '{}';
    } catch {
      return '{}';
    }
  }

  if (isPlainRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '{}';
    }
  }

  return '{}';
}

export function normalizeOpenAICompatibleToolCallMessages(
  messages: ChatCompletionMessage[],
): ChatCompletionMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      return message;
    }

    const toolCalls = message.tool_calls.map((toolCall: unknown) => {
      if (!isPlainRecord(toolCall) || !isPlainRecord(toolCall.function)) {
        return toolCall;
      }
      return {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: normalizeToolArgumentsForProviderReplay(toolCall.function.arguments),
        },
      };
    });

    return { ...message, tool_calls: toolCalls };
  });
}
