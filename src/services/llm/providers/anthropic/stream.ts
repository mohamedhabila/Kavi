import type { ChatCompletionMessage, StreamEvent, StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import {
  collectPendingToolCallEvents,
  getEmittableStreamedToolCall,
  mergeStreamedArgumentText,
} from '../../core/streaming/toolCallAccumulator';
import {
  createCompletionMetadata,
  normalizeAnthropicCompletion,
  normalizeStreamUsage,
} from '../../core/streaming/metadataBuilder';
import { iterateSseData } from '../../core/streaming/sseReader';
import {
  type AnthropicStreamToolCall,
  attachAnthropicStreamToolRaws,
  buildAnthropicStreamAssistantBlocks,
  extractAnthropicStreamAssistantText,
  stringifyInitialAnthropicToolInput,
} from './streamBlocks';

export async function* streamAnthropicMessages(args: {
  response: Response;
  signal?: AbortSignal;
  buildAnthropicToolRaw: (id: string, name: string, argumentsText: string) => Record<string, any>;
  normalizeAnthropicAssistantBlocks: (message: ChatCompletionMessage) => any[];
  safeJsonParse: (value: unknown) => unknown;
}): AsyncGenerator<StreamEvent> {
  let fullContent = '';
  const toolCalls: Record<number, AnthropicStreamToolCall> = {};
  const emittedToolCallSignatures = new Map<number, string>();
  const contentBlocks = new Map<number, Record<string, any>>();
  let toolIndex = 0;
  let latestCompletion = undefined;

  const finalizeAssistantBlocks = (): any[] => {
    return buildAnthropicStreamAssistantBlocks({
      contentBlocks,
      toolCalls,
      safeJsonParse: args.safeJsonParse,
      normalizeAnthropicAssistantBlocks: args.normalizeAnthropicAssistantBlocks,
    });
  };

  for await (const data of iterateSseData(args.response, args.signal)) {
    try {
      const parsed = JSON.parse(data);

      switch (parsed.type) {
        case 'content_block_start': {
          const block = parsed.content_block;
          if (block?.type === 'tool_use') {
            toolCalls[parsed.index] = {
              id: block.id,
              name: block.name,
              arguments: stringifyInitialAnthropicToolInput(block.input),
            };
            toolIndex = parsed.index;
          }
          if (isPlainRecord(block)) {
            if (block.type === 'thinking') {
              const initialThinking = typeof block.thinking === 'string' ? block.thinking : '';
              contentBlocks.set(parsed.index, {
                type: 'thinking',
                thinking: initialThinking,
                signature: typeof block.signature === 'string' ? block.signature : '',
              });
              if (initialThinking.length > 0) {
                yield { type: 'reasoning', content: initialThinking };
              }
            } else if (block.type === 'text') {
              const initialText = typeof block.text === 'string' ? block.text : '';
              contentBlocks.set(parsed.index, {
                type: 'text',
                text: initialText,
              });
              if (initialText.length > 0) {
                fullContent += initialText;
                yield { type: 'token', content: initialText };
              }
            } else if (block.type === 'tool_use') {
              contentBlocks.set(parsed.index, {
                type: 'tool_use',
                id: typeof block.id === 'string' ? block.id : '',
                name: typeof block.name === 'string' ? block.name : '',
              });
            } else {
              contentBlocks.set(parsed.index, { ...block });
            }
          }
          break;
        }
        case 'content_block_delta': {
          const delta = parsed.delta;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            fullContent += delta.text;
            const textBlock = contentBlocks.get(parsed.index);
            if (textBlock?.type === 'text') {
              textBlock.text = `${
                typeof textBlock.text === 'string' ? textBlock.text : ''
              }${delta.text}`;
            }
            yield { type: 'token', content: delta.text };
          } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            const thinkingBlock = contentBlocks.get(parsed.index);
            if (thinkingBlock?.type === 'thinking') {
              thinkingBlock.thinking = `${
                typeof thinkingBlock.thinking === 'string' ? thinkingBlock.thinking : ''
              }${delta.thinking}`;
            }
            yield { type: 'reasoning', content: delta.thinking };
          } else if (delta?.type === 'signature_delta' && delta.signature) {
            const thinkingBlock = contentBlocks.get(parsed.index);
            if (thinkingBlock?.type === 'thinking') {
              thinkingBlock.signature = delta.signature;
            }
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const idx = parsed.index ?? toolIndex;
            if (toolCalls[idx]) {
              if (!toolCalls[idx].receivedJsonDelta) {
                toolCalls[idx].arguments = '';
                toolCalls[idx].receivedJsonDelta = true;
              }
              toolCalls[idx].arguments = mergeStreamedArgumentText(
                toolCalls[idx].arguments,
                delta.partial_json,
              );
            }
          }
          break;
        }
        case 'content_block_stop': {
          const idx = parsed.index ?? toolIndex;
          const contentBlock = contentBlocks.get(idx);
          if (contentBlock?.type === 'tool_use' && toolCalls[idx]) {
            const parsedInput = args.safeJsonParse(toolCalls[idx].arguments);
            contentBlock.input = isPlainRecord(parsedInput) ? parsedInput : {};
            toolCalls[idx].raw = args.buildAnthropicToolRaw(
              toolCalls[idx].id,
              toolCalls[idx].name,
              toolCalls[idx].arguments,
            );
            const queuedToolCall = getEmittableStreamedToolCall(
              toolCalls as Record<number, StreamedToolCall>,
              emittedToolCallSignatures,
              idx,
            );
            if (queuedToolCall) {
              yield { type: 'tool_call', toolCall: queuedToolCall };
            }
          }
          break;
        }
        case 'message_delta': {
          latestCompletion =
            normalizeAnthropicCompletion(parsed.delta?.stop_reason) || latestCompletion;
          const usage = normalizeStreamUsage(parsed.usage);
          if (usage) {
            yield { type: 'usage', usage };
          }
          break;
        }
        case 'message_start': {
          const usage = normalizeStreamUsage(parsed.message?.usage);
          if (usage) {
            yield { type: 'usage', usage };
          }
          break;
        }
        case 'message_stop': {
          const assistantBlocks = finalizeAssistantBlocks();
          const finalContent = extractAnthropicStreamAssistantText(assistantBlocks) || fullContent;
          const finalProviderReplay =
            assistantBlocks.length > 0 ? { anthropicBlocks: assistantBlocks } : undefined;
          attachAnthropicStreamToolRaws({
            toolCalls,
            buildAnthropicToolRaw: args.buildAnthropicToolRaw,
          });
          for (const event of collectPendingToolCallEvents(
            toolCalls as Record<number, StreamedToolCall>,
            emittedToolCallSignatures,
          )) {
            yield event;
          }
          yield {
            type: 'done',
            content: finalContent,
            ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
            completion: latestCompletion || createCompletionMetadata('complete', 'message_stop'),
          };
          return;
        }
        case 'error': {
          const errorType = parsed.error?.type || '';
          const errorMsg = parsed.error?.message || 'Anthropic streaming error';
          throw new Error(`Anthropic ${errorType}: ${errorMsg}`);
        }
      }
    } catch (parseError) {
      if (parseError instanceof SyntaxError) continue;
      throw parseError;
    }
  }

  const assistantBlocks = finalizeAssistantBlocks();
  const finalContent = extractAnthropicStreamAssistantText(assistantBlocks) || fullContent;
  const finalProviderReplay =
    assistantBlocks.length > 0 ? { anthropicBlocks: assistantBlocks } : undefined;
  attachAnthropicStreamToolRaws({
    toolCalls,
    buildAnthropicToolRaw: args.buildAnthropicToolRaw,
  });
  for (const event of collectPendingToolCallEvents(
    toolCalls as Record<number, StreamedToolCall>,
    emittedToolCallSignatures,
  )) {
    yield event;
  }
  yield {
    type: 'done',
    content: finalContent,
    ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
    completion: createCompletionMetadata('incomplete', 'stream_ended_without_message_stop'),
  };
}
