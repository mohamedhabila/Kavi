// ---------------------------------------------------------------------------
// Kavi — Tool Surface Retention
// ---------------------------------------------------------------------------
// Classifies registered tools and decides which of them a turn keeps once the
// run has already used them. `toolSurface` composes these with the discovery
// signals to build the surface itself.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { inferToolCapabilityDescriptor } from './capabilityRegistry';
import { descriptorIsPassiveAsyncObserver } from './toolLifecycleSemantics';

export function isSideEffectfulTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  const sideEffects = tool?.contract?.sideEffects ?? [];
  return sideEffects.some((sideEffect) => sideEffect !== 'none');
}

export function isMemoryResourceTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return (tool?.contract?.resourceKinds ?? []).includes('memory');
}

/**
 * Capabilities whose whole point is being invoked more than once.
 *
 * Computing a second scenario, reading a second file and searching a second term are the
 * normal shape of the work, not an accidental replay of a completed one. A tool declaring
 * any of these stays available after it succeeds; a pure mutator does not.
 */
const REPEATABLE_TOOL_CAPABILITIES: ReadonlySet<string> = new Set([
  'compute',
  'read',
  'discover',
  'monitor',
  'verify',
  'wait',
]);

/**
 * Whether an activated tool may be called again after it has already succeeded.
 *
 * Runtime integrations are registered dynamically and frequently arrive with no contract
 * at all, so there is nothing to classify them by. Withholding the grant from them would
 * strand exactly the tools a run had to go and discover, so an `mcp__`/`skill__` name
 * qualifies on its own — as it did before contracts were consulted here.
 */
export function isRepeatableActivatedTool(
  toolName: string,
  tool: Pick<ToolDefinition, 'contract'> | undefined,
): boolean {
  if (toolName.startsWith('mcp__') || toolName.startsWith('skill__')) {
    return true;
  }
  return (tool?.contract?.capabilities ?? []).some((capability) =>
    REPEATABLE_TOOL_CAPABILITIES.has(capability.trim()),
  );
}

/**
 * Whether a tool the run merely *observed* should stay on the next turn's surface.
 *
 * This governs incidental continuation only. An explicit `tool_catalog` activation is a
 * durable grant and does not pass through here — see `resolveTurnToolSurface`.
 */
export function shouldAcceptContinuationTool(params: {
  toolName: string;
  toolByName: ReadonlyMap<string, ToolDefinition>;
  completedWorkflowToolNames: ReadonlySet<string>;
  allowUnownedSideEffectfulTool?: boolean;
  allowCompletedTool?: boolean;
}): boolean {
  const tool = params.toolByName.get(params.toolName);
  // Completed producers normally leave the hot surface so the model cannot
  // accidentally replay a mutation. Passive async observers are different:
  // long-running work legitimately needs consecutive wait/monitor calls, and
  // each successful observation advances wall-clock or external state.
  const isRepeatablePassiveObserver =
    tool !== undefined && descriptorIsPassiveAsyncObserver(inferToolCapabilityDescriptor(tool));
  if (
    params.allowCompletedTool !== true &&
    !isRepeatablePassiveObserver &&
    !isMemoryResourceTool(tool) &&
    params.completedWorkflowToolNames.has(params.toolName)
  ) {
    return false;
  }

  if (isSideEffectfulTool(tool) && !isMemoryResourceTool(tool)) {
    if (params.allowUnownedSideEffectfulTool !== true) {
      return false;
    }
    // `allowCompletedTool` lifts every "it already did its job" exclusion, not only the
    // observation one.
    return (
      params.allowCompletedTool === true || !params.completedWorkflowToolNames.has(params.toolName)
    );
  }
  return true;
}
