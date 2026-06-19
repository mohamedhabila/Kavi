import type { AgentGoal } from '../../types/agentRun';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import type { ToolCallRecord } from '../loopDetection';
import type { CompletionGateDecision } from './completionGateTypes';
import { extractRecentToolRepairHints } from './toolRepairHints';

const MIN_NO_TOOL_PROGRESS_RETRY_CHARS = 160;
const DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);

function hasUnrepairedGraphMutationError(
  history: ReadonlyArray<ToolCallRecord> | undefined,
): boolean {
  for (let index = (history?.length ?? 0) - 1; index >= 0; index -= 1) {
    const entry = history?.[index];
    if (entry?.name !== GOAL_BOOTSTRAP_TOOL_NAME) {
      continue;
    }

    return isToolResultErrorLike(entry.result);
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

function hasLatestRetryableToolError(
  history: ReadonlyArray<ToolCallRecord> | undefined,
): boolean {
  const latestEntry = history?.[history.length - 1];
  if (!latestEntry || latestEntry.name === GOAL_BOOTSTRAP_TOOL_NAME) {
    return false;
  }
  return (
    isToolResultErrorLike(latestEntry.result) &&
    extractRecentToolRepairHints([latestEntry]).length > 0
  );
}

function buildToolErrorRepairHoldPrompt(repairHints: ReadonlyArray<string>): string {
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push('The latest tool call failed with a retryable repair contract.');
  if (repairHints.length > 0) {
    lines.push(`Recent tool repair hints: ${repairHints.join('; ')}.`);
  }
  lines.push(
    'Do not finalize. Repair the failed step using corrected top-level arguments, available tool results, or discovery tools for any missing capability. If repair is impossible, report the concrete blocker on the next pass.',
  );
  return lines.join('\n');
}

function buildWorkflowContinuationHoldPrompt(
  pendingToolNames: ReadonlyArray<string>,
): string {
  const toolNames = pendingToolNames.filter(Boolean).sort();
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push(
    'Recent tool results produced resources consumed by available downstream workflow tools.',
  );
  if (toolNames.length > 0) {
    lines.push(`Available downstream tools: ${toolNames.join(', ')}.`);
  }
  lines.push(
    'Do not finalize yet. If the user request requires a downstream side effect or verification step, use the appropriate downstream tool now. If no downstream step is required, answer directly on the next pass.',
  );
  return lines.join('\n');
}

function hasMultipleSuccessfulWorkToolResults(
  history: ReadonlyArray<ToolCallRecord> | undefined,
): boolean {
  const successfulWorkToolResultCount = (history ?? []).filter(
    (entry) =>
      entry.name !== GOAL_BOOTSTRAP_TOOL_NAME &&
      !DISCOVERY_TOOL_NAMES.has(entry.name) &&
      typeof entry.result === 'string' &&
      entry.result.trim().length > 0 &&
      !isToolResultErrorLike(entry.result),
  ).length;

  return successfulWorkToolResultCount >= 2;
}

function buildNoToolProgressRetryPrompt(selectedToolNames: ReadonlySet<string> | undefined): string {
  const toolNames = Array.from(selectedToolNames ?? []).filter(Boolean).sort();
  const lines: string[] = ['[SYSTEM HOLD]'];
  lines.push('The previous response made no tool progress while discovery tools were available.');
  if (toolNames.length > 0) {
    lines.push(`Available tools: ${toolNames.join(', ')}.`);
  }
  lines.push(
    'If the request depends on app state, device state, files, memory, or another external side effect, use the appropriate discovery or action tool now. If no tool is needed, answer directly on the next pass.',
  );
  return lines.join('\n');
}

function buildGraphStateReconciliationPrompt(): string {
  return [
    '[SYSTEM HOLD]',
    'The previous turn produced successful external tool evidence, but the control graph has no recorded goal state.',
    'Review the observed tool results and reconcile the graph before finalizing.',
    'If the user asked to track, verify, complete, or satisfy criteria for work, call update_goals with the appropriate goal state and evidence.',
    'If no graph-tracked goal is needed, answer directly on the next pass.',
  ].join('\n');
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

export function evaluateWorkflowContinuationHold(params: {
  consecutiveNoToolTurns: number;
  pendingWorkflowContinuationToolNames?: ReadonlyArray<string>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  forceTextThisTurn: boolean;
}): CompletionGateDecision | null {
  const pendingToolNames = Array.from(
    new Set((params.pendingWorkflowContinuationToolNames ?? []).filter(Boolean)),
  );
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    params.consecutiveNoToolTurns > 1 ||
    pendingToolNames.length === 0
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'workflow_continuation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'workflow_continuation',
    },
    systemPrompts: [buildWorkflowContinuationHoldPrompt(pendingToolNames)],
    missingRequiredEvidenceLabels: [],
    nextConsecutivePendingAsyncNoToolTurns: params.consecutiveNoToolTurns + 1,
  };
}

export function evaluateNoToolProgressRetry(params: {
  consecutiveNoToolTurns: number;
  fullContent: string;
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  const hasDiscoveryTool = Array.from(params.selectedToolNames ?? []).some((toolName) =>
    DISCOVERY_TOOL_NAMES.has(toolName),
  );
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    !hasDiscoveryTool ||
    params.forceTextThisTurn ||
    params.fullContent.trim().length < MIN_NO_TOOL_PROGRESS_RETRY_CHARS ||
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

export function evaluateGraphStateReconciliationHold(params: {
  consecutiveNoToolTurns: number;
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    params.consecutiveNoToolTurns > 0 ||
    params.goals.length > 0 ||
    !params.selectedToolNames?.has(GOAL_BOOTSTRAP_TOOL_NAME) ||
    !hasMultipleSuccessfulWorkToolResults(params.toolCallHistory)
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'graph_state_reconciliation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'graph_state_reconciliation',
    },
    systemPrompts: [buildGraphStateReconciliationPrompt()],
    missingRequiredEvidenceLabels: [],
    nextConsecutivePendingAsyncNoToolTurns: params.consecutiveNoToolTurns + 1,
  };
}
