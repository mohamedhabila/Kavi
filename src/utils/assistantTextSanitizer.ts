const LEGACY_HISTORICAL_CONTEXT_RE = /\[Historical context:[^\]]*\]\s*/gi;
const INTERNAL_TOOL_CONTEXT_LINE_RE = /^\s*Previous internal tool (?:call|result):.*(?:\r?\n)?/gim;
const INTERNAL_TOOL_CONTEXT_NOTE_RE =
  /^\s*Previous internal Gemini tool context omitted for compatibility\.(?:\r?\n)?/gim;
const INTERNAL_LINK_CONTEXT_RE = /\s*<link_context>[\s\S]*?<\/link_context>\s*/gi;
const INTERNAL_MEDIA_CONTEXT_RE = /\s*<media_context>[\s\S]*?<\/media_context>\s*/gi;
const RAW_PROVIDER_FUNCTION_INNER_PATTERN =
  '<function=[A-Za-z0-9_.:-]+>[\\s\\S]*?<\\/function>\\s*<\\/tool_call>';
const RAW_PROVIDER_FUNCTION_BLOCK_RE = new RegExp(
  `(?:<tool_call>\\s*)?${RAW_PROVIDER_FUNCTION_INNER_PATTERN}`,
  'giu',
);
const RAW_PROVIDER_FUNCTION_BLOCK_DETECTION_RE = new RegExp(
  `<tool_call>\\s*${RAW_PROVIDER_FUNCTION_INNER_PATTERN}`,
  'iu',
);

/**
 * The same failure in a second dialect: a tool call the model wrote as text because the
 * provider did not deliver it through the structured tool channel.
 *
 * The pattern above spells one vendor's tags literally, so it recognized only that
 * vendor. Another family delimits the same protocol with special tokens —
 * `<|NS|tool_calls>` wrapping `<|NS|invoke name="...">` — and went unrecognized, which
 * defeated both gates at once: `noToolTurnResolution` never held the turn to make the
 * model retry the call properly, and the display strip never fired. The batch reached
 * the user as the final answer, raw.
 *
 * Traced live on-device: a run ended by rendering `<|DSML|tool_calls>` wrapping an
 * `update_goals` invocation as its reply.
 *
 * Matching is structural rather than another literal: a batch container, an invocation
 * naming a tool inside it, and the matching close. Requiring all three is what keeps
 * prose out — text discussing these tags does not carry a closed invocation.
 */
const SPECIAL_TOKEN_NAMESPACE = '[A-Za-z0-9_.:-]+';
const SPECIAL_TOKEN_TOOL_CALL_INNER_PATTERN =
  `<\\|${SPECIAL_TOKEN_NAMESPACE}\\|tool_calls>` +
  `[\\s\\S]*?<\\|${SPECIAL_TOKEN_NAMESPACE}\\|invoke\\b[\\s\\S]*?` +
  `<\\/\\|${SPECIAL_TOKEN_NAMESPACE}\\|tool_calls>`;
const SPECIAL_TOKEN_TOOL_CALL_BLOCK_RE = new RegExp(
  SPECIAL_TOKEN_TOOL_CALL_INNER_PATTERN,
  'giu',
);
const SPECIAL_TOKEN_TOOL_CALL_DETECTION_RE = new RegExp(
  SPECIAL_TOKEN_TOOL_CALL_INNER_PATTERN,
  'iu',
);

function normalizeTranscriptWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripInternalAssistantTranscriptArtifacts(text: string): string {
  if (!text) {
    return text;
  }

  return normalizeTranscriptWhitespace(
    text
      .replace(LEGACY_HISTORICAL_CONTEXT_RE, '')
      .replace(INTERNAL_TOOL_CONTEXT_LINE_RE, '')
      .replace(INTERNAL_TOOL_CONTEXT_NOTE_RE, ''),
  );
}

/**
 * Removes provider protocol markup from an intermediate tool turn before it is
 * rendered or copied. Callers must scope this to a turn that also contains a
 * structured tool call so legitimate final answers containing markup remain
 * untouched.
 */
export function stripRawProviderToolCallMarkupForDisplay(text: string): string {
  if (!text) {
    return text;
  }

  return normalizeTranscriptWhitespace(
    text
      .replace(RAW_PROVIDER_FUNCTION_BLOCK_RE, '')
      .replace(SPECIAL_TOKEN_TOOL_CALL_BLOCK_RE, ''),
  );
}

/** Detect a complete provider-protocol function block, never task-language intent. */
export function containsRawProviderToolCallMarkup(text: string): boolean {
  if (!text) {
    return false;
  }
  return (
    RAW_PROVIDER_FUNCTION_BLOCK_DETECTION_RE.test(text) ||
    SPECIAL_TOKEN_TOOL_CALL_DETECTION_RE.test(text)
  );
}

export function stripInternalUserTranscriptArtifacts(text: string): string {
  if (!text) {
    return text;
  }

  return normalizeTranscriptWhitespace(
    text.replace(INTERNAL_LINK_CONTEXT_RE, '').replace(INTERNAL_MEDIA_CONTEXT_RE, ''),
  );
}
