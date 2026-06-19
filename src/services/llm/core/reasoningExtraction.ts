import { isPlainRecord } from './json';
import { readTrimmedString } from './toolCallNormalization';

export type ReasoningTextPart = { key: string; text: string };

export function extractGeminiThoughtSignature(value: unknown): string | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const thoughtSignature =
    typeof value.thoughtSignature === 'string'
      ? value.thoughtSignature
      : typeof value.thought_signature === 'string'
        ? value.thought_signature
        : undefined;

  if (typeof thoughtSignature !== 'string') {
    return undefined;
  }

  const trimmed = thoughtSignature.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractGeminiToolCallThoughtSignature(toolCall: unknown): string | undefined {
  const direct = extractGeminiThoughtSignature(toolCall);
  if (direct) {
    return direct;
  }

  if (!isPlainRecord(toolCall)) {
    return undefined;
  }

  const fromRaw = extractGeminiThoughtSignature(toolCall.raw);
  if (fromRaw) {
    return fromRaw;
  }

  const extraContent = isPlainRecord(toolCall.extra_content)
    ? toolCall.extra_content
    : isPlainRecord(toolCall.extraContent)
      ? toolCall.extraContent
      : undefined;
  const googlePayload = isPlainRecord(extraContent?.google) ? extraContent.google : undefined;
  return extractGeminiThoughtSignature(googlePayload);
}

export function getOpenAIReasoningItemKey(item: Record<string, any>): string {
  return typeof item.id === 'string' && item.id.length > 0 ? item.id : JSON.stringify(item);
}

export function getOpenAIReasoningItemsFromToolCalls(
  toolCalls: Record<string, any>[],
): Record<string, any>[] {
  const items: Record<string, any>[] = [];
  const seen = new Set<string>();

  for (const toolCall of toolCalls) {
    const metadata = isPlainRecord(toolCall._openai) ? toolCall._openai : undefined;
    const reasoningItems = Array.isArray(metadata?.reasoningItems)
      ? metadata.reasoningItems.filter((item: unknown): item is Record<string, any> =>
          isPlainRecord(item),
        )
      : [];

    for (const item of reasoningItems) {
      const key = getOpenAIReasoningItemKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
    }
  }

  return items;
}

export function getOpenAIReasoningTextParts(item: Record<string, any>): ReasoningTextPart[] {
  const itemKey = getOpenAIReasoningItemKey(item);
  const parts: ReasoningTextPart[] = [];

  const summaryParts = Array.isArray(item.summary)
    ? item.summary.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
    : [];
  summaryParts.forEach((part, index) => {
    if (typeof part.text === 'string' && part.text.length > 0) {
      parts.push({ key: `summary:${itemKey}:${index}`, text: part.text });
    }
  });

  const contentParts = Array.isArray(item.content)
    ? item.content.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
    : [];
  contentParts.forEach((part, index) => {
    if (typeof part.text === 'string' && part.text.length > 0) {
      parts.push({ key: `reasoning:${itemKey}:${index}`, text: part.text });
    }
  });

  if (parts.length === 0 && typeof item.text === 'string' && item.text.length > 0) {
    parts.push({ key: `reasoning:${itemKey}:text`, text: item.text });
  }

  return parts;
}

export function extractOpenAIReasoningText(items: Record<string, any>[]): string {
  return items
    .flatMap((item) => getOpenAIReasoningTextParts(item).map((part) => part.text.trim()))
    .filter((text) => text.length > 0)
    .join('\n\n');
}

export function readReasoningReplayKey(item: Record<string, any>): string {
  return readTrimmedString(item.id) ?? JSON.stringify(item);
}
