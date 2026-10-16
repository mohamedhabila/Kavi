// ---------------------------------------------------------------------------
// Kavi — A connected integration's tools on the surface
// ---------------------------------------------------------------------------
// The person connected an integration (an MCP server) for Kavi to use. Its tools are
// declared with their schemas from the first turn while they fit a tenth of the model's
// working window, the threshold Claude Code's documented `auto` tool-search mode uses
// (code.claude.com/docs/en/mcp, "Scale with MCP tool search"); past it they all stay in the
// capability index, named and callable, and are declared once used. Listed only by name,
// the person's mail, calendar and notes went unread: Claude searched the workspace files,
// found nothing and asked the person (21 of 30 frozen first steps opened the apps; with the
// tools declared, 30 of 30).
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { getWorkingContextWindow } from '../../services/context/tokenCounter';
import { estimateToolTokens } from './toolManagerTokenBudget';
import { normalizeToolName } from './toolNameNormalization';

/** Share of the working window connected integrations' declarations may take. */
export const UPFRONT_INTEGRATION_TOOL_CONTEXT_SHARE = 0.1;

const INTEGRATION_TOOL_PREFIX = 'mcp__';

/**
 * The connected integrations' tools to declare from the first turn, in a stable order (the
 * declaration block heads the prompt cache), or none when together they exceed the share.
 */
export function selectUpfrontIntegrationToolNames(
  allTools: ReadonlyArray<ToolDefinition>,
  model: string,
  options?: { onDeviceProvider?: boolean },
): string[] {
  const integrationTools = allTools
    .filter((tool) => normalizeToolName(tool.name).startsWith(INTEGRATION_TOOL_PREFIX))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (integrationTools.length === 0) return [];
  const declarationTokens = integrationTools.reduce(
    (total, tool) => total + estimateToolTokens(tool),
    0,
  );
  const budget =
    getWorkingContextWindow(model, { onDeviceProvider: options?.onDeviceProvider === true }) *
    UPFRONT_INTEGRATION_TOOL_CONTEXT_SHARE;
  return declarationTokens <= budget ? integrationTools.map((tool) => tool.name) : [];
}
