import type { ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';

const MODEL_AUTHORITY_INDEPENDENT_COMPLETION_TOOLS = new Set(['wait']);

/**
 * These tools still require current model authority before dispatch. Their successful
 * completion is code-owned and reveals no memory or external data, so a long-running
 * invocation may settle after that model-turn authority expires.
 */
export function canSettleAfterModelAuthorityChange(
  normalizedToolName: string,
  outcome: ToolRuntimeOutcome,
): boolean {
  return (
    outcome.status === 'completed' &&
    MODEL_AUTHORITY_INDEPENDENT_COMPLETION_TOOLS.has(normalizedToolName)
  );
}
