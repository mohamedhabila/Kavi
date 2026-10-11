// ---------------------------------------------------------------------------
// Kavi — Graph-owned task scope resolution
// ---------------------------------------------------------------------------
// Single source for mapping graph state to memory working-block scope keys.

import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { WorkingBlockScope } from '../../services/memory/workingBlocks';

/** The task a run's memory work is scoped to: the workstream a worker run serves. */
export function resolveGraphTaskId(activeTaskId: string | null | undefined): string | undefined {
  const trimmed = typeof activeTaskId === 'string' ? activeTaskId.trim() : '';
  return trimmed || undefined;
}

export function resolveGraphWorkingBlockScope(params: {
  conversationId: string;
  graphState?: Pick<AgentRunControlGraphState, 'activeTaskId'> | null;
}): WorkingBlockScope {
  const conversationId = params.conversationId;
  const taskId = resolveGraphTaskId(params.graphState?.activeTaskId);
  return {
    conversationId,
    threadId: conversationId,
    ...(taskId ? { taskId } : {}),
  };
}
