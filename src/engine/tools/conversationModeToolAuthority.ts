import type { ConversationMode } from '../../types/conversation';
import type { ToolDefinition } from '../../types/tool';

/**
 * Categories chitchat may never reach, even through discovery. Every one of these
 * exists to control multi-step delegated work, an external development
 * environment, or arbitrary code execution — capabilities a casual conversation has
 * no use for and that "no persona swap" depends on staying behind escalation:
 * spawning or coordinating sub-agent sessions (`sessions`), mutating the goal graph
 * directly (`goal`), a remote shell (`ssh`), native build tooling (`expo`,
 * `expo_manual_actions`), source control (`github`), full browser automation
 * (`browser`), and arbitrary code execution (`code`). Everyday actions — calendar,
 * contacts, messaging, web lookup, device state — live in every other category and
 * stay reachable. This is deliberately a category set, not a tool-name list: a
 * newly registered tool is classified by what it *is*, not by matching its name
 * against a maintained roster.
 */
const AGENTIC_ONLY_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  'sessions',
  'goal',
  'ssh',
  'expo',
  'expo_manual_actions',
  'github',
  'browser',
  'code',
]);

/**
 * Chitchat can use ordinary assistant tools and grounded local memory writes.
 * Graph mutation and worker orchestration belong exclusively to agentic
 * conversations.
 */
export function isToolAllowedForConversationMode(
  tool: Pick<ToolDefinition, 'name' | 'contract'>,
  mode: ConversationMode,
): boolean {
  if (mode === 'agentic') {
    return true;
  }

  const category = tool.contract?.category?.trim();
  return !category || !AGENTIC_ONLY_TOOL_CATEGORIES.has(category);
}

export function filterToolsForConversationMode(
  tools: ReadonlyArray<ToolDefinition>,
  mode: ConversationMode,
): ToolDefinition[] {
  return tools.filter((tool) => isToolAllowedForConversationMode(tool, mode));
}
