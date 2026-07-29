import { mcpManager } from '../../services/mcp/manager';
import { getSkillToolDefinitions } from '../../services/skills/manager';
import { isLongTermMemoryEnabled } from '../../services/memory/policy';
import type { ToolDefinition } from '../../types/tool';
import { TOOL_DEFINITIONS } from './definitions';
import { filterToolsForMemoryPolicy } from './memoryPolicyToolAuthority';

function currentCatalogDefinitions(): ToolDefinition[] {
  const mcpDefinitions =
    typeof mcpManager.getAllToolDefinitions === 'function'
      ? mcpManager.getAllToolDefinitions()
      : [];
  const definitions = new Map<string, ToolDefinition>();
  for (const tool of [...TOOL_DEFINITIONS, ...mcpDefinitions, ...getSkillToolDefinitions()]) {
    definitions.set(tool.name, tool);
  }
  return Array.from(definitions.values());
}

export function resolveMemoryPolicyVisibleToolNames(
  requestedNames?: ReadonlySet<string>,
): ReadonlySet<string> | undefined {
  if (isLongTermMemoryEnabled()) return requestedNames;
  const policyVisibleNames = new Set(
    filterToolsForMemoryPolicy(currentCatalogDefinitions()).map((tool) => tool.name),
  );
  if (!requestedNames) return policyVisibleNames;
  return new Set(Array.from(requestedNames).filter((name) => policyVisibleNames.has(name)));
}
