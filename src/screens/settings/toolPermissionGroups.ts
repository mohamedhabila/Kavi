import { inferToolCapabilityDescriptor } from '../../engine/tools/capabilityRegistry';
import type { ToolDefinition } from '../../types/tool';

/**
 * The agent's own machinery — finding tools, keeping its plan and waiting on work it
 * started. Turning any of these off would break every task, so Settings does not offer them.
 */
const AGENT_MACHINERY_CATEGORIES: ReadonlySet<string> = new Set(['tools', 'plan', 'async_wait']);

export type ToolPermissionGroup = {
  /** The contract category; its title is `settings.toolGroups.<id>.title`. */
  id: string;
  definitions: ToolDefinition[];
};

/**
 * Every built-in tool a user can turn off, grouped by the category its contract declares, so
 * a newly registered tool appears in Settings by what it is rather than by being added to a
 * hand-kept list.
 */
export function buildToolPermissionGroups(
  definitions: ReadonlyArray<ToolDefinition>,
): ToolPermissionGroup[] {
  const groups = new Map<string, ToolDefinition[]>();
  for (const definition of definitions) {
    const category = inferToolCapabilityDescriptor(definition).category;
    if (!category || AGENT_MACHINERY_CATEGORIES.has(category)) continue;
    const group = groups.get(category);
    if (group) group.push(definition);
    else groups.set(category, [definition]);
  }
  return Array.from(groups, ([id, groupDefinitions]) => ({ id, definitions: groupDefinitions }));
}
