import type { AgentGoal } from '../../types/agentRun';

function renderGoalFocus(goal: AgentGoal, options?: { includeCriteria?: boolean }): string {
  const parts = [`[${goal.id}] ${goal.title}`];
  if (goal.description && goal.description.trim() && goal.description.trim() !== goal.title) {
    parts.push(`: ${goal.description.trim()}`);
  }
  if (options?.includeCriteria !== false && goal.successCriteria?.length) {
    parts.push(` criteria=${goal.successCriteria.join(', ')}`);
  }
  return parts.join('');
}

export function renderGoalFocusLines(goals: ReadonlyArray<AgentGoal>): string[] {
  return goals.map((goal) => `- ${renderGoalFocus(goal)}`);
}

export function renderPendingGoalFocusLines(goals: ReadonlyArray<AgentGoal>): string[] {
  return goals.map((goal) => `- ${renderGoalFocus(goal, { includeCriteria: false })}`);
}

export function renderGoalFocusInline(goals: ReadonlyArray<AgentGoal>, limit = 3): string {
  return goals
    .slice(0, limit)
    .map((goal) => renderGoalFocus(goal))
    .join('; ');
}
