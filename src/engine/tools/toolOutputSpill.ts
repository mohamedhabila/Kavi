// ---------------------------------------------------------------------------
// Kavi — Tool output spill
// ---------------------------------------------------------------------------
// Spills oversized tool results to the conversation workspace and returns a
// compact pointer + preview for model context.
// ---------------------------------------------------------------------------

import { writeConversationWorkspaceTextFile } from '../../services/conversationWorkspace/files';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';
import { extractToolOutputStructuralMetadata } from './toolOutputStructuralMetadata';

export const TOOL_OUTPUT_SPILL_BYTE_THRESHOLD = 8 * 1024;
export const TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD = 64 * 1024;
/**
 * Applies to tools whose result size the caller already bounded.
 *
 * Spilling exists to keep an unbounded result out of the context window. When the
 * caller has already capped the size, spilling buys nothing: the model still needs the
 * content, so it reads the file straight back and the run pays an extra tool call and
 * an extra model turn for bytes it had asked for and would have received anyway.
 *
 * `web_fetch` defaults to a 20,000-character window, well above the general 8 KB
 * threshold, so every substantial page fetch was guaranteed to spill and hand back a
 * 1,200-character preview. Traced on device as two spill files and two `read_file`
 * calls in a run that fetched twice. The ceiling stays finite so a genuinely oversized
 * multi-page fetch still spills.
 */
export const TOOL_OUTPUT_BOUNDED_CONTENT_SPILL_BYTE_THRESHOLD = 32 * 1024;
export const TOOL_OUTPUT_SPILL_PREVIEW_CHARS = 1_200;

const INLINE_DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

/**
 * Resolved from each tool's own `contract.boundedOutput` declaration rather than a
 * hand-maintained name list, so a new tool that bounds its output is handled by
 * declaring it — no edit here, and no way for the two to drift apart.
 */
const CALLER_BOUNDED_CONTENT_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_DEFINITIONS.filter((tool) => tool.contract?.boundedOutput === true).map((tool) =>
    normalizeToolName(tool.name),
  ),
);

export type ToolOutputSpillResult = {
  spilled: boolean;
  path?: string;
  byteLength: number;
  preview: string;
  payload: string;
};

/**
 * Previews the payload's own content rather than its transport envelope.
 *
 * Most tool results are JSON, so a head slice of the raw string spends the whole
 * preview budget on the wrapper — `{"fetches":[{"url":"https://…","content":"…` — and
 * shows only the first characters of the page, which is navigation chrome. The model
 * learns nothing it can act on, so it reads the spill file back every single time and
 * the offload costs a model turn instead of saving one. Offloading only pays off when
 * the summary that replaces the result is worth reading.
 *
 * The largest string in the payload is the payload's substance, whatever the tool.
 * That keeps this general instead of a per-tool special case.
 */
function selectPreviewSource(result: string): string {
  const trimmed = result.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return result;
  }

  let longest = '';
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) return;
    if (typeof value === 'string') {
      if (value.length > longest.length) longest = value;
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) visit(entry, depth + 1);
    }
  };
  visit(parsed, 0);

  // A payload whose longest string is trivial carries its meaning in its structure,
  // so the raw envelope is the more informative preview.
  return longest.length >= TOOL_OUTPUT_SPILL_PREVIEW_CHARS / 4 ? longest : result;
}

function buildSpillPath(toolName: string, timestamp: number): string {
  const normalized = normalizeToolName(toolName).replace(/[^a-z0-9._-]+/g, '-');
  return `.kavi/spill/${normalized || 'tool'}-${timestamp}.txt`;
}

export function resolveToolOutputSpillByteThreshold(toolName: string): number {
  const normalized = normalizeToolName(toolName);
  if (INLINE_DISCOVERY_TOOL_NAMES.has(normalized)) {
    return TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD;
  }
  if (CALLER_BOUNDED_CONTENT_TOOL_NAMES.has(normalized)) {
    return TOOL_OUTPUT_BOUNDED_CONTENT_SPILL_BYTE_THRESHOLD;
  }
  return TOOL_OUTPUT_SPILL_BYTE_THRESHOLD;
}

export async function maybeSpillToolOutput(params: {
  result: string;
  conversationId: string;
  toolName: string;
  timestamp?: number;
}): Promise<ToolOutputSpillResult> {
  const byteLength = new TextEncoder().encode(params.result).length;
  const spillByteThreshold = resolveToolOutputSpillByteThreshold(params.toolName);
  const previewSource = selectPreviewSource(params.result);
  const preview =
    previewSource.length <= TOOL_OUTPUT_SPILL_PREVIEW_CHARS
      ? previewSource
      : `${previewSource.slice(0, TOOL_OUTPUT_SPILL_PREVIEW_CHARS).trimEnd()}…`;

  if (byteLength <= spillByteThreshold) {
    return {
      spilled: false,
      byteLength,
      preview,
      payload: params.result,
    };
  }

  const timestamp = params.timestamp ?? Date.now();
  const path = buildSpillPath(params.toolName, timestamp);
  await writeConversationWorkspaceTextFile(params.conversationId, path, params.result);
  const structuralResult = extractToolOutputStructuralMetadata({
    toolName: params.toolName,
    result: params.result,
  });

  const payload = JSON.stringify({
    status: 'spilled',
    path,
    byteLength,
    preview,
    ...(structuralResult ? { structuralResult } : {}),
    notice:
      'Tool output exceeded the inline context budget and was saved to the conversation workspace. ' +
      'The preview above is the start of the result content. Read the path with read_file only if the preview does not already answer the question.',
  });

  return {
    spilled: true,
    path,
    byteLength,
    preview,
    payload,
  };
}
