import type { ChatCompletionMessage } from '../../support/contracts';
import { isPlainRecord, safeJsonParse } from '../../core/json';
import {
  extractGeminiThoughtSignature,
  extractGeminiToolCallThoughtSignature,
} from '../../core/reasoningExtraction';
import {
  dedupeByStableKey,
  readTrimmedString,
  stableToolCallKey,
} from '../../core/toolCallNormalization';
import {
  borrowThoughtSignatureFromReplayParts,
  normalizeGeminiContentParts,
  normalizeGeminiToolName,
  parseGeminiJsonLikeText,
  readGeminiFunctionCallId,
} from './contentParts';

export function dedupeGeminiReplayFunctionCallParts(
  parts: ReadonlyArray<Record<string, any>>,
): Record<string, any>[] {
  return dedupeByStableKey(
    parts,
    (part) => {
      if (!isPlainRecord(part.functionCall)) {
        return undefined;
      }

      return stableToolCallKey({
        id: readGeminiFunctionCallId(part.functionCall),
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    },
    (existing, incoming) =>
      Boolean(extractGeminiThoughtSignature(incoming)) && !extractGeminiThoughtSignature(existing),
  );
}

export function enrichGeminiReplayParts(
  replayParts: ReadonlyArray<Record<string, any>>,
  toolCalls: ReadonlyArray<unknown>,
): Record<string, any>[] {
  const replayFunctionCallCount = replayParts.filter(
    (part) => isPlainRecord(part.functionCall) || isPlainRecord(part.function_call),
  ).length;
  const normalized =
    toolCalls.length > 0 && replayFunctionCallCount > toolCalls.length
      ? dedupeGeminiReplayFunctionCallParts(normalizeGeminiContentParts(replayParts))
      : normalizeGeminiContentParts(replayParts);
  if (normalized.length === 0) {
    return [];
  }

  let functionCallIndex = 0;
  return normalized.map((part) => {
    if (!isPlainRecord(part.functionCall)) {
      return part;
    }

    const isFirstFunctionCall = functionCallIndex === 0;
    const borrowedSignature = borrowThoughtSignatureFromReplayParts(replayParts, functionCallIndex);
    const enriched = enrichGeminiFunctionCallPart(part, toolCalls[functionCallIndex]);
    functionCallIndex += 1;

    if (extractGeminiThoughtSignature(enriched)) {
      return enriched;
    }

    if (borrowedSignature && isFirstFunctionCall) {
      return {
        ...enriched,
        thoughtSignature: borrowedSignature,
      };
    }

    return enriched;
  });
}

function enrichGeminiFunctionCallPart(
  part: Record<string, any>,
  toolCall?: unknown,
): Record<string, any> {
  const functionCall = isPlainRecord(part.functionCall) ? part.functionCall : undefined;
  const existingId = readGeminiFunctionCallId(functionCall);
  const toolCallId = toolCall ? sanitizeGeminiToolCall(toolCall)?.id : undefined;
  const shouldAddId = toolCallId && !existingId;
  const withId =
    shouldAddId && functionCall
      ? {
          ...part,
          functionCall: {
            ...functionCall,
            id: toolCallId,
          },
        }
      : part;

  if (extractGeminiThoughtSignature(withId)) {
    return withId;
  }

  const thoughtSignature = toolCall ? extractGeminiToolCallThoughtSignature(toolCall) : undefined;
  if (!thoughtSignature) {
    return withId;
  }

  return {
    ...withId,
    thoughtSignature,
  };
}

export function sanitizeGeminiToolCall(toolCall: unknown): Record<string, any> | null {
  if (!isPlainRecord(toolCall)) {
    return null;
  }

  const id = readTrimmedString(toolCall.id) ?? '';
  const type =
    typeof toolCall.type === 'string' && toolCall.type.length > 0 ? toolCall.type : 'function';
  const rawFunction = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
  const name = readTrimmedString(rawFunction?.name) ?? '';
  const args =
    typeof rawFunction?.arguments === 'string'
      ? rawFunction.arguments
      : JSON.stringify(rawFunction?.arguments ?? {});

  if (!id || !name) {
    return null;
  }

  return {
    id,
    type,
    function: {
      name,
      arguments: args,
    },
  };
}

export function buildGeminiFunctionCallPart(toolCall: unknown): Record<string, any> | null {
  const sanitized = sanitizeGeminiToolCall(toolCall);
  if (!sanitized) {
    return null;
  }

  const parsedArgs = safeJsonParse(sanitized.function?.arguments);
  const basePart = {
    functionCall: {
      id: sanitized.id,
      name: sanitized.function?.name || '',
      args: isPlainRecord(parsedArgs) ? parsedArgs : {},
    },
  };

  return enrichGeminiFunctionCallPart(basePart, toolCall);
}

export function buildGeminiFunctionResponsePart(
  message: ChatCompletionMessage,
  toolNameById: Map<string, string>,
): Record<string, any> | null {
  const toolCallId = readTrimmedString(message.tool_call_id) ?? '';
  if (!toolCallId) {
    return null;
  }

  const name = normalizeGeminiToolName(message.name) || toolNameById.get(toolCallId) || 'tool';
  const parsedContent =
    typeof message.content === 'string'
      ? parseGeminiJsonLikeText(message.content)
      : message.content;
  let responsePayload: Record<string, any>;

  if (isPlainRecord(parsedContent)) {
    responsePayload =
      message.is_error === true && !Object.prototype.hasOwnProperty.call(parsedContent, 'error')
        ? { error: parsedContent }
        : parsedContent;
  } else if (message.is_error === true) {
    responsePayload = { error: parsedContent ?? 'Tool failed.' };
  } else {
    responsePayload = { result: parsedContent ?? 'No output.' };
  }

  return {
    functionResponse: {
      id: toolCallId,
      name,
      response: responsePayload,
    },
  };
}

function stripGeminiFunctionIdsFromPart(part: Record<string, any>): Record<string, any> {
  if (isPlainRecord(part.functionCall) && typeof part.functionCall.id === 'string') {
    const functionCall = { ...part.functionCall };
    delete functionCall.id;
    return {
      ...part,
      functionCall,
    };
  }

  if (isPlainRecord(part.functionResponse) && typeof part.functionResponse.id === 'string') {
    const functionResponse = { ...part.functionResponse };
    delete functionResponse.id;
    return {
      ...part,
      functionResponse,
    };
  }

  return part;
}

export function finalizeGeminiRequestParts(
  parts: any[],
  options: { includeFunctionCallIds?: boolean },
): any[] {
  if (options.includeFunctionCallIds !== false) {
    return parts;
  }

  return parts.map((part) => (isPlainRecord(part) ? stripGeminiFunctionIdsFromPart(part) : part));
}
