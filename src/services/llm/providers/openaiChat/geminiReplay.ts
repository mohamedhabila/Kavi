import type { StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { finalizeGeminiStreamToolState } from '../gemini/streamParts';

export function createGeminiCompatibleReplayState(args: {
  geminiTarget: boolean;
  extractOpenAiCompatibleTextValue: (value: unknown) => string;
  trimGeminiCumulativeText: (fullContent: string, incoming: string) => string;
  safeJsonParse: (value: unknown) => unknown;
}): {
  captureThoughtReplayDelta: (delta: unknown) => void;
  captureToolCallReplay: (
    index: number,
    chunk: Record<string, any>,
    merged: StreamedToolCall,
  ) => StreamedToolCall;
  buildProviderReplay: (
    fullContent: string,
    toolCalls: Record<number, StreamedToolCall>,
  ) => { geminiParts: Record<string, any>[] } | undefined;
} {
  const geminiReplayParts: Record<string, any>[] = [];
  let pendingGeminiThoughtSignature: string | undefined;
  let geminiThoughtReplayText = '';

  const extractGeminiChunkThoughtSignature = (value: unknown): string | undefined =>
    extractGeminiThoughtSignature(value);

  const stripGeminiThoughtSignatureFromRaw = (toolCall: StreamedToolCall): StreamedToolCall => {
    if (!isPlainRecord(toolCall.raw)) {
      return toolCall;
    }

    const raw = { ...toolCall.raw };
    if (!isPlainRecord(raw.extra_content)) {
      return toolCall;
    }

    const extraContent = { ...raw.extra_content };
    if (isPlainRecord(extraContent.google)) {
      const google = { ...extraContent.google };
      delete google.thought_signature;
      if (Object.keys(google).length > 0) {
        extraContent.google = google;
      } else {
        delete extraContent.google;
      }
    }

    if (Object.keys(extraContent).length > 0) {
      raw.extra_content = extraContent;
    } else {
      delete raw.extra_content;
    }

    return {
      ...toolCall,
      ...(Object.keys(raw).length > 0 ? { raw } : {}),
    };
  };

  const flushGeminiThoughtReplayPart = () => {
    if (!args.geminiTarget) {
      return;
    }
    if (!geminiThoughtReplayText && !pendingGeminiThoughtSignature) {
      return;
    }

    const thoughtPart: Record<string, any> = {};
    if (geminiThoughtReplayText) {
      thoughtPart.text = geminiThoughtReplayText;
      thoughtPart.thought = true;
    }
    if (pendingGeminiThoughtSignature) {
      thoughtPart.thoughtSignature = pendingGeminiThoughtSignature;
    }
    geminiReplayParts.unshift(thoughtPart);
    geminiThoughtReplayText = '';
    pendingGeminiThoughtSignature = undefined;
  };

  const backfillFirstGeminiToolCallSignature = (toolCalls: Record<number, StreamedToolCall>) => {
    if (!args.geminiTarget || !pendingGeminiThoughtSignature) {
      return;
    }

    const replayIndices = Object.keys(geminiReplayParts)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value))
      .sort((left, right) => left - right);
    const firstReplayIndex = replayIndices[0];
    if (firstReplayIndex !== undefined) {
      const firstReplayPart = geminiReplayParts[firstReplayIndex];
      if (
        isPlainRecord(firstReplayPart?.functionCall) &&
        !extractGeminiThoughtSignature(firstReplayPart)
      ) {
        geminiReplayParts[firstReplayIndex] = {
          ...firstReplayPart,
          thoughtSignature: pendingGeminiThoughtSignature,
        };
      }
    }

    const toolIndices = Object.keys(toolCalls)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value))
      .sort((left, right) => left - right);
    const firstToolIndex = toolIndices[0];
    if (firstToolIndex === undefined) {
      return;
    }

    const merged = toolCalls[firstToolIndex];
    if (!merged) {
      return;
    }

    const existingSignature =
      extractGeminiChunkThoughtSignature(merged.raw) ?? extractGeminiChunkThoughtSignature(merged);
    if (existingSignature) {
      return;
    }

    toolCalls[firstToolIndex] = {
      ...merged,
      raw: {
        ...(isPlainRecord(merged.raw) ? merged.raw : {}),
        thoughtSignature: pendingGeminiThoughtSignature,
        extra_content: { google: { thought_signature: pendingGeminiThoughtSignature } },
      },
    };
  };

  return {
    captureThoughtReplayDelta(delta: unknown) {
      if (!args.geminiTarget || !isPlainRecord(delta)) {
        return;
      }

      const signature = extractGeminiChunkThoughtSignature(delta);
      if (signature) {
        pendingGeminiThoughtSignature = signature;
      }

      const thoughtText = args.extractOpenAiCompatibleTextValue(delta.reasoning_content);
      if (thoughtText) {
        geminiThoughtReplayText = geminiThoughtReplayText
          ? args.trimGeminiCumulativeText(geminiThoughtReplayText, thoughtText)
          : thoughtText;
      }
    },

    captureToolCallReplay(index, chunk, merged) {
      if (!args.geminiTarget) {
        return merged;
      }

      const sig =
        extractGeminiChunkThoughtSignature(chunk) ||
        extractGeminiChunkThoughtSignature(merged.raw) ||
        (index === 0 ? pendingGeminiThoughtSignature : undefined);
      const parsedArgs = args.safeJsonParse(merged.arguments);
      const replayPart: Record<string, any> = {
        functionCall: {
          ...(merged.id ? { id: merged.id } : {}),
          name: merged.name,
          args: isPlainRecord(parsedArgs) ? parsedArgs : {},
        },
      };
      if (sig) {
        replayPart.thoughtSignature = sig;
      }
      geminiReplayParts[index] = replayPart;

      return stripGeminiThoughtSignatureFromRaw({
        ...merged,
        raw: {
          ...(isPlainRecord(merged.raw) ? merged.raw : {}),
          ...(sig
            ? {
                thoughtSignature: sig,
                extra_content: { google: { thought_signature: sig } },
              }
            : {}),
        },
      });
    },

    buildProviderReplay(fullContent, toolCalls) {
      backfillFirstGeminiToolCallSignature(toolCalls);
      flushGeminiThoughtReplayPart();
      if (!args.geminiTarget) {
        return undefined;
      }

      const replayInput = [...geminiReplayParts.filter(Boolean)];
      if (fullContent) {
        replayInput.unshift({ text: fullContent });
      }
      if (replayInput.length === 0) {
        return undefined;
      }

      const finalized = finalizeGeminiStreamToolState({
        parts: replayInput,
        safeJsonParse: args.safeJsonParse,
      });
      return finalized.replayParts.length > 0 ? { geminiParts: finalized.replayParts } : undefined;
    },
  };
}
