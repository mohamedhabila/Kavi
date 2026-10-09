import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import type { ToolCallRecord } from '../loopDetection';
import type { CompletionGateDecision } from './completionGateTypes';
import { extractRecentToolRepairHints } from './toolRepairHints';

function hasUnrepairedGraphMutationError(
  history: ReadonlyArray<ToolCallRecord> | undefined,
): boolean {
  for (let index = (history?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = history?.[index];
    if (entry?.name !== GOAL_BOOTSTRAP_TOOL_NAME) {
      continue;
    }

    return entry.status === 'failed';
  }

  return false;
}

function buildGraphMutationErrorHoldPrompt(repairHints: ReadonlyArray<string>): string {
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push('The latest graph mutation failed and did not apply its side effect.');
  if (repairHints.length > 0) {
    lines.push(`Recent tool repair hints: ${repairHints.join('; ')}.`);
  }
  lines.push(
    'Do not finalize. Retry update_goals with corrected top-level arguments or take the next valid tool step that repairs the graph state.',
  );
  return lines.join('\n');
}

function hasLatestRetryableToolError(history: ReadonlyArray<ToolCallRecord> | undefined): boolean {
  const latestEntry = history?.[history.length - 1];
  if (!latestEntry || latestEntry.name === GOAL_BOOTSTRAP_TOOL_NAME) {
    return false;
  }
  return latestEntry.status === 'failed' && extractRecentToolRepairHints([latestEntry]).length > 0;
}

function buildToolErrorRepairHoldPrompt(repairHints: ReadonlyArray<string>): string {
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push('The latest tool call failed with a retryable repair contract.');
  if (repairHints.length > 0) {
    lines.push(`Recent tool repair hints: ${repairHints.join('; ')}.`);
  }
  lines.push(
    'Do not finalize. Follow repair.retryArguments or repair.expectedShape using corrected top-level arguments and available tool results. If repair.tool is update_goals, commit that graph mutation first, then retry the original effect on the following iteration. Use discovery tools for any missing capability. If repair is impossible, report the concrete blocker on the next pass.',
  );
  return lines.join('\n');
}

export function evaluateGraphMutationErrorHold(params: {
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    !hasUnrepairedGraphMutationError(params.toolCallHistory)
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'graph_mutation_error',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'graph_mutation_error',
    },
    systemPrompts: [
      buildGraphMutationErrorHoldPrompt(extractRecentToolRepairHints(params.toolCallHistory)),
    ],
    missingRequiredEvidenceLabels: [],
  };
}

export function evaluateToolErrorRepairHold(params: {
  consecutiveNoToolTurns: number;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    params.consecutiveNoToolTurns > 0 ||
    !hasLatestRetryableToolError(params.toolCallHistory)
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'tool_error_repair',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'tool_error_repair',
    },
    systemPrompts: [
      buildToolErrorRepairHoldPrompt(extractRecentToolRepairHints(params.toolCallHistory)),
    ],
    missingRequiredEvidenceLabels: [],
    nextConsecutivePendingAsyncNoToolTurns: params.consecutiveNoToolTurns + 1,
  };
}
