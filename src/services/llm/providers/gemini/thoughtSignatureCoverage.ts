import { isGemini3Model } from '../../catalog/providerCapabilities';
import type { MessageProviderReplay } from '../../../../types/message';
import {
  extractGeminiThoughtSignature,
  extractGeminiToolCallThoughtSignature,
} from '../../core/reasoningExtraction';
import { borrowThoughtSignatureFromReplayParts, normalizeGeminiContentParts } from './contentParts';

type PendingToolCallLike = {
  raw?: Record<string, unknown>;
};

function replayFunctionCallParts(
  providerReplay: MessageProviderReplay | undefined,
): ReadonlyArray<Record<string, unknown>> {
  return normalizeGeminiContentParts(providerReplay?.geminiParts ?? []).filter(
    (part) => part.functionCall,
  );
}

function resolveReplayStepOrphanSignature(
  replayParts: ReadonlyArray<Record<string, unknown>>,
): string | undefined {
  for (const part of normalizeGeminiContentParts(replayParts)) {
    if (part.functionCall) {
      continue;
    }
    const signature = extractGeminiThoughtSignature(part);
    if (!signature) {
      continue;
    }
    const text = typeof part.text === 'string' ? part.text : '';
    if (part.thought === true || text.length === 0) {
      return signature;
    }
  }
  return undefined;
}

function resolveFirstStepFunctionCallThoughtSignature(params: {
  functionCallPart: Record<string, unknown> | undefined;
  pendingToolCall: PendingToolCallLike | undefined;
  replayParts: ReadonlyArray<Record<string, unknown>>;
}): string | undefined {
  const direct =
    extractGeminiThoughtSignature(params.functionCallPart) ??
    extractGeminiToolCallThoughtSignature(params.pendingToolCall?.raw) ??
    borrowThoughtSignatureFromReplayParts(params.replayParts, 0);
  if (direct) {
    return direct;
  }

  return resolveReplayStepOrphanSignature(params.replayParts);
}

export function hasGeminiToolTurnThoughtSignatureCoverage(params: {
  model: string;
  pendingToolCalls: ReadonlyArray<PendingToolCallLike>;
  providerReplay?: MessageProviderReplay;
}): boolean {
  if (!isGemini3Model(params.model) || params.pendingToolCalls.length === 0) {
    return true;
  }

  const replayParts = Array.isArray(params.providerReplay?.geminiParts)
    ? params.providerReplay.geminiParts.filter(
        (part): part is Record<string, unknown> =>
          Boolean(part) && typeof part === 'object' && !Array.isArray(part),
      )
    : [];
  const functionCallParts = replayFunctionCallParts(params.providerReplay);

  const signature = resolveFirstStepFunctionCallThoughtSignature({
    functionCallPart: functionCallParts[0],
    pendingToolCall: params.pendingToolCalls[0],
    replayParts,
  });

  return Boolean(signature?.trim());
}
