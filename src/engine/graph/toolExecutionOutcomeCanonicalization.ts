import { parseUpdatePlanArguments } from '../plan/agentPlan';
import { UPDATE_PLAN_TOOL_NAME } from '../tools/plan-definitions';
import { parseToolArgumentsJson } from '../toolExecution/toolArgumentJsonRecovery';
import type { AgentControlGraphEvent } from './agentControlGraph';
import type { TerminalToolExecutionOutcome } from './toolExecutionOutcomeResolution';

export type CanonicalToolExecutionOutcome = TerminalToolExecutionOutcome & {
  canonicalized: boolean;
  graphApplied: boolean;
};

function passThrough(outcome: TerminalToolExecutionOutcome): CanonicalToolExecutionOutcome {
  return { ...outcome, canonicalized: false, graphApplied: false };
}

/**
 * Applies a successful update_plan call to the graph, which owns run state. The executor
 * has already checked the call's shape and answered "Plan updated"; this records the plan
 * the model stated. Every other tool's outcome passes through unchanged.
 */
export function canonicalizeToolExecutionOutcome(params: {
  outcome: TerminalToolExecutionOutcome;
  toolName: string;
  executableToolCalls: ReadonlyArray<{ name: string; arguments: string }>;
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
}): CanonicalToolExecutionOutcome {
  if (params.toolName !== UPDATE_PLAN_TOOL_NAME || params.outcome.toolMessage.isError) {
    return passThrough(params.outcome);
  }
  const call = params.executableToolCalls[params.outcome.index];
  if (!call) return passThrough(params.outcome);

  let args: unknown;
  try {
    args = parseToolArgumentsJson(call.arguments || '{}');
  } catch {
    return passThrough(params.outcome);
  }
  const parsed = parseUpdatePlanArguments(args);
  if ('error' in parsed) return passThrough(params.outcome);

  params.applyGraphEvents([
    { type: 'PLAN_UPDATED', plan: parsed.arguments.plan, timestamp: Date.now() },
  ]);
  return { ...params.outcome, canonicalized: true, graphApplied: true };
}
