import type { AgentGoal } from '../../types/agentRun';
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

function buildNoToolProgressRetryPrompt(
  selectedToolNames: ReadonlySet<string> | undefined,
): string {
  const toolNames = Array.from(selectedToolNames ?? [])
    .filter(Boolean)
    .sort();
  const canRequestClarification = toolNames.includes('request_clarification');
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push(
    'The previous response was a first-pass candidate, but no code-owned progress was recorded. Code-owned progress is required only when the original request actually requires app, device, file, memory, or external-state work.',
  );
  if (toolNames.length > 0) {
    lines.push(`Available tools: ${toolNames.join(', ')}.`);
  }
  if (canRequestClarification) {
    lines.push(
      'If user-owned information is required before execution can continue, call request_clarification now; a prose-only question does not register the blocked request.',
    );
  }
  lines.push(
    'Re-evaluate the original request and available paths. Do not manufacture an external action, consent need, or required user detail merely because a compatible tool exists. Advice or information grounded entirely in visible context can be complete. If the prior candidate already provides that useful, proportionate response, preserve its substance and return it directly instead of replacing it with optional-action clarification. If the request does depend on app state, device state, files, memory, or another external effect, use the appropriate discovery or action tool now; do not ask the user for an internal identifier that a read-only tool can resolve. Otherwise report a concrete blocker only after the available paths have been exhausted.',
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

export function evaluateNoToolProgressRetry(params: {
  consecutiveNoToolTurns: number;
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  requiresAgenticProgressValidation?: boolean;
  candidateCompletionIsComplete?: boolean;
}): CompletionGateDecision | null {
  if (
    params.requiresAgenticProgressValidation !== true ||
    params.candidateCompletionIsComplete !== true ||
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    params.consecutiveNoToolTurns > 0 ||
    params.goals.length > 0 ||
    (params.toolCallHistory?.length ?? 0) > 0
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'no_tool_progress_retry',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'no_tool_progress_retry',
    },
    systemPrompts: [buildNoToolProgressRetryPrompt(params.selectedToolNames)],
    missingRequiredEvidenceLabels: [],
    nextConsecutivePendingAsyncNoToolTurns: params.consecutiveNoToolTurns + 1,
  };
}
