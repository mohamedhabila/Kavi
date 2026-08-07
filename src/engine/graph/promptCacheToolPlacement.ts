import { DEFAULT_CORE_TOOL_ORDER } from '../goals/toolSurface';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { ToolDefinition } from '../../types/tool';

const DEFAULT_CORE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  DEFAULT_CORE_TOOL_ORDER.map((toolName) => normalizeToolName(toolName)),
);

/**
 * Marks which tool declarations belong in the prompt's reusable prefix.
 *
 * Prompt caches key on an exact byte prefix, so a declaration block that changes
 * shape between turns invalidates itself and everything after it — system prompt
 * tail, conversation history, the lot. Progressive tool disclosure changes that block
 * on purpose: each activation adds a tool. `buildPromptCachingToolOrder` was written
 * to absorb exactly this, holding a stable prefix ahead of a dynamic suffix, but it
 * only engages when some tool declares a placement — and no tool ever did. Every tool
 * was therefore treated as stable and sorted by name, so an activated tool landed in
 * the middle of the block and shifted every declaration after it.
 *
 * The default core surface is present on every turn of every run, which is what makes
 * it a sound prefix; discovery-activated tools are the part that legitimately varies,
 * so they sort into the suffix behind the cache boundary. This is declaration ordering
 * only — the executable tool surface is unchanged, and no tool gains or loses
 * availability.
 */
export function stampPromptCachePlacement(
  tools: ReadonlyArray<ToolDefinition>,
): ToolDefinition[] {
  return tools.map((tool) => ({
    ...tool,
    promptCache: {
      ...tool.promptCache,
      placement: DEFAULT_CORE_TOOL_NAME_SET.has(normalizeToolName(tool.name))
        ? ('stable_prefix' as const)
        : ('dynamic_suffix' as const),
    },
  }));
}
