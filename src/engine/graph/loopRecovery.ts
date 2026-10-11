import type { LoopDetectionResult, ToolCallRecord } from '../loopDetection';
import type { AgentControlGraphEvent } from './agentControlGraph';
import { extractRecentToolRepairHints } from './toolRepairHints';

export type AgentControlGraphLoopRecoveryDecision =
  | {
      type: 'none';
      shouldResetWarningState: boolean;
    }
  | {
      type: 'warning';
      warningMessage: string;
      shouldResetWarningState: false;
      nextWarningState: true;
    }
  | {
      type: 'block';
      graphEvent: Extract<AgentControlGraphEvent, { type: 'BLOCKED' }>;
      details: string;
    };

/** The tool the model repeated most in recent history, used to prohibit it by name. */
function resolveStalledToolName(
  history: ReadonlyArray<ToolCallRecord> | undefined,
): string | undefined {
  if (!history || history.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const record of history) {
    const name = record.name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let stalledName: string | undefined;
  let stalledCount = 0;
  for (const [name, count] of counts) {
    if (count > stalledCount) {
      stalledName = name;
      stalledCount = count;
    }
  }
  return stalledCount > 1 ? stalledName : undefined;
}

function buildLoopRecoveryHint(
  loopType: LoopDetectionResult['type'],
  repairHints: ReadonlyArray<string>,
  stalledToolName: string | undefined,
): string {
  if (loopType === 'repeated_error') {
    if (repairHints.length > 0) {
      return `Do not repeat the same failing tool arguments. Last tool repair hints: ${repairHints.join('; ')}. The failed call did not complete its side effect. Follow repair.expectedShape and retry the failed tool with corrected top-level arguments, using values already present in the user request or prior tool outputs.`;
    }
    return 'Do not repeat the same failing tool call. Reuse the failure you already observed and take a different next step.';
  }

  if (loopType === 'stagnant_progress') {
    // The stalled tool is prohibited by name: a generic "make progress" lets the model
    // answer with one more call to the same tool, which is the pattern this detects.
    const stalledToolHint = stalledToolName
      ? ` Do not call ${stalledToolName} again this turn.`
      : '';
    return `The last steps did not advance the work.${stalledToolHint} Take a different concrete step toward the deliverable, or answer with what you have.`;
  }

  if (loopType === 'discovery_stall') {
    return 'Discovery has not advanced execution. Reuse the catalog or description results already visible, then choose a concrete non-discovery tool from the current surface. If the current surface still lacks the required capability, state the concrete missing capability on the next pass.';
  }

  if (loopType === 'tool_filter_loop') {
    return 'Blocked tool calls repeated without progress. Do not retry filtered or unknown tools on this turn surface.';
  }

  return 'Do not repeat the same tool call with the same input. Reuse the result you already have or take a different next step.';
}

export function buildAgentControlGraphLoopRecoveryDecision(params: {
  loopCheck: LoopDetectionResult;
  warningAlreadyInjected: boolean;
  iteration: number;
  maxIterations: number;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): AgentControlGraphLoopRecoveryDecision {
  if (!params.loopCheck.loopDetected) {
    return {
      type: 'none',
      shouldResetWarningState: true,
    };
  }

  if (params.loopCheck.level === 'critical') {
    return {
      type: 'block',
      graphEvent: {
        type: 'BLOCKED',
        reason: 'loop_detected',
      },
      details: params.loopCheck.details ?? 'Critical tool loop detected.',
    };
  }

  const repairHints =
    params.loopCheck.type === 'repeated_error'
      ? extractRecentToolRepairHints(params.toolCallHistory ?? [])
      : [];
  const warningPrefix = params.warningAlreadyInjected
    ? `[SYSTEM WARNING - REPEATED - Iteration ${params.iteration}/${params.maxIterations}]`
    : `[SYSTEM WARNING - Iteration ${params.iteration}/${params.maxIterations}]`;
  return {
    type: 'warning',
    warningMessage: `${warningPrefix} ${params.loopCheck.details ?? 'Loop detected.'}\n\n${buildLoopRecoveryHint(
      params.loopCheck.type,
      repairHints,
      resolveStalledToolName(params.toolCallHistory),
    )}`,
    shouldResetWarningState: false,
    nextWarningState: true,
  };
}
