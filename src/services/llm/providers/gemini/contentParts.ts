import { normalizeMessageContent, stringifyContentValue } from '../../core/content';
import { isPlainRecord, safeJsonParse } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { readTrimmedString } from '../../core/toolCallNormalization';

export function extractGeminiHistoryText(value: unknown): string {
  const normalized = normalizeMessageContent(value);
  if (typeof normalized === 'string') {
    return normalized;
  }
  if (!Array.isArray(normalized)) {
    return String(normalized ?? '');
  }

  return normalized
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (isPlainRecord(entry)) {
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (entry.type === 'image_url') {
          return '[image]';
        }
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry);
      }
    })
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .join('\n');
}

export function parseGeminiJsonLikeText(value: string): unknown {
  const trimmed = value.trim();
  if (
    !trimmed ||
    (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeGeminiToolName(value: unknown): string | undefined {
  return readTrimmedString(value);
}

export function readGeminiFunctionCallId(functionCall: unknown): string | undefined {
  if (!isPlainRecord(functionCall)) {
    return undefined;
  }
  return readTrimmedString(functionCall.id);
}

export function borrowThoughtSignatureFromReplayParts(
  replayParts: ReadonlyArray<Record<string, any>>,
  functionCallIndex: number,
): string | undefined {
  const normalized = normalizeGeminiContentParts(replayParts);
  let seenFunctionCalls = 0;
  let pendingThoughtSignature: string | undefined;

  for (const part of normalized) {
    const partSignature = extractGeminiThoughtSignature(part);
    if (part.thought === true && partSignature) {
      pendingThoughtSignature = partSignature;
      continue;
    }

    if (!isPlainRecord(part.functionCall)) {
      continue;
    }

    if (seenFunctionCalls === functionCallIndex) {
      return partSignature ?? pendingThoughtSignature;
    }

    seenFunctionCalls += 1;
    pendingThoughtSignature = undefined;
  }

  return undefined;
}

function parseGeminiInlineDataUrl(value: unknown): { mimeType: string; data: string } | null {
  const url =
    typeof value === 'string'
      ? value
      : isPlainRecord(value) && typeof value.url === 'string'
        ? value.url
        : '';

  if (!url) {
    return null;
  }

  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1].trim(),
    data: match[2].replace(/\s+/g, ''),
  };
}

export function normalizeGeminiContentParts(content: unknown): any[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) {
    if (content == null) {
      return [];
    }
    return [{ text: stringifyContentValue(content) }];
  }

  const parts: any[] = [];

  for (const block of content) {
    if (typeof block === 'string') {
      if (block.length > 0) {
        parts.push({ text: block });
      }
      continue;
    }

    if (!isPlainRecord(block)) {
      continue;
    }

    const thoughtSignature =
      typeof block.thoughtSignature === 'string'
        ? block.thoughtSignature
        : typeof block.thought_signature === 'string'
          ? block.thought_signature
          : undefined;
    const isThoughtText =
      block.thought === true ||
      /^(?:reasoning(?:_summary)?_text|reasoning|thinking|thought)$/.test(
        typeof block.type === 'string' ? block.type : '',
      );

    const functionCall = isPlainRecord(block.functionCall)
      ? block.functionCall
      : isPlainRecord(block.function_call)
        ? block.function_call
        : undefined;
    if (functionCall) {
      const id = readGeminiFunctionCallId(functionCall);
      const normalizedPart: Record<string, any> = {
        functionCall: {
          ...(id ? { id } : {}),
          name: typeof functionCall.name === 'string' ? functionCall.name : '',
          args: isPlainRecord(functionCall.args)
            ? functionCall.args
            : safeJsonParse(functionCall.args),
        },
      };
      if (thoughtSignature) {
        normalizedPart.thoughtSignature = thoughtSignature;
      }
      parts.push(normalizedPart);
      continue;
    }

    const functionResponse = isPlainRecord(block.functionResponse)
      ? block.functionResponse
      : isPlainRecord(block.function_response)
        ? block.function_response
        : undefined;
    if (functionResponse) {
      const id = readTrimmedString(functionResponse.id);
      parts.push({
        functionResponse: {
          ...(id ? { id } : {}),
          name: typeof functionResponse.name === 'string' ? functionResponse.name : '',
          response: isPlainRecord(functionResponse.response)
            ? functionResponse.response
            : { result: functionResponse.response },
        },
      });
      continue;
    }

    const inlineData = isPlainRecord(block.inlineData)
      ? block.inlineData
      : isPlainRecord(block.inline_data)
        ? block.inline_data
        : undefined;
    if (
      inlineData &&
      typeof inlineData.data === 'string' &&
      typeof inlineData.mimeType === 'string'
    ) {
      parts.push({
        inlineData: { mimeType: inlineData.mimeType, data: inlineData.data },
      });
      continue;
    }

    if (block.type === 'text' || block.type === 'input_text') {
      if (typeof block.text === 'string' && (block.text.length > 0 || thoughtSignature)) {
        const normalizedPart: Record<string, any> = { text: block.text };
        if (isThoughtText) {
          normalizedPart.thought = true;
        }
        if (thoughtSignature) {
          normalizedPart.thoughtSignature = thoughtSignature;
        }
        parts.push(normalizedPart);
      }
      continue;
    }

    if (block.type === 'image_url' || block.type === 'input_image') {
      const parsed = parseGeminiInlineDataUrl(block.image_url);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
      continue;
    }

    if (block.type === 'input_file' || block.type === 'file') {
      const parsed = parseGeminiInlineDataUrl(block.file_data || block.fileData);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
      continue;
    }

    if (typeof block.text === 'string' && (block.text.length > 0 || thoughtSignature)) {
      const normalizedPart: Record<string, any> = { text: block.text };
      if (isThoughtText) {
        normalizedPart.thought = true;
      }
      if (thoughtSignature) {
        normalizedPart.thoughtSignature = thoughtSignature;
      }
      parts.push(normalizedPart);
    }
  }

  return parts;
}
