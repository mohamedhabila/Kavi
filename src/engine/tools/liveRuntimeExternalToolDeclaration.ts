import type { ToolDefinition } from '../../types/tool';
import { mcpManager } from '../../services/mcp/manager';
import { parseMcpToolName } from '../../services/mcp/bridge';
import { captureSkillRuntimeToolBinding } from '../../services/skills/manager';
import { resolveRegisteredToolName } from './toolNameNormalization';

const MCP_TOOL_PREFIX = 'mcp__';
const SKILL_TOOL_PREFIX = 'skill__';

/**
 * The declaration the live registry holds for a connected MCP or loaded skill tool: what
 * activating it would put on the surface. Undefined for any other name, and when nothing
 * executable answers to it.
 */
export function findLiveRuntimeExternalToolDeclaration(
  rawToolName: string,
): ToolDefinition | undefined {
  const toolName = resolveRegisteredToolName(rawToolName);
  if (toolName.startsWith(MCP_TOOL_PREFIX)) {
    const mcp = parseMcpToolName(toolName);
    return mcp
      ? mcpManager.captureRuntimeToolBinding(mcp.serverId, mcp.toolName)?.declaration
      : undefined;
  }
  if (toolName.startsWith(SKILL_TOOL_PREFIX)) {
    return captureSkillRuntimeToolBinding(toolName)?.declaration;
  }
  return undefined;
}
