const LEGACY_HISTORICAL_CONTEXT_RE = /\[Historical context:[^\]]*\]\s*/gi;
const INTERNAL_TOOL_CONTEXT_LINE_RE = /^\s*Previous internal tool (?:call|result):.*(?:\r?\n)?/gim;
const INTERNAL_TOOL_CONTEXT_NOTE_RE =
  /^\s*Previous internal Gemini tool context omitted for compatibility\.(?:\r?\n)?/gim;
const INTERNAL_LINK_CONTEXT_RE = /\s*<link_context>[\s\S]*?<\/link_context>\s*/gi;
const INTERNAL_MEDIA_CONTEXT_RE = /\s*<media_context>[\s\S]*?<\/media_context>\s*/gi;
const RAW_PROVIDER_FUNCTION_BLOCK_RE =
  /(?:<tool_call>\s*)?<function=[A-Za-z0-9_.:-]+>[\s\S]*?<\/function>\s*<\/tool_call>/giu;

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

  return normalizeTranscriptWhitespace(text.replace(RAW_PROVIDER_FUNCTION_BLOCK_RE, ''));
}

export function stripInternalUserTranscriptArtifacts(text: string): string {
  if (!text) {
    return text;
  }

  return normalizeTranscriptWhitespace(
    text.replace(INTERNAL_LINK_CONTEXT_RE, '').replace(INTERNAL_MEDIA_CONTEXT_RE, ''),
  );
}
