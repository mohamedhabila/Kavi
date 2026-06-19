import type { StreamEvent, StreamedToolCall } from '../../support/contracts';
import {
  collectPendingToolCallEvents,
  mergeStreamToolCallChunk,
} from '../../core/streaming/toolCallAccumulator';
import {
  createCompletionMetadata,
  normalizeOpenAiCompatibleCompletion,
  normalizeStreamUsage,
} from '../../core/streaming/metadataBuilder';
import { iterateSseData } from '../../core/streaming/sseReader';
import { createGeminiCompatibleReplayState } from './geminiReplay';

export async function* streamOpenAICompatibleChat(args: {
  response: Response;
  signal?: AbortSignal;
  geminiTarget: boolean;
  shouldSurfaceReasoning: boolean;
  extractOpenAiCompatibleStreamText: (value: unknown) => { content: string; reasoning?: string };
  extractOpenAiCompatibleTextValue: (value: unknown) => string;
  trimGeminiCumulativeText: (fullContent: string, incoming: string) => string;
  safeJsonParse: (value: unknown) => unknown;
}): AsyncGenerator<StreamEvent> {
  let fullContent = '';
  const toolCalls: Record<number, StreamedToolCall> = {};
  const emittedToolCallSignatures = new Map<number, string>();
  let latestCompletion = undefined;
  const geminiReplay = createGeminiCompatibleReplayState(args);

  for await (const data of iterateSseData(args.response, args.signal)) {
    if (data === '[DONE]') {
      for (const event of collectPendingToolCallEvents(toolCalls, emittedToolCallSignatures)) {
        yield event;
      }
      const providerReplay = geminiReplay.buildProviderReplay(fullContent, toolCalls);
      yield {
        type: 'done',
        content: fullContent,
        ...(providerReplay ? { providerReplay } : {}),
        completion: latestCompletion || createCompletionMetadata('complete', 'done_marker'),
      };
      return;
    }

    try {
      const parsed = JSON.parse(data);
      const usage = normalizeStreamUsage(parsed.usage);
      if (usage) {
        yield { type: 'usage', usage };
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      const extractedContent = args.extractOpenAiCompatibleStreamText(delta?.content);
      const visibleDelta = args.geminiTarget
        ? args.trimGeminiCumulativeText(fullContent, extractedContent.content)
        : extractedContent.content;
      if (visibleDelta) {
        fullContent += visibleDelta;
        yield { type: 'token', content: visibleDelta };
      }
      if (args.shouldSurfaceReasoning && extractedContent.reasoning) {
        geminiReplay.captureThoughtReplayDelta(delta);
        yield { type: 'reasoning', content: extractedContent.reasoning };
      }

      const reasoningDelta = args.extractOpenAiCompatibleTextValue(delta?.reasoning_content);
      if (args.shouldSurfaceReasoning && reasoningDelta) {
        geminiReplay.captureThoughtReplayDelta(delta);
        yield { type: 'reasoning', content: reasoningDelta };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: '',
            };
          }
          toolCalls[idx] = mergeStreamToolCallChunk(toolCalls[idx], tc);

          if (args.geminiTarget) {
            toolCalls[idx] = geminiReplay.captureToolCallReplay(idx, tc, toolCalls[idx]);
          }
        }
      }
      if (choice.finish_reason === 'tool_calls') {
        for (const event of collectPendingToolCallEvents(toolCalls, emittedToolCallSignatures)) {
          yield event;
        }
      }
      latestCompletion =
        normalizeOpenAiCompatibleCompletion(choice.finish_reason) || latestCompletion;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) continue;
      throw parseError;
    }
  }

  for (const event of collectPendingToolCallEvents(toolCalls, emittedToolCallSignatures)) {
    yield event;
  }
  const finalProviderReplay = geminiReplay.buildProviderReplay(fullContent, toolCalls);
  if (fullContent || finalProviderReplay) {
    yield {
      type: 'done',
      content: fullContent,
      ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
      completion:
        latestCompletion ||
        createCompletionMetadata('incomplete', 'stream_ended_without_done_marker'),
    };
  }
}
