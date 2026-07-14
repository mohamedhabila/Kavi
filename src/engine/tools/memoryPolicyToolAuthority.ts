import { isLongTermMemoryEnabled } from '../../services/memory/policy';
import type { ToolDefinition } from '../../types/tool';

const MEMORY_CONTRACT_CATEGORIES = new Set(['memory', 'memory_search']);

function isLongTermMemoryTool(tool: ToolDefinition): boolean {
  const contract = tool.contract;
  return (
    contract?.resourceKinds?.includes('memory') === true ||
    (typeof contract?.category === 'string' &&
      MEMORY_CONTRACT_CATEGORIES.has(contract.category))
  );
}

function isExplicitMemoryErasureTool(tool: ToolDefinition): boolean {
  const contract = tool.contract;
  return (
    isLongTermMemoryTool(tool) &&
    contract?.capabilities?.includes('delete') === true &&
    contract?.sideEffects?.includes('destructive') === true &&
    contract.riskHints?.includes('requires_approval') === true
  );
}

export function isToolAllowedForMemoryPolicy(
  tool: ToolDefinition,
  longTermMemoryEnabled = isLongTermMemoryEnabled(),
): boolean {
  return (
    longTermMemoryEnabled ||
    !isLongTermMemoryTool(tool) ||
    isExplicitMemoryErasureTool(tool)
  );
}

export function buildMemoryDisabledToolResult(): string {
  return JSON.stringify({
    status: 'rejected',
    ok: false,
    code: 'memory_disabled',
    error: 'Long-term memory is disabled in settings.',
  });
}

/**
 * Applies the current privacy policy before any tool can become catalog-visible
 * or provider-callable. Explicit, approval-gated erasure remains available so
 * disabling memory never prevents the user from deleting previously stored data.
 */
export function filterToolsForMemoryPolicy(
  tools: ReadonlyArray<ToolDefinition>,
  longTermMemoryEnabled = isLongTermMemoryEnabled(),
): ToolDefinition[] {
  return tools.filter((tool) => isToolAllowedForMemoryPolicy(tool, longTermMemoryEnabled));
}
