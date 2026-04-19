export interface StreamingPreviewOptions {
  charWindow?: number;
  maxLines?: number;
  maxChars?: number;
}

const DEFAULT_STREAMING_CHAR_WINDOW = 5000;
const DEFAULT_STREAMING_PREVIEW_MAX_LINES = 18;
const DEFAULT_STREAMING_PREVIEW_MAX_CHARS = 2200;

export function trimRenderableContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trimEnd();
}

export function buildStreamingPreview(text: string, options?: StreamingPreviewOptions): string {
  const normalized = trimRenderableContent(text);
  if (!normalized) {
    return '';
  }

  const charWindow = Number.isFinite(options?.charWindow)
    ? Math.max(1, Math.floor(options!.charWindow!))
    : DEFAULT_STREAMING_CHAR_WINDOW;
  const maxLines = Number.isFinite(options?.maxLines)
    ? Math.max(1, Math.floor(options!.maxLines!))
    : DEFAULT_STREAMING_PREVIEW_MAX_LINES;
  const maxChars = Number.isFinite(options?.maxChars)
    ? Math.max(1, Math.floor(options!.maxChars!))
    : DEFAULT_STREAMING_PREVIEW_MAX_CHARS;

  let preview = normalized.length > charWindow ? normalized.slice(-charWindow) : normalized;

  const lines = preview.split('\n');
  if (lines.length > maxLines) {
    preview = lines.slice(-maxLines).join('\n');
  }

  if (preview.length > maxChars) {
    preview = preview.slice(-maxChars);
  }

  preview = preview.trimStart();
  if (preview.length >= normalized.length) {
    return preview;
  }

  return preview.includes('\n') ? `…\n${preview}` : `…${preview}`;
}
