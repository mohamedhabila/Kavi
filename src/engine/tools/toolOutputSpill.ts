// ---------------------------------------------------------------------------
// Kavi — Tool output spill
// ---------------------------------------------------------------------------
// Spills oversized tool results to the conversation workspace and returns a
// compact pointer + preview for model context.
// ---------------------------------------------------------------------------

import { writeConversationWorkspaceTextFile } from '../../services/conversationWorkspace/files';
import { normalizeToolName } from './toolNameNormalization';

export const TOOL_OUTPUT_SPILL_BYTE_THRESHOLD = 8 * 1024;
export const TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD = 64 * 1024;
export const TOOL_OUTPUT_SPILL_PREVIEW_CHARS = 1_200;

const INLINE_DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

export type ToolOutputSpillResult = {
  spilled: boolean;
  path?: string;
  byteLength: number;
  preview: string;
  payload: string;
};

function buildSpillPath(toolName: string, timestamp: number): string {
  const normalized = normalizeToolName(toolName).replace(/[^a-z0-9._-]+/g, '-');
  return `.kavi/spill/${normalized || 'tool'}-${timestamp}.txt`;
}

export function resolveToolOutputSpillByteThreshold(toolName: string): number {
  return INLINE_DISCOVERY_TOOL_NAMES.has(normalizeToolName(toolName))
    ? TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD
    : TOOL_OUTPUT_SPILL_BYTE_THRESHOLD;
}

export async function maybeSpillToolOutput(params: {
  result: string;
  conversationId: string;
  toolName: string;
  timestamp?: number;
}): Promise<ToolOutputSpillResult> {
  const byteLength = new TextEncoder().encode(params.result).length;
  const spillByteThreshold = resolveToolOutputSpillByteThreshold(params.toolName);
  const preview =
    params.result.length <= TOOL_OUTPUT_SPILL_PREVIEW_CHARS
      ? params.result
      : `${params.result.slice(0, TOOL_OUTPUT_SPILL_PREVIEW_CHARS).trimEnd()}…`;

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

  const payload = JSON.stringify({
    status: 'spilled',
    path,
    byteLength,
    preview,
    notice:
      'Tool output exceeded the inline context budget and was saved to the conversation workspace.',
  });

  return {
    spilled: true,
    path,
    byteLength,
    preview,
    payload,
  };
}
