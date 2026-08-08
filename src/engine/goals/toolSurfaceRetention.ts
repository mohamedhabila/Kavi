// ---------------------------------------------------------------------------
// Kavi — Tool Surface Retention
// ---------------------------------------------------------------------------
// Classifies registered tools and decides which of them a turn keeps once the
// run has already used them. `toolSurface` composes these with the goal and
// discovery signals to build the surface itself.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { inferToolCapabilityDescriptor } from '../tools/capabilityRegistry';
import { descriptorIsPassiveAsyncObserver } from '../tools/toolLifecycleSemantics';
import type { AgentGoal } from './types';

export function isCodeExecutionTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return tool?.contract?.category === 'code';
}

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

export function collectCompletedGoalEvidenceToolNames(
  goals: ReadonlyArray<AgentGoal>,
  toolByName: ReadonlyMap<string, ToolDefinition>,
): string[] {
  const toolNames = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== 'completed') {
      continue;
    }
    for (const evidence of goal.evidence) {
      const separatorIndex = evidence.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const toolName = normalizeToolName(evidence.slice(0, separatorIndex));
      if (toolName && toolByName.has(toolName)) {
        toolNames.add(toolName);
      }
    }
  }
  return Array.from(toolNames);
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
  resourceScopedGoalCapabilityToolNames: ReadonlySet<string>;
  completedResourceScopedGoalCapabilityToolNames: ReadonlySet<string>;
  completedGoalEvidenceToolNames: ReadonlySet<string>;
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
    !params.resourceScopedGoalCapabilityToolNames.has(params.toolName) &&
    params.completedWorkflowToolNames.has(params.toolName)
  ) {
    return false;
  }

  if (
    isSideEffectfulTool(tool) &&
    !isMemoryResourceTool(tool) &&
    !params.resourceScopedGoalCapabilityToolNames.has(params.toolName)
  ) {
    if (params.allowUnownedSideEffectfulTool !== true) {
      return false;
    }
    // `allowCompletedTool` lifts every "it already did its job" exclusion, not only the
    // observation one. A goal completing on a tool's evidence says that goal is done, not
    // that the run is finished with the capability — and leaving one of these in place
    // rebuilds the same dead end through a different set.
    if (params.allowCompletedTool === true) {
      return true;
    }
    return (
      !params.completedResourceScopedGoalCapabilityToolNames.has(params.toolName) &&
      !params.completedGoalEvidenceToolNames.has(params.toolName) &&
      !params.completedWorkflowToolNames.has(params.toolName)
    );
  }
  return true;
}
