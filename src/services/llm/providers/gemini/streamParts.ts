import type { StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { readTrimmedString, stableToolCallKey } from '../../core/toolCallNormalization';
import { isDeclaredToolName } from '../../core/toolNameFilter';
import { createGeminiFallbackToolCallId } from './fallbackToolCallIds';

function readFunctionCallId(functionCall: Record<string, any>): string | undefined {
  return readTrimmedString(functionCall.id);
}

function readFunctionCall(part: Record<string, any>): Record<string, any> | undefined {
  return isPlainRecord(part.functionCall)
    ? part.functionCall
    : isPlainRecord(part.function_call)
      ? part.function_call
      : undefined;
}

function readPartText(part: Record<string, any>): string {
  return typeof part.text === 'string' ? part.text : '';
}

function isThoughtPart(part: Record<string, any>): boolean {
  return part.thought === true;
}

function findFirstUnsignedFunctionCallIndex(parts: ReadonlyArray<Record<string, any>>): number {
  return parts.findIndex((part) => readFunctionCall(part) && !extractGeminiThoughtSignature(part));
}

function isSignatureCarrierPart(part: Record<string, any>): boolean {
  const signature = extractGeminiThoughtSignature(part);
  if (!signature) {
    return false;
  }
  if (readFunctionCall(part)) {
    return false;
  }
  return isThoughtPart(part) || readPartText(part).length === 0;
}

function collectStepLevelOrphanSignature(
  parts: ReadonlyArray<Record<string, any>>,
): string | undefined {
  for (const part of parts) {
    if (!isSignatureCarrierPart(part)) {
      continue;
    }
    const signature = extractGeminiThoughtSignature(part);
    if (signature) {
      return signature;
    }
  }
  return undefined;
}

function associateSignatureCarriersToFirstFunctionCall(
  parts: ReadonlyArray<Record<string, any>>,
): Record<string, any>[] {
  if (parts.length === 0) {
    return [];
  }

  const associated = parts.map((part) => ({ ...part }));
  const firstUnsignedFunctionCallIndex = findFirstUnsignedFunctionCallIndex(associated);
  if (firstUnsignedFunctionCallIndex < 0) {
    return associated;
  }

  const stepSignature = collectStepLevelOrphanSignature(associated);
  if (!stepSignature) {
    return associated;
  }

  const firstFunctionCall = associated[firstUnsignedFunctionCallIndex];
  if (extractGeminiThoughtSignature(firstFunctionCall)) {
    return associated;
  }

  associated[firstUnsignedFunctionCallIndex] = {
    ...firstFunctionCall,
    thoughtSignature: stepSignature,
  };
  return associated;
}

export function finalizeGeminiStreamToolState(params: {
  declaredToolNames?: ReadonlySet<string>;
  parts: ReadonlyArray<Record<string, any>>;
  safeJsonParse: (value: unknown) => unknown;
}): {
  replayParts: Record<string, any>[];
  toolCalls: StreamedToolCall[];
} {
  const replayParts: Record<string, any>[] = [];
  const toolCalls: StreamedToolCall[] = [];
  const functionCallIndexByKey = new Map<string, number>();
  let pendingThoughtSignature: string | undefined;
  let functionCallOrdinal = 0;
  const normalizedParts = associateSignatureCarriersToFirstFunctionCall(
    params.parts.filter((entry): entry is Record<string, any> => isPlainRecord(entry)),
  );

  for (const part of normalizedParts) {
    const inlineThoughtSignature = extractGeminiThoughtSignature(part);
    const functionCall = readFunctionCall(part);

    if (!functionCall) {
      const text = typeof part.text === 'string' ? part.text : '';
      const isThoughtPart = part.thought === true;
      const isSignatureCarrier = Boolean(inlineThoughtSignature) && text.length === 0;

      if (isThoughtPart) {
        if (text.length > 0) {
          replayParts.push({
            text,
            thought: true,
            ...(inlineThoughtSignature ? { thoughtSignature: inlineThoughtSignature } : {}),
          });
        } else if (inlineThoughtSignature) {
          replayParts.push({ thought: true, thoughtSignature: inlineThoughtSignature });
        }
        if (inlineThoughtSignature) {
          pendingThoughtSignature = inlineThoughtSignature;
        }
        continue;
      }

      if (isSignatureCarrier) {
        replayParts.push({ text: '', thoughtSignature: inlineThoughtSignature });
        pendingThoughtSignature = inlineThoughtSignature;
        continue;
      }

      if (text.length > 0) {
        replayParts.push({
          text,
          ...(inlineThoughtSignature ? { thoughtSignature: inlineThoughtSignature } : {}),
        });
      }
      continue;
    }

    const name = typeof functionCall.name === 'string' ? functionCall.name : '';
    if (!isDeclaredToolName(name, params.declaredToolNames)) {
      pendingThoughtSignature = undefined;
      continue;
    }
    const parsedArgs = isPlainRecord(functionCall.args)
      ? functionCall.args
      : params.safeJsonParse(functionCall.args);
    const args = isPlainRecord(parsedArgs) ? parsedArgs : {};
    const functionCallId = readFunctionCallId(functionCall);
    const dedupeKey = stableToolCallKey({
      id: functionCallId,
      name,
      input: args,
    });
    const resolvedSignature =
      inlineThoughtSignature ?? (functionCallOrdinal === 0 ? pendingThoughtSignature : undefined);
    pendingThoughtSignature = undefined;

    const existingIndex = functionCallIndexByKey.get(dedupeKey);
    if (existingIndex !== undefined) {
      if (resolvedSignature && !extractGeminiThoughtSignature(replayParts[existingIndex])) {
        replayParts[existingIndex] = {
          ...replayParts[existingIndex],
          thoughtSignature: resolvedSignature,
        };
        const existingToolCall = toolCalls[existingIndex];
        if (existingToolCall) {
          const raw = {
            ...(isPlainRecord(existingToolCall.raw) ? existingToolCall.raw : {}),
            thoughtSignature: resolvedSignature,
            extra_content: { google: { thought_signature: resolvedSignature } },
          };
          toolCalls[existingIndex] = {
            ...existingToolCall,
            raw,
          };
        }
      }
      continue;
    }

    const argumentsText = JSON.stringify(args);
    const id =
      functionCallId ??
      createGeminiFallbackToolCallId({
        ordinal: toolCalls.length,
        name,
        args,
      });
    const snapshotPart: Record<string, any> = {
      functionCall: {
        id,
        name,
        args,
      },
    };
    if (resolvedSignature) {
      snapshotPart.thoughtSignature = resolvedSignature;
    }

    const raw: Record<string, any> = {
      id,
      type: 'function',
      function: {
        name,
        arguments: argumentsText,
      },
      ...(resolvedSignature
        ? {
            thoughtSignature: resolvedSignature,
            extra_content: { google: { thought_signature: resolvedSignature } },
          }
        : {}),
    };

    functionCallIndexByKey.set(dedupeKey, replayParts.length);
    replayParts.push(snapshotPart);
    toolCalls.push({
      id,
      name,
      arguments: argumentsText,
      raw,
    });
    functionCallOrdinal += 1;
  }

  return { replayParts, toolCalls };
}
