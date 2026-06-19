import { normalizeUsage } from '../../../usage/tracker';
import { isPlainRecord, safeJsonParse, tryParseJson } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { normalizeGeminiContentParts } from './contentParts';
import { createGeminiFallbackToolCallId } from './fallbackToolCallIds';
import { isDeclaredToolName } from '../../core/toolNameFilter';

export function normalizeGeminiFinishReason(finishReason: unknown): string {
  const normalized = typeof finishReason === 'string' ? finishReason.toUpperCase() : '';

  switch (normalized) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'RECITATION':
    case 'IMAGE_SAFETY':
    case 'IMAGE_PROHIBITED_CONTENT':
    case 'IMAGE_RECITATION':
      return 'content_filter';
    default:
      return normalized ? normalized.toLowerCase() : 'stop';
  }
}

function normalizeGeminiUsageResult(usage: any): Record<string, any> | undefined {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return undefined;
  }

  const result: Record<string, any> = {
    prompt_tokens: normalizedUsage.inputTokens,
    completion_tokens: normalizedUsage.outputTokens,
    total_tokens: normalizedUsage.totalTokens,
  };

  if (normalizedUsage.cacheReadTokens > 0) {
    result.cache_read_input_tokens = normalizedUsage.cacheReadTokens;
    result.prompt_tokens_details = {
      cached_tokens: normalizedUsage.cacheReadTokens,
      ...(normalizedUsage.cacheWriteTokens > 0
        ? { cache_write_tokens: normalizedUsage.cacheWriteTokens }
        : {}),
    };
  }

  if (normalizedUsage.cacheWriteTokens > 0) {
    result.cache_creation_input_tokens = normalizedUsage.cacheWriteTokens;
    if (!result.prompt_tokens_details) {
      result.prompt_tokens_details = {
        cache_write_tokens: normalizedUsage.cacheWriteTokens,
      };
    }
  }

  return result;
}

export function normalizeGeminiResponse(
  json: any,
  options: { declaredToolNames?: ReadonlySet<string> } = {},
): any {
  const candidate = Array.isArray(json?.candidates)
    ? json.candidates.find((entry: unknown) => isPlainRecord(entry))
    : undefined;

  if (!candidate) {
    const blockReason =
      typeof json?.promptFeedback?.blockReason === 'string' ? json.promptFeedback.blockReason : '';
    if (blockReason) {
      throw new Error(`Gemini prompt blocked: ${blockReason}`);
    }
    throw new Error('Gemini response returned no candidates');
  }

  const parts = Array.isArray(candidate.content?.parts)
    ? candidate.content.parts.filter((part: unknown): part is Record<string, any> =>
        isPlainRecord(part),
      )
    : [];
  const replayParts = normalizeGeminiContentParts(parts).filter((part) => {
    if (!isPlainRecord(part.functionCall)) {
      return true;
    }
    const name = typeof part.functionCall.name === 'string' ? part.functionCall.name : '';
    return isDeclaredToolName(name, options.declaredToolNames);
  });
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: Array<Record<string, any>> = [];
  let outputParsed: unknown;
  let pendingThoughtSignature: string | undefined;

  for (const part of parts) {
    if (outputParsed === undefined && part.structured_output != null) {
      outputParsed = part.structured_output;
    }
    const functionCall = isPlainRecord(part.functionCall)
      ? part.functionCall
      : isPlainRecord(part.function_call)
        ? part.function_call
        : undefined;

    if (functionCall) {
      const name = typeof functionCall.name === 'string' ? functionCall.name : '';
      if (!isDeclaredToolName(name, options.declaredToolNames)) {
        pendingThoughtSignature = undefined;
        continue;
      }
      const args = isPlainRecord(functionCall.args)
        ? functionCall.args
        : safeJsonParse(functionCall.args);
      const argumentsText = JSON.stringify(isPlainRecord(args) ? args : {});
      const thoughtSignature =
        extractGeminiThoughtSignature(part) ??
        (toolCalls.length === 0 ? pendingThoughtSignature : undefined);
      pendingThoughtSignature = undefined;
      const id =
        typeof functionCall.id === 'string' && functionCall.id.length > 0
          ? functionCall.id
          : createGeminiFallbackToolCallId({
              ordinal: toolCalls.length,
              name,
              args: isPlainRecord(args) ? args : {},
            });
      const raw: Record<string, any> = {
        id,
        type: 'function',
        function: {
          name,
          arguments: argumentsText,
        },
        ...(thoughtSignature
          ? {
              thoughtSignature,
              extra_content: { google: { thought_signature: thoughtSignature } },
            }
          : {}),
      };

      toolCalls.push({
        id: raw.id,
        type: 'function',
        index: toolCalls.length,
        function: { ...raw.function },
        raw,
      });
      continue;
    }

    const partThoughtSignature = extractGeminiThoughtSignature(part);
    if (part.thought === true) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        reasoningParts.push(part.text);
      }
      if (partThoughtSignature) {
        pendingThoughtSignature = partThoughtSignature;
      }
      continue;
    }

    if (partThoughtSignature && (typeof part.text !== 'string' || part.text.length === 0)) {
      pendingThoughtSignature = partThoughtSignature;
      continue;
    }

    if (typeof part.text === 'string' && part.text.length > 0) {
      contentParts.push(part.text);
    }
  }

  if (outputParsed === undefined) {
    outputParsed = tryParseJson(contentParts.join(''));
  }

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: contentParts.join(''),
          ...(reasoningParts.length > 0 ? { reasoning: reasoningParts.join('') } : {}),
          ...(replayParts.length > 0 ? { providerReplay: { geminiParts: replayParts } } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          toolCalls.length > 0 ? 'tool_calls' : normalizeGeminiFinishReason(candidate.finishReason),
      },
    ],
    ...(outputParsed !== undefined ? { output_parsed: outputParsed } : {}),
    ...(normalizeGeminiUsageResult(json?.usageMetadata)
      ? { usage: normalizeGeminiUsageResult(json?.usageMetadata) }
      : {}),
  };
}
