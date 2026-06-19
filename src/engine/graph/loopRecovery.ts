import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import { parseGoalMutationToolResultCodes } from '../goals/mutationErrors';
import type { LoopDetectionResult, ToolCallRecord } from '../loopDetection';
import type { AgentControlGraphEvent } from './agentControlGraph';
import type { AgentGoal } from '../../types/agentRun';
import { isBlockingGoal } from '../goals/types';
import { renderGoalFocusInline } from './goalFocusPrompt';
import { extractRecentToolRepairHints } from './toolRepairHints';

function normalizeToolNameKey(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function extractRecentGoalMutationValidationCodes(
  history: ReadonlyArray<ToolCallRecord>,
  limit: number = 3,
): string[] {
  const codes: string[] = [];

  for (let index = history.length - 1; index >= 0 && codes.length < limit; index -= 1) {
    const entry = history[index];
    if (normalizeToolNameKey(entry.name) !== GOAL_BOOTSTRAP_TOOL_NAME) {
      continue;
    }

    for (const code of parseGoalMutationToolResultCodes(entry.result)) {
      if (!codes.includes(code)) {
        codes.push(code);
      }
      if (codes.length >= limit) {
        break;
      }
    }
  }

  return codes;
}

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

function buildLoopRecoveryHint(
  loopType: LoopDetectionResult['type'],
  validationCodes: ReadonlyArray<string>,
  repairHints: ReadonlyArray<string>,
  goals: ReadonlyArray<AgentGoal>,
): string {
  const activeGoalFocus = renderGoalFocusInline(
    goals.filter((goal) => isBlockingGoal(goal) && goal.status === 'active'),
  );
  const goalFocusHint = activeGoalFocus ? ` Active task focus: ${activeGoalFocus}.` : '';

  if (loopType === 'repeated_error') {
    if (repairHints.length > 0) {
      return `Do not repeat the same failing tool arguments. Last tool repair hints: ${repairHints.join('; ')}.${goalFocusHint} The failed call did not complete its side effect. Follow repair.expectedShape and retry the failed tool with corrected top-level arguments, using values already present in the user request, graph goals, or prior tool outputs.`;
    }
    return `Do not repeat the same failing tool call.${goalFocusHint} Reuse the failure you already observed and take a different next step.`;
  }

  if (loopType === 'stagnant_progress') {
    return `Goal state did not advance.${goalFocusHint} Complete or update goals, or change tool selection before repeating the same tool pattern.`;
  }

  if (loopType === 'discovery_stall') {
    return `Discovery has not advanced execution.${goalFocusHint} Reuse the catalog or description results already visible, then choose a concrete non-discovery tool from the current surface. If the current surface still lacks the required capability, state the concrete missing capability on the next pass.`;
  }

  if (loopType === 'tool_filter_loop') {
    return 'Blocked tool calls repeated without progress. Do not retry filtered or unknown tools on this turn surface.';
  }

  if (loopType === 'bootstrap_stall') {
    return 'Goal bootstrap did not advance. Use a different tool from the active surface or fix update_goals arguments before retrying.';
  }

  if (loopType === 'goal_mutation_stall') {
    const validationHint =
      validationCodes.length > 0 ? `Last validation codes: ${validationCodes.join(', ')}.` : '';
    return [
      'Goal mutations did not advance.',
      'For new goals, call update_goals with {"action":"add","id":"stable-id","name":"visible name","completionPolicy":"blocking|persistent","status":"active|pending"}.',
      'For existing goals, call update_goals with {"action":"activate|complete|block|remove|update","id":"existing-id","name":"visible name"}.',
      validationHint,
      'Avoid completing goals without evidence, or switch to non-goal tools.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return 'Do not repeat the same tool call with the same input. Reuse the result you already have or take a different next step.';
}

export function buildAgentControlGraphLoopRecoveryDecision(params: {
  loopCheck: LoopDetectionResult;
  warningAlreadyInjected: boolean;
  iteration: number;
  maxIterations: number;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  goals?: ReadonlyArray<AgentGoal>;
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

  const validationCodes =
    params.loopCheck.type === 'goal_mutation_stall'
      ? extractRecentGoalMutationValidationCodes(params.toolCallHistory ?? [])
      : [];
  const repairHints =
    params.loopCheck.type === 'repeated_error'
      ? extractRecentToolRepairHints(params.toolCallHistory ?? [])
      : [];
  const warningPrefix = params.warningAlreadyInjected
    ? `[SYSTEM WARNING - REPEATED - Iteration ${params.iteration}/${params.maxIterations}]`
    : `[SYSTEM WARNING - Iteration ${params.iteration}/${params.maxIterations}]`;
  return {
    type: 'warning',
    warningMessage: `${warningPrefix} ${params.loopCheck.details ?? 'Loop detected.'}\n\n${buildLoopRecoveryHint(params.loopCheck.type, validationCodes, repairHints, params.goals ?? [])}`,
    shouldResetWarningState: false,
    nextWarningState: true,
  };
}
