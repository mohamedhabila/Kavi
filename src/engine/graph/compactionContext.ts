// ---------------------------------------------------------------------------
// Kavi — Compaction Context
// ---------------------------------------------------------------------------
// Code-owned pending-work state handed to the context engine so a compaction
// summary carries the task forward instead of only describing what already
// happened. Everything here is derived from graph state and tracked async
// operations; nothing is parsed out of rendered prompt text or model output beyond the
// plan the model stated through update_plan.
// ---------------------------------------------------------------------------

import type { AgentPlanStep } from '../../types/agentRun';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import { getPendingTrackedAsyncOperations } from '../pendingAsyncOperations';
import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';

export const MAX_COMPACTION_OPEN_THREADS = 8;
const MAX_OPEN_THREAD_CHARS = 160;

function truncate(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return truncateGraphemesWithSuffix(normalized, MAX_OPEN_THREAD_CHARS, '…');
}

function planStepOpenThread(entry: AgentPlanStep): string | null {
  const step = truncate(entry.step);
  return step ? `[${entry.status}] ${step}` : null;
}

function asyncOperationOpenThread(operation: TrackedAsyncOperation): string | null {
  const kind = (operation.kind ?? '').trim();
  const resourceId = (operation.resourceId ?? '').trim();
  if (!kind && !resourceId) return null;
  const waitTool = operation.waitToolName ? ` — resume with ${operation.waitToolName}` : '';
  return `[awaiting ${operation.status}] ${kind || 'operation'} ${resourceId}${waitTool}`.trim();
}

/**
 * In-flight external work and the plan steps not yet finished. Bounded so a long run
 * cannot turn the summary into a second transcript.
 */
export function buildCompactionOpenThreads(params: {
  plan?: ReadonlyArray<AgentPlanStep>;
  trackedAsyncOperations?: ReadonlyMap<string, TrackedAsyncOperation>;
}): string[] {
  const planThreads = (params.plan ?? [])
    .filter((entry) => entry.status !== 'completed')
    .map(planStepOpenThread)
    .filter((thread): thread is string => Boolean(thread));

  const asyncThreads = getPendingTrackedAsyncOperations(
    params.trackedAsyncOperations ?? new Map<string, TrackedAsyncOperation>(),
  )
    .map(asyncOperationOpenThread)
    .filter((thread): thread is string => Boolean(thread));

  return Array.from(new Set([...asyncThreads, ...planThreads])).slice(
    0,
    MAX_COMPACTION_OPEN_THREADS,
  );
}
