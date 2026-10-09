// ---------------------------------------------------------------------------
// Kavi — token estimates for structured (multi-part) message content
// ---------------------------------------------------------------------------
// A message with attachments carries content parts, not a string. Serializing those
// parts and counting the text counted an image's base64 payload as prose: a 1 MB photo
// estimated at ~333K tokens, so one picture in the history pushed every later request
// into windowing and compaction it did not need. Providers bill an image by its pixels
// up to a documented ceiling, never by its encoded size (checked 2026-10-09):
//
//   - Anthropic: ⌈w/28⌉ × ⌈h/28⌉ visual tokens, capped at 1,568 (standard tier) or
//     4,784 (high-resolution tier, Claude 4.7+) — platform.claude.com, "Vision".
//   - OpenAI: tile-based 85 + 170 per 512 px tile; patch-based up to a 2,500-patch
//     budget × 1.2 ≈ 3,000 — developers.openai.com, "Images and vision".
//   - Gemini 3: 1,120 per image by default, 2,240 at ultra_high —
//     ai.google.dev, "Media resolution".
//
// An image's pixel size is not known when a request is budgeted, so each image counts
// at its provider's ceiling: never below the real cost, and within a few thousand
// tokens of it instead of hundreds of thousands.
// ---------------------------------------------------------------------------

import {
  CONVERSATION_PRIMING_TOKENS,
  estimateTokens,
  MESSAGE_FRAMING_TOKENS,
} from './tokenCounter';

const IMAGE_TOKEN_CEILING_BY_FAMILY: Readonly<Record<string, number>> = {
  anthropic: 4_784,
  openai: 3_000,
  gemini: 2_240,
};
/** A router or unknown provider may serve any model, so it gets the largest ceiling. */
const DEFAULT_IMAGE_TOKEN_CEILING = 4_784;
const IMAGE_PART_TYPES = new Set(['image_url', 'image', 'input_image']);

export function estimateImageInputTokens(family?: string | null): number {
  return (family && IMAGE_TOKEN_CEILING_BY_FAMILY[family]) || DEFAULT_IMAGE_TOKEN_CEILING;
}

function isImagePart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === 'object' &&
    IMAGE_PART_TYPES.has(String((part as { type?: unknown }).type))
  );
}

/**
 * Tokens for one message's content: text as text, each image at its provider ceiling,
 * and every other part (documents, tool payloads) as its serialized text, as before.
 */
export function estimateContentTokens(content: unknown, family?: string | null): number {
  if (typeof content === 'string') return estimateTokens(content, family);
  if (content === null || content === undefined) return 0;
  if (!Array.isArray(content)) return estimateTokens(JSON.stringify(content), family);

  let imageCount = 0;
  const otherParts: unknown[] = [];
  for (const part of content) {
    if (isImagePart(part)) imageCount += 1;
    else otherParts.push(part);
  }
  const otherTokens =
    otherParts.length > 0 ? estimateTokens(JSON.stringify(otherParts), family) : 0;
  return otherTokens + imageCount * estimateImageInputTokens(family);
}

type ApiMessageLike = { role: string; content: unknown; tool_calls?: unknown };

/** One API message's framing, content, and tool calls — what windowing drops it for. */
export function estimateApiMessageCost(message: ApiMessageLike, family?: string | null): number {
  const toolCallTokens =
    Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      ? estimateTokens(JSON.stringify(message.tool_calls), family)
      : 0;
  return MESSAGE_FRAMING_TOKENS + estimateContentTokens(message.content, family) + toolCallTokens;
}

/** `estimateMessageTokens` for API messages whose content may be structured parts. */
export function estimateApiMessagesTokens(
  messages: ReadonlyArray<ApiMessageLike>,
  family?: string | null,
): number {
  return messages.reduce(
    (total, message) =>
      total + estimateTokens(message.role, family) + estimateApiMessageCost(message, family),
    CONVERSATION_PRIMING_TOKENS,
  );
}
