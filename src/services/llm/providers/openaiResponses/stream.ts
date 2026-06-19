import type { StreamEvent } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import {
  collectPendingToolCallEvents,
  getEmittableStreamedToolCall,
  mergeStreamedArgumentText,
} from '../../core/streaming/toolCallAccumulator';
import { createCompletionMetadata } from '../../core/streaming/metadataBuilder';
import { iterateSseData } from '../../core/streaming/sseReader';
import {
  buildOpenAIResponsesStreamProviderReplay,
  collectOpenAIResponsesReasoningEvents,
  createOpenAIResponsesStreamCompletionMetadata,
  createOpenAIResponsesStreamToolState,
  getOpenAIResponsesStreamOutput,
  type OpenAIResponsesStreamArgs,
  readOpenAIResponsesStreamResponseId,
} from './streamState';

export async function* streamOpenAIResponses(
  args: OpenAIResponsesStreamArgs,
): AsyncGenerator<StreamEvent> {
  let fullContent = '';
  let latestOpenAIResponseId = '';
  let latestOpenAIOutput: Record<string, any>[] = [];
  let latestCompletion = undefined;
  const emittedToolCallSignatures = new Map<number, string>();
  const streamedOutputItems = new Map<number, Record<string, any>>();
  const textDeltaKeys = new Set<string>();
  const refusalDeltaKeys = new Set<string>();
  const emittedReasoningKeys = new Set<string>();
  const streamToolState = createOpenAIResponsesStreamToolState(args);
  const { toolCalls } = streamToolState;

  for await (const data of iterateSseData(args.response, args.signal)) {
    if (data === '[DONE]') {
      continue;
    }

    try {
      const parsed = JSON.parse(data);

      switch (parsed.type) {
        case 'response.output_item.added': {
          const outputIndex = parsed.output_index ?? 0;
          if (isPlainRecord(parsed.item)) {
            streamedOutputItems.set(outputIndex, parsed.item);
          }
          if (parsed.item?.type === 'function_call') {
            streamToolState.updateToolCall(
              outputIndex,
              args.buildOpenAIResponseToolRaw(parsed.item, {
                outputIndex,
                reasoningItems: streamToolState.getLatestReasoningItems(),
              }),
            );
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const outputIndex = parsed.output_index ?? 0;
          const existing = streamToolState.ensureToolCall(outputIndex);
          streamToolState.updateToolCall(outputIndex, {
            id: existing.id,
            type: 'function',
            function: {
              name: existing.name,
              arguments: mergeStreamedArgumentText(
                existing.arguments,
                typeof parsed.delta === 'string' ? parsed.delta : '',
              ),
            },
            ...(isPlainRecord(existing.raw?._openai) ? { _openai: existing.raw?._openai } : {}),
          });
          break;
        }
        case 'response.function_call_arguments.done': {
          const outputIndex = parsed.output_index ?? 0;
          const existing = streamToolState.ensureToolCall(outputIndex);
          const previousOutputItem = streamedOutputItems.get(outputIndex);
          if (isPlainRecord(previousOutputItem) && previousOutputItem.type === 'function_call') {
            streamedOutputItems.set(outputIndex, {
              ...previousOutputItem,
              ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
              ...(typeof parsed.arguments === 'string' ? { arguments: parsed.arguments } : {}),
            });
          }
          streamToolState.updateToolCall(outputIndex, {
            id: existing.id,
            type: 'function',
            function: {
              name: typeof parsed.name === 'string' ? parsed.name : existing.name,
              arguments:
                typeof parsed.arguments === 'string' ? parsed.arguments : existing.arguments,
            },
            ...(isPlainRecord(existing.raw?._openai) ? { _openai: existing.raw?._openai } : {}),
          });
          const queuedToolCall = getEmittableStreamedToolCall(
            toolCalls,
            emittedToolCallSignatures,
            outputIndex,
          );
          if (queuedToolCall) {
            yield { type: 'tool_call', toolCall: queuedToolCall };
          }
          break;
        }
        case 'response.output_item.done': {
          const outputIndex = parsed.output_index ?? streamedOutputItems.size;
          if (isPlainRecord(parsed.item)) {
            streamedOutputItems.set(outputIndex, parsed.item);
          }
          if (parsed.item?.type === 'function_call') {
            streamToolState.updateToolCall(
              outputIndex,
              args.buildOpenAIResponseToolRaw(parsed.item, {
                outputIndex,
                reasoningItems: streamToolState.getLatestReasoningItems(),
              }),
            );
            const queuedToolCall = getEmittableStreamedToolCall(
              toolCalls,
              emittedToolCallSignatures,
              outputIndex,
            );
            if (queuedToolCall) {
              yield { type: 'tool_call', toolCall: queuedToolCall };
            }
          }
          break;
        }
        case 'response.output_text.delta': {
          const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
          textDeltaKeys.add(key);
          if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
            fullContent += parsed.delta;
            yield { type: 'token', content: parsed.delta };
          }
          break;
        }
        case 'response.output_text.done': {
          const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
          if (
            !textDeltaKeys.has(key) &&
            typeof parsed.text === 'string' &&
            parsed.text.length > 0
          ) {
            fullContent += parsed.text;
            yield { type: 'token', content: parsed.text };
          }
          break;
        }
        case 'response.refusal.delta': {
          const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
          refusalDeltaKeys.add(key);
          if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
            fullContent += parsed.delta;
            yield { type: 'token', content: parsed.delta };
          }
          break;
        }
        case 'response.refusal.done': {
          const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
          if (
            !refusalDeltaKeys.has(key) &&
            typeof parsed.refusal === 'string' &&
            parsed.refusal.length > 0
          ) {
            fullContent += parsed.refusal;
            yield { type: 'token', content: parsed.refusal };
          }
          break;
        }
        case 'response.reasoning_text.delta':
        case 'response.reasoning_summary_text.delta': {
          const key =
            parsed.type === 'response.reasoning_text.delta'
              ? `reasoning:${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`
              : `summary:${parsed.item_id ?? ''}:${parsed.summary_index ?? 0}`;
          if (
            args.shouldSurfaceReasoning &&
            typeof parsed.delta === 'string' &&
            parsed.delta.length > 0
          ) {
            emittedReasoningKeys.add(key);
            yield { type: 'reasoning', content: parsed.delta };
          }
          break;
        }
        case 'response.reasoning_text.done':
        case 'response.reasoning_summary_text.done': {
          const key =
            parsed.type === 'response.reasoning_text.done'
              ? `reasoning:${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`
              : `summary:${parsed.item_id ?? ''}:${parsed.summary_index ?? 0}`;
          if (
            !emittedReasoningKeys.has(key) &&
            args.shouldSurfaceReasoning &&
            typeof parsed.text === 'string' &&
            parsed.text.length > 0
          ) {
            emittedReasoningKeys.add(key);
            yield { type: 'reasoning', content: parsed.text };
          }
          break;
        }
        case 'response.completed':
        case 'response.incomplete': {
          latestCompletion = createOpenAIResponsesStreamCompletionMetadata(
            parsed.type,
            parsed.response,
          );
          latestOpenAIResponseId = readOpenAIResponsesStreamResponseId(
            parsed.response,
            latestOpenAIResponseId,
          );
          const output = getOpenAIResponsesStreamOutput(parsed.response);
          latestOpenAIOutput = output;
          output.forEach((item: Record<string, any>, outputIndex: number) => {
            streamedOutputItems.set(outputIndex, item);
          });
          const reasoningItems = output.filter(
            (item: Record<string, any>) => item.type === 'reasoning',
          );
          if (reasoningItems.length > 0) {
            streamToolState.applyReasoningItemsToToolCalls(reasoningItems);
            if (args.shouldSurfaceReasoning) {
              for (const event of collectOpenAIResponsesReasoningEvents({
                reasoningItems,
                emittedReasoningKeys,
                getOpenAIReasoningTextParts: args.getOpenAIReasoningTextParts,
              })) {
                yield event;
              }
            }
          }
          output.forEach((item: Record<string, any>, outputIndex: number) => {
            if (item.type !== 'function_call') {
              return;
            }
            streamToolState.updateToolCall(
              outputIndex,
              args.buildOpenAIResponseToolRaw(item, {
                outputIndex,
                reasoningItems:
                  reasoningItems.length > 0
                    ? reasoningItems
                    : streamToolState.getLatestReasoningItems(),
              }),
            );
          });

          const normalized = args.normalizeOpenAIResponsesResult(parsed.response);
          const normalizedContent = normalized?.choices?.[0]?.message?.content;
          if (
            typeof normalizedContent === 'string' &&
            normalizedContent.length > 0 &&
            (!fullContent ||
              (normalizedContent.length > fullContent.length &&
                normalizedContent.startsWith(fullContent)))
          ) {
            fullContent = normalizedContent;
          }
          streamToolState.captureUsage(parsed.response?.usage);
          break;
        }
        case 'response.failed': {
          const message = parsed.response?.error?.message || 'OpenAI response failed';
          throw new Error(message);
        }
        case 'error': {
          throw new Error(parsed.message || 'OpenAI streaming error');
        }
        default:
          break;
      }
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        continue;
      }
      throw parseError;
    }
  }

  const latestUsage = streamToolState.getLatestUsage();
  if (latestUsage) {
    yield { type: 'usage', usage: latestUsage };
  }
  for (const event of collectPendingToolCallEvents(toolCalls, emittedToolCallSignatures)) {
    yield event;
  }
  const replayOutput =
    latestOpenAIOutput.length > 0
      ? latestOpenAIOutput
      : Array.from(streamedOutputItems.entries())
          .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
          .map(([, item]) => item);
  const providerReplay = buildOpenAIResponsesStreamProviderReplay(
    latestOpenAIResponseId,
    replayOutput,
    args.replayInputContext ?? [],
  );
  yield {
    type: 'done',
    content: fullContent,
    ...(providerReplay ? { providerReplay } : {}),
    completion:
      latestCompletion ||
      createCompletionMetadata('incomplete', 'stream_ended_without_terminal_event'),
  };
}
