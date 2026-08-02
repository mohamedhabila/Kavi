import type { ToolCallRecord } from '../loopDetection';
import { MAX_TOOL_ITERATIONS_OVERRIDE } from '../orchestrator/constants';

const RECENT_PROGRESS_WINDOW_SIZE = 12;
const MIN_RECENT_COMPLETED_TOOL_CALLS = 2;

function hasRecentCompletedToolProgress(toolCallHistory: ReadonlyArray<ToolCallRecord>): boolean {
  const recentOutcomes = toolCallHistory.slice(-RECENT_PROGRESS_WINDOW_SIZE);
  const completedCount = recentOutcomes.filter((entry) => entry.status === 'completed').length;
  const failedCount = recentOutcomes.length - completedCount;

  return completedCount >= MIN_RECENT_COMPLETED_TOOL_CALLS && completedCount >= failedCount;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Default assistant runs may earn another bounded work window when code-owned
 * tool outcomes show useful forward progress. This deliberately does not rely
 * on model-authored goal state: a goal can be absent, scoped too narrowly, or
 * completed before the overall response is ready. Explicit caller budgets
 * never opt in, and the hard ceiling remains a final backstop in addition to
 * the normal loop detectors.
 */
export function resolveNextLongHorizonIterationLimit(params: {
  enabled: boolean;
  currentLimit: number;
  extensionSize: number;
  toolCallHistory: ReadonlyArray<ToolCallRecord>;
  hardLimit?: number;
}): number | null {
  if (!params.enabled) return null;

  const currentLimit = normalizePositiveInteger(params.currentLimit, 1);
  const extensionSize = normalizePositiveInteger(params.extensionSize, 1);
  const hardLimit = Math.max(
    1,
    Math.min(
      Number.isFinite(params.hardLimit)
        ? Math.floor(Number(params.hardLimit))
        : MAX_TOOL_ITERATIONS_OVERRIDE,
      MAX_TOOL_ITERATIONS_OVERRIDE,
    ),
  );

  if (currentLimit >= hardLimit) return null;
  if (!hasRecentCompletedToolProgress(params.toolCallHistory)) return null;

  return Math.min(currentLimit + extensionSize, hardLimit);
}
