import type { ConversationMode } from '../../types/conversation';
import type { ToolDefinition } from '../../types/tool';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import { isSessionToolName } from './sessionToolKinds';
import { normalizeToolName } from './toolNameNormalization';

/**
 * Chitchat can still use ordinary assistant tools. Graph mutation and worker
 * orchestration belong exclusively to agentic conversations.
 */
export function isToolAllowedForConversationMode(
  tool: Pick<ToolDefinition, 'name' | 'contract'>,
  mode: ConversationMode,
): boolean {
  if (mode === 'agentic') {
    return true;
  }

  const toolName = normalizeToolName(tool.name);
  return (
    toolName !== GOAL_BOOTSTRAP_TOOL_NAME &&
    !isSessionToolName(toolName) &&
    tool.contract?.category !== 'sessions'
  );
}

export function filterToolsForConversationMode(
  tools: ReadonlyArray<ToolDefinition>,
  mode: ConversationMode,
): ToolDefinition[] {
  return tools.filter((tool) => isToolAllowedForConversationMode(tool, mode));
}
