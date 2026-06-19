// ---------------------------------------------------------------------------
// Kavi — Lean Agent Control Graph Contract
// ---------------------------------------------------------------------------
// Canonical graph-owned snapshot shape for the mobile agent control plane.
// Planning, completion, memory task linkage, and async work are graph-owned.
// Workflow routes and execution-unit planning surfaces are not part of this contract.
// ---------------------------------------------------------------------------

import type { AgentRunControlGraphState } from '../../types/agentRun';

/** Fields owned exclusively by the control graph (XState + graph actions). */
export const LEAN_GRAPH_OWNED_FIELDS = [
  'goals',
  'asyncWork',
  'turnDirectives',
  'performance',
  'audit',
  'status',
  'iteration',
  'activeTaskId',
  'expectedToolCalls',
  'observedToolResults',
  'pendingAsyncCount',
  'lastModelToolNames',
  'sessionActivatedToolNames',
  'finalizationHoldReason',
  'terminalReason',
] as const satisfies ReadonlyArray<keyof AgentRunControlGraphState | 'activeTaskId'>;

export type LeanGraphOwnedField = (typeof LEAN_GRAPH_OWNED_FIELDS)[number];

/** Runtime guard: lean snapshots must not carry removed workflow planning fields. */
export function assertLeanGraphSnapshot(
  snapshot: AgentRunControlGraphState,
): AgentRunControlGraphState {
  const legacy = snapshot as AgentRunControlGraphState & {
    workflowRoute?: unknown;
    workflowProgress?: unknown;
  };
  if (legacy.workflowRoute !== undefined || legacy.workflowProgress !== undefined) {
    throw new Error(
      'Lean graph contract violation: workflowRoute/workflowProgress are not allowed on control graph snapshots.',
    );
  }
  return snapshot;
}
