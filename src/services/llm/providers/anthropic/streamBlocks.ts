import type { ChatCompletionMessage, StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';

export type AnthropicStreamToolCall = StreamedToolCall & {
  receivedJsonDelta?: boolean;
};

export function stringifyInitialAnthropicToolInput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!isPlainRecord(value) || Object.keys(value).length === 0) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function buildAnthropicStreamAssistantBlocks(args: {
  contentBlocks: Map<number, Record<string, any>>;
  toolCalls: Record<number, AnthropicStreamToolCall>;
  safeJsonParse: (value: unknown) => unknown;
  normalizeAnthropicAssistantBlocks: (message: ChatCompletionMessage) => any[];
}): any[] {
  const orderedBlocks = Array.from(args.contentBlocks.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([index, block]) => {
      if (!isPlainRecord(block)) {
        return block;
      }

      if (block.type === 'tool_use') {
        const argumentsText = args.toolCalls[index]?.arguments || '';
        const parsedInput = args.safeJsonParse(argumentsText);
        return {
          type: 'tool_use',
          id: typeof block.id === 'string' ? block.id : '',
          name: typeof block.name === 'string' ? block.name : '',
          input: isPlainRecord(parsedInput) ? parsedInput : {},
        };
      }

      if (block.type === 'thinking') {
        return {
          type: 'thinking',
          thinking: typeof block.thinking === 'string' ? block.thinking : '',
          ...(typeof block.signature === 'string' && block.signature.length > 0
            ? { signature: block.signature }
            : {}),
        };
      }

      if (block.type === 'text') {
        return {
          type: 'text',
          text: typeof block.text === 'string' ? block.text : '',
        };
      }

      return { ...block };
    });

  return args.normalizeAnthropicAssistantBlocks({
    role: 'assistant',
    content: orderedBlocks,
  });
}

export function extractAnthropicStreamAssistantText(assistantBlocks: any[]): string {
  return assistantBlocks
    .filter(
      (block) => isPlainRecord(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text as string)
    .join('');
}

export function attachAnthropicStreamToolRaws(args: {
  toolCalls: Record<number, AnthropicStreamToolCall>;
  buildAnthropicToolRaw: (id: string, name: string, argumentsText: string) => Record<string, any>;
}): void {
  for (const [indexText, toolCall] of Object.entries(args.toolCalls)) {
    args.toolCalls[Number(indexText)].raw = args.buildAnthropicToolRaw(
      toolCall.id,
      toolCall.name,
      toolCall.arguments,
    );
  }
}
