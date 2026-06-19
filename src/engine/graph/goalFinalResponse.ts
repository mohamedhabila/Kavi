import type { AgentGoal, AgentRun } from '../../types/agentRun';

function normalizeText(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function readGoalFinalResponse(goals: ReadonlyArray<AgentGoal>): string | undefined {
  const completedGoals = goals.filter((goal) => goal.status === 'completed');
  if (completedGoals.length === 0) {
    return undefined;
  }

  const latestCompletedGoal = [...completedGoals].sort(
    (left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt),
  )[0];
  const latestEvidence = latestCompletedGoal.evidence.at(-1);
  if (latestEvidence) {
    return normalizeText(latestEvidence) || undefined;
  }

  return normalizeText(latestCompletedGoal.description) || undefined;
}

export function readGraphExpectedFinalResponse(
  run: Pick<AgentRun, 'controlGraph'>,
): string | undefined {
  const goals = run.controlGraph?.goals ?? [];
  if (goals.length === 0) {
    return undefined;
  }

  return readGoalFinalResponse(goals);
}
