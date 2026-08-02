import { GOAL_BOOTSTRAP_TOOL_NAME } from './goals/bootstrap';
import { areGoalSuccessCriteriaSatisfied } from './goals/completionEvidence';
import { isBlockingGoal, type AgentGoal } from './goals/types';
import type { ToolMessageOutcomeStatus } from './toolExecution/toolMessageOutcome';
import {
  buildRawToolArgsKey,
  buildRawToolResultKey,
  hashResult,
  hashToolCall,
  normalizeToolNameKey,
  simpleLoopDetectionHash,
} from './loopDetectionKeys';
import {
  countTrailingIdenticalInformationResults,
  isCompletedDistinctInformationProgressWindow,
  isDistinctInformationOnlyToolMultiset,
} from './loopDetectionSemanticProgress';
export { hashResult, hashToolCall } from './loopDetectionKeys';
export { buildIterationSemanticProgressFingerprint } from './loopDetectionSemanticProgress';
export type { IterationToolProgressRecord } from './loopDetectionSemanticProgress';

export interface ToolCallRecord {
  id?: string;
  name: string;
  arguments: string;
  modelTurnIteration?: number;
  timestamp: number;
  status: ToolMessageOutcomeStatus;
  result?: string;
  argsHash?: string;
  resultHash?: string;
  preflightBlockedKind?: PreflightBlockedKind;
}

export type LoopSeverity = 'warning' | 'critical';
export type PreflightBlockedKind =
  | 'authority_revoked'
  | 'schema_validation'
  | 'tool_filter'
  | 'unknown_tool';

export type LoopDetectorKind =
  | 'generic_repeat'
  | 'repeated_error'
  | 'discovery_stall'
  | 'stagnant_progress'
  | 'tool_filter_loop'
  | 'bootstrap_stall'
  | 'goal_mutation_stall';

export const GOAL_BOOTSTRAP_STALL_THRESHOLD = 3;
export const GOAL_MUTATION_STALL_THRESHOLD = 3;
export const GOAL_MUTATION_ERROR_WINDOW_SIZE = 8;

export type IterationProgressSignature = {
  toolMultisetKey: string;
  goalProgressFingerprint: string;
  activeGoalId: string | null;
  semanticProgressFingerprint?: string;
};

export const GOAL_FOCUS_THRASH_THRESHOLD = 4;

export const STAGNANT_PROGRESS_SIGNATURE_HISTORY_SIZE = 10;
export const STAGNANT_PROGRESS_THRESHOLD = 3;

export interface LoopDetectionResult {
  loopDetected: boolean;
  level?: LoopSeverity;
  type?: LoopDetectorKind;
  details?: string;
  count?: number;
}

export const TOOL_CALL_HISTORY_SIZE = 30;
export const WARNING_THRESHOLD = 3;
export const CRITICAL_THRESHOLD = 6;
export const ERROR_WARNING_THRESHOLD = 2;
export const PREFLIGHT_BLOCKED_LOOP_THRESHOLD = 3;
const DISCOVERY_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);
// A completed wait advances wall-clock work even when graph goal evidence is
// intentionally unchanged. Failed-repeat detection and the global iteration
// cap still protect against broken or unbounded wait loops.
const ELAPSED_PROGRESS_TOOL_NAMES = new Set(['wait', 'sessions_wait']);

function hasIncompleteBlockingGoal(goals: ReadonlyArray<AgentGoal> | undefined): boolean {
  return (goals ?? []).some(
    (goal) =>
      isBlockingGoal(goal) &&
      (goal.status === 'active' || goal.status === 'pending' || goal.status === 'blocked') &&
      !areGoalSuccessCriteriaSatisfied(goal),
  );
}

function resolveBlockingWorkLoopSeverity(
  goals: ReadonlyArray<AgentGoal> | undefined,
): LoopSeverity {
  if (goals === undefined || goals.length === 0) {
    return 'critical';
  }
  return hasIncompleteBlockingGoal(goals) ? 'critical' : 'warning';
}

function resolveGoalMutationStallSeverity(
  goals: ReadonlyArray<AgentGoal> | undefined,
): LoopSeverity {
  return resolveBlockingWorkLoopSeverity(goals);
}

function isDiscoveryOnlyToolMultiset(multisetKey: string | undefined): boolean {
  const toolNames = (multisetKey ?? '').split('|').filter(Boolean);
  return toolNames.length > 0 && toolNames.every((toolName) => DISCOVERY_TOOL_NAMES.has(toolName));
}

function countTrailingStagnantSignatures(
  signatures: ReadonlyArray<IterationProgressSignature>,
): number {
  const latest = signatures[signatures.length - 1];
  if (!latest?.toolMultisetKey) return 0;

  let count = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    const entry = signatures[index];
    if (
      entry?.toolMultisetKey !== latest.toolMultisetKey ||
      entry.goalProgressFingerprint !== latest.goalProgressFingerprint ||
      (entry.semanticProgressFingerprint ?? '') !== (latest.semanticProgressFingerprint ?? '')
    ) {
      break;
    }
    count += 1;
  }
  return count;
}

function isCompletedElapsedProgressWindow(params: {
  history: ReadonlyArray<ToolCallRecord>;
  multisetKey: string | undefined;
  count: number | undefined;
}): boolean {
  const toolNames = (params.multisetKey ?? '').split('|').filter(Boolean);
  if (
    toolNames.length === 0 ||
    !toolNames.every((toolName) => ELAPSED_PROGRESS_TOOL_NAMES.has(toolName))
  ) {
    return false;
  }

  const count = params.count ?? STAGNANT_PROGRESS_THRESHOLD;
  const recent = params.history.slice(-count);
  const isRecoverableAuthorityRefresh = (entry: ToolCallRecord) =>
    entry.status === 'failed' &&
    entry.preflightBlockedKind === 'authority_revoked' &&
    ELAPSED_PROGRESS_TOOL_NAMES.has(normalizeToolNameKey(entry.name));
  return (
    recent.length === count &&
    recent.some(isCompletedElapsedProgress) &&
    recent.every(
      (entry) => isCompletedElapsedProgress(entry) || isRecoverableAuthorityRefresh(entry),
    )
  );
}

function isCompletedElapsedProgress(entry: ToolCallRecord): boolean {
  return (
    entry.status === 'completed' &&
    ELAPSED_PROGRESS_TOOL_NAMES.has(normalizeToolNameKey(entry.name))
  );
}

export function detectGenericRepeat(
  history: ToolCallRecord[],
  threshold: number = WARNING_THRESHOLD,
): { detected: boolean; tool?: string; count?: number } {
  const counts = new Map<string, number>();
  for (const entry of history) {
    // Successful wait/monitor calls advance elapsed or external state even when their inputs are
    // identical. The global iteration budget bounds the run; failed repeats remain eligible for
    // the stricter error detector below.
    if (isCompletedElapsedProgress(entry)) {
      continue;
    }
    const key = buildRawToolArgsKey(entry);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count >= threshold) {
      return {
        detected: true,
        tool: normalizeToolNameKey(entry.name),
        count,
      };
    }
  }
  return { detected: false };
}

export function detectRepeatedErrors(
  history: ToolCallRecord[],
  minRepeats: number = ERROR_WARNING_THRESHOLD,
): { detected: boolean; tool?: string; count?: number } {
  if (history.length < minRepeats) {
    return { detected: false };
  }

  const counts = new Map<string, number>();
  for (const entry of history) {
    if (entry.status !== 'failed') {
      continue;
    }

    const resultKey = buildRawToolResultKey(entry);
    if (!resultKey) {
      continue;
    }

    const key = `${buildRawToolArgsKey(entry)}::${resultKey}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count >= minRepeats) {
      return {
        detected: true,
        tool: normalizeToolNameKey(entry.name),
        count,
      };
    }
  }

  return { detected: false };
}

export function buildToolMultisetKey(toolNames: ReadonlyArray<string>): string {
  return Array.from(new Set(toolNames.map((name) => normalizeToolNameKey(name)).filter(Boolean)))
    .sort()
    .join('|');
}

export function buildGoalProgressFingerprint(
  goals: ReadonlyArray<Pick<AgentGoal, 'id' | 'status' | 'evidence' | 'userConstraints'>>,
): string {
  if (goals.length === 0) {
    return '';
  }

  const goalIdsFingerprint = goals
    .map((goal) => goal.id)
    .sort()
    .join(',');
  const goalStateFingerprint = goals
    .map(
      (goal) =>
        `${goal.id}:${goal.status}:${goal.evidence.length}:${simpleLoopDetectionHash(goal.evidence.join('\n'))}:constraints:${goal.userConstraints?.length ?? 0}`,
    )
    .sort()
    .join(';');

  return `${goalIdsFingerprint}|${goalStateFingerprint}`;
}

export function recordIterationProgressSignature(
  signatures: IterationProgressSignature[],
  entry: IterationProgressSignature,
): void {
  signatures.push(entry);
  if (signatures.length > STAGNANT_PROGRESS_SIGNATURE_HISTORY_SIZE) {
    signatures.splice(0, signatures.length - STAGNANT_PROGRESS_SIGNATURE_HISTORY_SIZE);
  }
}

export function detectStagnantProgress(
  signatures: ReadonlyArray<IterationProgressSignature>,
  threshold: number = STAGNANT_PROGRESS_THRESHOLD,
): { detected: boolean; count?: number; multisetKey?: string } {
  if (signatures.length < threshold) {
    return { detected: false };
  }

  const window = signatures.slice(-threshold);
  const first = window[0];
  if (!first.toolMultisetKey) {
    return { detected: false };
  }

  const repeatedMultiset = window.every((entry) => entry.toolMultisetKey === first.toolMultisetKey);
  const unchangedProgress = window.every(
    (entry) =>
      entry.goalProgressFingerprint === first.goalProgressFingerprint &&
      (entry.semanticProgressFingerprint ?? '') === (first.semanticProgressFingerprint ?? ''),
  );

  if (repeatedMultiset && unchangedProgress) {
    return {
      detected: true,
      count: threshold,
      multisetKey: first.toolMultisetKey,
    };
  }

  return { detected: false };
}

export function detectConsecutiveBlockedPreflightCalls(
  history: ToolCallRecord[],
  threshold: number = PREFLIGHT_BLOCKED_LOOP_THRESHOLD,
): { detected: boolean; kind?: PreflightBlockedKind; count?: number } {
  if (history.length < threshold) {
    return { detected: false };
  }

  const trailingTurns: Array<{
    key: string;
    entries: ToolCallRecord[];
  }> = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!;
    const turnKey =
      entry.modelTurnIteration === undefined
        ? `legacy-record:${index}`
        : `model-turn:${entry.modelTurnIteration}`;
    const currentTurn = trailingTurns.at(-1);
    if (currentTurn?.key === turnKey) {
      currentTurn.entries.push(entry);
    } else {
      trailingTurns.push({ key: turnKey, entries: [entry] });
    }
  }

  if (trailingTurns.length < threshold) {
    return { detected: false };
  }

  const window = trailingTurns.slice(0, threshold);
  const firstKind = window[0]?.entries[0]?.preflightBlockedKind;
  if (!firstKind) {
    return { detected: false };
  }

  let repeatedCallKeys = new Set(window[0]!.entries.map(buildRawToolArgsKey));
  for (const turn of window) {
    if (!turn.entries.every((entry) => entry.preflightBlockedKind === firstKind)) {
      return { detected: false };
    }
    const turnCallKeys = new Set(turn.entries.map(buildRawToolArgsKey));
    repeatedCallKeys = new Set(
      [...repeatedCallKeys].filter((callKey) => turnCallKeys.has(callKey)),
    );
    if (repeatedCallKeys.size === 0) {
      return { detected: false };
    }
  }

  return {
    detected: true,
    kind: firstKind,
    count: threshold,
  };
}

export function detectGoalFocusThrash(
  signatures: ReadonlyArray<IterationProgressSignature>,
  threshold: number = GOAL_FOCUS_THRASH_THRESHOLD,
): { detected: boolean; count?: number } {
  if (signatures.length < threshold) {
    return { detected: false };
  }

  const goalMutationMultiset = buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]);
  const window = signatures.slice(-threshold);
  const first = window[0];
  if (!first || first.toolMultisetKey !== goalMutationMultiset) {
    return { detected: false };
  }

  const onlyGoalMutation = window.every((entry) => entry.toolMultisetKey === goalMutationMultiset);
  if (!onlyGoalMutation) {
    return { detected: false };
  }

  const activeIds = window.map((entry) => entry.activeGoalId ?? '');
  if (activeIds.some((id) => !id)) {
    return { detected: false };
  }

  if (new Set(activeIds).size < 2) {
    return { detected: false };
  }

  let transitions = 0;
  for (let index = 1; index < activeIds.length; index += 1) {
    if (activeIds[index] !== activeIds[index - 1]) {
      transitions += 1;
    }
  }

  if (transitions < threshold - 1) {
    return { detected: false };
  }

  return { detected: true, count: threshold };
}

export function detectGoalMutationStall(
  signatures: ReadonlyArray<IterationProgressSignature>,
  threshold: number = GOAL_MUTATION_STALL_THRESHOLD,
): { detected: boolean; count?: number } {
  if (signatures.length < threshold) {
    return { detected: false };
  }

  const goalMutationMultiset = buildToolMultisetKey([GOAL_BOOTSTRAP_TOOL_NAME]);
  const window = signatures.slice(-threshold);
  const first = window[0];
  if (!first || first.toolMultisetKey !== goalMutationMultiset) {
    return { detected: false };
  }

  const onlyGoalMutation = window.every((entry) => entry.toolMultisetKey === goalMutationMultiset);
  const unchangedProgress = window.every(
    (entry) => entry.goalProgressFingerprint === first.goalProgressFingerprint,
  );
  if (onlyGoalMutation && unchangedProgress) {
    return { detected: true, count: threshold };
  }

  return { detected: false };
}

export function detectGoalMutationErrorLoop(
  history: ToolCallRecord[],
  threshold: number = GOAL_MUTATION_STALL_THRESHOLD,
): { detected: boolean; count?: number } {
  if (history.length < threshold) {
    return { detected: false };
  }

  const window = history.slice(-threshold);
  const bootstrapTool = normalizeToolNameKey(GOAL_BOOTSTRAP_TOOL_NAME);
  const allGoalMutation = window.every(
    (entry) => normalizeToolNameKey(entry.name) === bootstrapTool,
  );
  if (!allGoalMutation) {
    const recentWindow = history.slice(-Math.max(threshold, GOAL_MUTATION_ERROR_WINDOW_SIZE));
    const recentGoalMutationCalls = recentWindow
      .filter((entry) => normalizeToolNameKey(entry.name) === bootstrapTool)
      .slice(-threshold);
    if (
      recentGoalMutationCalls.length >= threshold &&
      recentGoalMutationCalls.every((entry) => entry.status === 'failed')
    ) {
      return { detected: true, count: recentGoalMutationCalls.length };
    }

    return { detected: false };
  }

  const allErrors = window.every((entry) => entry.status === 'failed');
  if (allErrors) {
    return { detected: true, count: threshold };
  }

  return { detected: false };
}

export function detectGoalBootstrapStall(params: {
  goals: ReadonlyArray<AgentGoal>;
  history: ToolCallRecord[];
  threshold?: number;
}): { detected: boolean; count?: number } {
  if (params.goals.length > 0) {
    return { detected: false };
  }

  const threshold = params.threshold ?? GOAL_BOOTSTRAP_STALL_THRESHOLD;
  if (params.history.length < threshold) {
    return { detected: false };
  }

  const window = params.history.slice(-threshold);
  const bootstrapTool = normalizeToolNameKey(GOAL_BOOTSTRAP_TOOL_NAME);
  const allGoalMutation = window.every(
    (entry) => normalizeToolNameKey(entry.name) === bootstrapTool,
  );
  if (!allGoalMutation) {
    return { detected: false };
  }

  const allErrors = window.every((entry) => entry.status === 'failed');
  const firstKey = buildRawToolArgsKey(window[0]!);
  const allIdentical = window.every((entry) => buildRawToolArgsKey(entry) === firstKey);
  if (allErrors || allIdentical) {
    return { detected: true, count: threshold };
  }

  return { detected: false };
}

export function detectLoops(
  history: ToolCallRecord[],
  stagnationSignatures: ReadonlyArray<IterationProgressSignature> = [],
  options?: { goals?: ReadonlyArray<AgentGoal> },
): LoopDetectionResult {
  if (options?.goals !== undefined && options.goals.length === 0) {
    const bootstrapStall = detectGoalBootstrapStall({
      goals: options.goals,
      history,
    });
    if (bootstrapStall.detected) {
      return {
        loopDetected: true,
        level: 'critical',
        type: 'bootstrap_stall',
        count: bootstrapStall.count,
        details:
          `CRITICAL: ${bootstrapStall.count} consecutive ${GOAL_BOOTSTRAP_TOOL_NAME} ` +
          'calls without bootstrapping goals.',
      };
    }
  }

  if (history.length > 0) {
    const blockedPreflight = detectConsecutiveBlockedPreflightCalls(history);
    if (blockedPreflight.detected) {
      const level = resolveBlockingWorkLoopSeverity(options?.goals);
      return {
        loopDetected: true,
        level,
        type: 'tool_filter_loop',
        count: blockedPreflight.count,
        details:
          `${level.toUpperCase()}: ${blockedPreflight.count} consecutive model turns repeated ` +
          `the same ${blockedPreflight.kind} preflight-blocked tool call without graph progress.`,
      };
    }
    const goalMutationErrorLoop = detectGoalMutationErrorLoop(history);
    if (goalMutationErrorLoop.detected) {
      const level = resolveGoalMutationStallSeverity(options?.goals);
      return {
        loopDetected: true,
        level,
        type: 'goal_mutation_stall',
        count: goalMutationErrorLoop.count,
        details:
          `${level.toUpperCase()}: ${goalMutationErrorLoop.count} recent ${GOAL_BOOTSTRAP_TOOL_NAME} ` +
          'calls failed without graph progress.',
      };
    }
    const repeatCritical = detectGenericRepeat(history, CRITICAL_THRESHOLD);
    if (repeatCritical.detected) {
      return {
        loopDetected: true,
        level: 'critical',
        type: 'generic_repeat',
        count: repeatCritical.count,
        details: `CRITICAL: ${repeatCritical.tool} repeated ${repeatCritical.count} times with identical input.`,
      };
    }

    const repeatedErrorWarning = detectRepeatedErrors(history, ERROR_WARNING_THRESHOLD);
    if (repeatedErrorWarning.detected) {
      return {
        loopDetected: true,
        level: 'warning',
        type: 'repeated_error',
        count: repeatedErrorWarning.count,
        details: `WARNING: ${repeatedErrorWarning.tool} failed ${repeatedErrorWarning.count} times with the same input and error.`,
      };
    }

    const repeatWarning = detectGenericRepeat(history, WARNING_THRESHOLD);
    if (repeatWarning.detected) {
      return {
        loopDetected: true,
        level: 'warning',
        type: 'generic_repeat',
        count: repeatWarning.count,
        details: `WARNING: ${repeatWarning.tool} repeated ${repeatWarning.count} times with identical input.`,
      };
    }
  }

  const goalFocusThrash = detectGoalFocusThrash(stagnationSignatures);
  if (goalFocusThrash.detected) {
    const level = resolveGoalMutationStallSeverity(options?.goals);
    return {
      loopDetected: true,
      level,
      type: 'goal_mutation_stall',
      count: goalFocusThrash.count,
      details:
        `${level.toUpperCase()}: ${goalFocusThrash.count} consecutive ${GOAL_BOOTSTRAP_TOOL_NAME} ` +
        'iterations alternated active goal focus without net progress.',
    };
  }

  const goalMutationStall = detectGoalMutationStall(stagnationSignatures);
  if (goalMutationStall.detected) {
    const level = resolveGoalMutationStallSeverity(options?.goals);
    return {
      loopDetected: true,
      level,
      type: 'goal_mutation_stall',
      count: goalMutationStall.count,
      details:
        `${level.toUpperCase()}: ${goalMutationStall.count} consecutive ${GOAL_BOOTSTRAP_TOOL_NAME} ` +
        'iterations without goal progress.',
    };
  }

  const stagnantProgress = detectStagnantProgress(stagnationSignatures);
  if (stagnantProgress.detected) {
    const distinctInformationOnly = isDistinctInformationOnlyToolMultiset(
      stagnantProgress.multisetKey,
    );
    const trailingInformationStagnationCount = distinctInformationOnly
      ? countTrailingIdenticalInformationResults({
          history,
          multisetKey: stagnantProgress.multisetKey,
        })
      : undefined;
    if (
      isCompletedElapsedProgressWindow({
        history,
        multisetKey: stagnantProgress.multisetKey,
        count: stagnantProgress.count,
      }) ||
      isCompletedDistinctInformationProgressWindow(
        {
          history,
          multisetKey: stagnantProgress.multisetKey,
          count: stagnantProgress.count,
        },
        STAGNANT_PROGRESS_THRESHOLD,
      ) ||
      (trailingInformationStagnationCount !== undefined &&
        trailingInformationStagnationCount < STAGNANT_PROGRESS_THRESHOLD)
    ) {
      return { loopDetected: false };
    }
    const discoveryOnly = isDiscoveryOnlyToolMultiset(stagnantProgress.multisetKey);
    const trailingStagnantCount = countTrailingStagnantSignatures(stagnationSignatures);
    const reportedStagnantCount = trailingInformationStagnationCount ?? trailingStagnantCount;
    const level: LoopSeverity =
      discoveryOnly || (distinctInformationOnly && reportedStagnantCount < CRITICAL_THRESHOLD)
        ? 'warning'
        : resolveBlockingWorkLoopSeverity(options?.goals);
    return {
      loopDetected: true,
      level,
      type: discoveryOnly ? 'discovery_stall' : 'stagnant_progress',
      count: distinctInformationOnly ? reportedStagnantCount : stagnantProgress.count,
      details:
        `${level.toUpperCase()}: tool multiset ${stagnantProgress.multisetKey} repeated ` +
        `${distinctInformationOnly ? reportedStagnantCount : stagnantProgress.count} iterations without semantic progress.`,
    };
  }

  return { loopDetected: false };
}

export function recordToolCall(history: ToolCallRecord[], entry: ToolCallRecord): void {
  history.push({
    ...entry,
    argsHash: entry.argsHash ?? hashToolCall(entry.name, entry.arguments),
    resultHash: entry.resultHash ?? hashResult(entry.result),
  });
  if (history.length > TOOL_CALL_HISTORY_SIZE) {
    history.splice(0, history.length - TOOL_CALL_HISTORY_SIZE);
  }
}
