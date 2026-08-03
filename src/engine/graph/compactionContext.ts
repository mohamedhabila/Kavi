// ---------------------------------------------------------------------------
// Kavi — Compaction Context
// ---------------------------------------------------------------------------
// Code-owned pending-work state handed to the context engine so a compaction
// summary carries the task forward instead of only describing what already
// happened. Everything here is derived from graph state and tracked async
// operations; nothing is parsed out of rendered prompt text or model output.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import { getPendingTrackedAsyncOperations } from '../pendingAsyncOperations';

export const MAX_COMPACTION_OPEN_THREADS = 8;
const MAX_OPEN_THREAD_CHARS = 160;

const LIVE_GOAL_STATUSES: ReadonlySet<AgentGoal['status']> = new Set<AgentGoal['status']>([
  'active',
  'pending',
  'blocked',
]);

function truncate(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > MAX_OPEN_THREAD_CHARS
    ? `${normalized.slice(0, MAX_OPEN_THREAD_CHARS - 1)}…`
    : normalized;
}

function goalOpenThread(goal: AgentGoal): string | null {
  const title = truncate(goal.title ?? '');
  if (!title) return null;
  const criteria = (goal.successCriteria ?? []).filter(Boolean);
  const remaining = criteria.length > 0 ? ` — criteria: ${truncate(criteria.join(', '))}` : '';
  return `[${goal.status}] ${title}${remaining}`;
}

function asyncOperationOpenThread(operation: TrackedAsyncOperation): string | null {
  const kind = (operation.kind ?? '').trim();
  const resourceId = (operation.resourceId ?? '').trim();
  if (!kind && !resourceId) return null;
  const waitTool = operation.waitToolName ? ` — resume with ${operation.waitToolName}` : '';
  return `[awaiting ${operation.status}] ${kind || 'operation'} ${resourceId}${waitTool}`.trim();
}

/**
 * Live goals and in-flight external work, newest state first. Bounded so a long
 * run cannot turn the summary into a second transcript.
 */
export function buildCompactionOpenThreads(params: {
  goals?: ReadonlyArray<AgentGoal>;
  trackedAsyncOperations?: ReadonlyMap<string, TrackedAsyncOperation>;
}): string[] {
  const goalThreads = (params.goals ?? [])
    .filter((goal) => LIVE_GOAL_STATUSES.has(goal.status))
    .map(goalOpenThread)
    .filter((thread): thread is string => Boolean(thread));

  const asyncThreads = getPendingTrackedAsyncOperations(
    params.trackedAsyncOperations ?? new Map<string, TrackedAsyncOperation>(),
  )
    .map(asyncOperationOpenThread)
    .filter((thread): thread is string => Boolean(thread));

  return Array.from(new Set([...asyncThreads, ...goalThreads])).slice(
    0,
    MAX_COMPACTION_OPEN_THREADS,
  );
}
