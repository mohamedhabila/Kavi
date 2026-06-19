// ---------------------------------------------------------------------------
// Kavi — Tool Definitions
// ---------------------------------------------------------------------------
// Central registry that merges built-in, extended, web, native, MCP and skill tools.

import { ToolDefinition } from '../../types/tool';
import { DOMAIN_TOOL_DEFINITIONS } from './domains';

export const TOOL_DEFINITIONS: ToolDefinition[] = DOMAIN_TOOL_DEFINITIONS;

/**
 * Build the complete tool set including dynamic tools (MCP + Skills).
 * Called by the orchestrator before each LLM call.
 */
export function buildToolDefinitions(
  mcpTools: ToolDefinition[] = [],
  skillTools: ToolDefinition[] = [],
  allowedTools?: Set<string>,
): ToolDefinition[] {
  let all = [...TOOL_DEFINITIONS, ...mcpTools, ...skillTools];

  if (allowedTools) {
    all = all.filter((t) => allowedTools.has(t.name));
  }

  // De-duplicate by name (MCP/Skill overrides win)
  const seen = new Map<string, ToolDefinition>();
  for (const tool of all) {
    seen.set(tool.name, tool);
  }

  return Array.from(seen.values());
}
