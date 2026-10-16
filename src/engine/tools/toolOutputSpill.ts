// ---------------------------------------------------------------------------
// Kavi — Tool output spill
// ---------------------------------------------------------------------------
// Spills oversized tool results to the conversation workspace and returns a
// compact pointer + preview for model context.
// ---------------------------------------------------------------------------

import { writeConversationWorkspaceTextFile } from '../../services/conversationWorkspace/files';
import { normalizeToolName } from './toolNameNormalization';
import { getToolResultCharBudget } from '../toolResultGuard';
import { extractToolOutputStructuralMetadata } from './toolOutputStructuralMetadata';
import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';

/**
 * Results up to this many characters reach the model whole; past it a result is saved to
 * the workspace and the model gets a preview and the path. It is Claude Code's documented
 * persist-to-disk threshold for tool results (code.claude.com/docs/en/mcp). An 8 KB
 * threshold used to spill a list of the person's mail or notes and answer from its first
 * 1,200 characters (41 of 474 integration results in 29 of 50 Claw-Anything tasks).
 */
export const TOOL_OUTPUT_SPILL_CHAR_THRESHOLD = 50_000;
export const TOOL_OUTPUT_DISCOVERY_SPILL_CHAR_THRESHOLD = 64 * 1024;
export const TOOL_OUTPUT_SPILL_PREVIEW_CHARS = 1_200;

const INLINE_DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

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

/**
 * The characters a result of [toolName] may hold before it spills, never more than one
 * result may take of the model's working window ([contextWindowTokens]), so a small
 * on-device window spills sooner than a large hosted one.
 */
export function resolveToolOutputSpillThreshold(
  toolName: string,
  contextWindowTokens?: number,
): number {
  const threshold = INLINE_DISCOVERY_TOOL_NAMES.has(normalizeToolName(toolName))
    ? TOOL_OUTPUT_DISCOVERY_SPILL_CHAR_THRESHOLD
    : TOOL_OUTPUT_SPILL_CHAR_THRESHOLD;
  return contextWindowTokens === undefined
    ? threshold
    : Math.min(threshold, getToolResultCharBudget(contextWindowTokens));
}

export async function maybeSpillToolOutput(params: {
  result: string;
  conversationId: string;
  toolName: string;
  /** The model's working window, which bounds the threshold; the standard alone without it. */
  contextWindowTokens?: number;
  timestamp?: number;
}): Promise<ToolOutputSpillResult> {
  const byteLength = new TextEncoder().encode(params.result).length;
  const spillThreshold = resolveToolOutputSpillThreshold(
    params.toolName,
    params.contextWindowTokens,
  );
  const previewSource = selectPreviewSource(params.result);
  const preview = truncateGraphemesWithSuffix(previewSource, TOOL_OUTPUT_SPILL_PREVIEW_CHARS, '…');

  if (params.result.length <= spillThreshold) {
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
