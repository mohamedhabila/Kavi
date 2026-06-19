// ---------------------------------------------------------------------------
// Kavi — Graph-owned task scope resolution
// ---------------------------------------------------------------------------
// Single source for mapping graph state to memory working-block scope keys.

import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { WorkingBlockScope } from '../../services/memory/workingBlocks';
import { getActiveGoal, type AgentGoal } from './types';

export type GraphTaskScopeInput = {
  goals?: ReadonlyArray<AgentGoal>;
  activeTaskId?: string | null;
};

export function resolveGraphTaskId(input: GraphTaskScopeInput): string | undefined {
  const trimmedTaskId = typeof input.activeTaskId === 'string' ? input.activeTaskId.trim() : '';
  if (trimmedTaskId) {
    if (!input.goals) {
      return trimmedTaskId;
    }
    const matchingGoal = input.goals.find(
      (goal) =>
        goal.id === trimmedTaskId &&
        (goal.status === 'active' || goal.status === 'pending'),
    );
    if (matchingGoal) {
      return trimmedTaskId;
    }
  }
  return getActiveGoal(input.goals ?? [])?.id;
}

export function resolveGraphWorkingBlockScope(params: {
  conversationId: string;
  graphState?: Pick<AgentRunControlGraphState, 'goals' | 'activeTaskId'> | null;
}): WorkingBlockScope {
  const conversationId = params.conversationId;
  const taskId = resolveGraphTaskId({
    goals: params.graphState?.goals,
    activeTaskId: params.graphState?.activeTaskId,
  });
  return {
    conversationId,
    threadId: conversationId,
    ...(taskId ? { taskId } : {}),
  };
}
