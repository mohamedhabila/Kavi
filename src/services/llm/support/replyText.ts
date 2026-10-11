// ---------------------------------------------------------------------------
// Kavi — Text of a non-streaming model reply
// ---------------------------------------------------------------------------
// `LlmService.sendMessage` returns the provider's reply shape: a plain string, an OpenAI
// chat completion (content as a string or as parts) or a Responses-style `output_text`.
// Helper calls such as compaction only need the text.
// ---------------------------------------------------------------------------

function partText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  const value = part as { text?: unknown; output_text?: unknown };
  if (typeof value.text === 'string') return value.text;
  return typeof value.output_text === 'string' ? value.output_text : '';
}

/** The reply's text, or '' when the reply carries none. */
export function readReplyText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const value = response as Record<string, unknown>;
  const content = (value.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]
    ?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(partText).join('');
  return typeof value.output_text === 'string' ? value.output_text : '';
}
