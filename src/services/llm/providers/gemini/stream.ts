import type { StreamEvent } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { mergeGeminiStreamCandidateParts } from '../../core/streaming/candidateMerger';
import {
  createCompletionMetadata,
  normalizeGeminiCompletion,
  normalizeStreamUsage,
} from '../../core/streaming/metadataBuilder';
import { iterateSseData } from '../../core/streaming/sseReader';
import { finalizeGeminiStreamToolState } from './streamParts';

export async function* streamGeminiNative(args: {
  declaredToolNames?: ReadonlySet<string>;
  response: Response;
  signal?: AbortSignal;
  shouldSurfaceReasoning: boolean;
  safeJsonParse: (value: unknown) => unknown;
}): AsyncGenerator<StreamEvent> {
  const partBuffers = new Map<string, string>();
  let fullContent = '';
  let latestCandidateParts: Record<string, any>[] = [];
  let latestCompletion = undefined;
  let latestUsage:
    | {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalTokens?: number;
      }
    | undefined;

  for await (const data of iterateSseData(args.response, args.signal)) {
    if (data === '[DONE]') {
      continue;
    }

    try {
      const parsed = JSON.parse(data);
      const blockReason =
        typeof parsed?.promptFeedback?.blockReason === 'string'
          ? parsed.promptFeedback.blockReason
          : '';
      if (blockReason && !Array.isArray(parsed?.candidates)) {
        throw new Error(`Gemini prompt blocked: ${blockReason}`);
      }

      const candidate = Array.isArray(parsed?.candidates)
        ? parsed.candidates.find((entry: unknown) => isPlainRecord(entry))
        : undefined;
      if (candidate) {
        latestCompletion = normalizeGeminiCompletion(candidate.finishReason) || latestCompletion;
        const parts = Array.isArray(candidate.content?.parts)
          ? candidate.content.parts.filter((part: unknown): part is Record<string, any> =>
              isPlainRecord(part),
            )
          : [];
        if (parts.length > 0) {
          latestCandidateParts = mergeGeminiStreamCandidateParts(latestCandidateParts, parts);
        }

        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          const functionCall = isPlainRecord(part.functionCall)
            ? part.functionCall
            : isPlainRecord(part.function_call)
              ? part.function_call
              : undefined;
          if (functionCall) {
            continue;
          }

          const text = typeof part.text === 'string' ? part.text : '';
          const thoughtSignature = extractGeminiThoughtSignature(part);
          const isThoughtPart = part.thought === true;
          if (thoughtSignature && (text.length === 0 || isThoughtPart)) {
            latestCandidateParts = mergeGeminiStreamCandidateParts(latestCandidateParts, [part]);
            if (text.length === 0) {
              continue;
            }
          }

          if (text.length === 0) {
            continue;
          }

          const bufferKey = `${partIndex}:${part.thought === true ? 'thought' : 'text'}`;
          const previousText = partBuffers.get(bufferKey) || '';
          const nextFullText = text.startsWith(previousText) ? text : `${previousText}${text}`;
          const delta = nextFullText.slice(previousText.length);
          partBuffers.set(bufferKey, nextFullText);

          if (!delta) {
            continue;
          }

          if (part.thought === true) {
            if (args.shouldSurfaceReasoning) {
              yield { type: 'reasoning', content: delta };
            }
            continue;
          }

          fullContent += delta;
          yield { type: 'token', content: delta };
        }
      }

      const usage = normalizeStreamUsage(parsed?.usageMetadata);
      if (usage) {
        latestUsage = usage;
      }
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        continue;
      }
      throw parseError;
    }
  }

  const finalized = finalizeGeminiStreamToolState({
    declaredToolNames: args.declaredToolNames,
    parts: latestCandidateParts,
    safeJsonParse: args.safeJsonParse,
  });

  if (latestUsage) {
    yield { type: 'usage', usage: latestUsage };
  }

  for (const toolCall of finalized.toolCalls) {
    yield { type: 'tool_call', toolCall };
  }

  yield {
    type: 'done',
    content: fullContent,
    ...(finalized.replayParts.length > 0
      ? { providerReplay: { geminiParts: finalized.replayParts } }
      : {}),
    completion:
      latestCompletion ||
      createCompletionMetadata('incomplete', 'stream_ended_without_finish_reason'),
  };
}
