import type { MemoryFact } from './facts/types';

const INTERNAL_AGENT_CONTROL_TOOL_NAMES = new Set([
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
  'memory_manage',
  'request_clarification',
  'tool_catalog',
  'tool_describe',
  'update_goals',
]);

export function isInternalAgentControlToolName(value: unknown): value is string {
  return typeof value === 'string' && INTERNAL_AGENT_CONTROL_TOOL_NAMES.has(value);
}

/**
 * Internal control-plane results describe how the assistant managed its own
 * execution. They are not observations about the user's world and must never
 * be reused as experience evidence.
 */
export function isReusableAgentRunExperienceFact(
  fact: Pick<MemoryFact, 'attributes' | 'memoryKind'>,
): boolean {
  if (fact.memoryKind === 'evidence_span' || fact.memoryKind === 'tool_result') {
    return !isInternalAgentControlToolName(fact.attributes.toolName);
  }
  if (fact.memoryKind !== 'agent_run') return true;

  const tools = fact.attributes.tools;
  if (!Array.isArray(tools) || tools.length === 0) return true;
  return tools.some((toolName) => !isInternalAgentControlToolName(toolName));
}
