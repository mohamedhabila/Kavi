import type { AgentGoal } from '../../types/agentRun';

export function buildCanonicalGoalResult(goal: AgentGoal): Record<string, unknown> {
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    completionPolicy: goal.completionPolicy,
    dependencies: goal.dependencies,
    evidence: goal.evidence,
    ...(goal.successCriteria?.length ? { successCriteria: goal.successCriteria } : {}),
    ...(goal.userConstraints?.length ? { userConstraintCount: goal.userConstraints.length } : {}),
    ...(goal.requiredCapabilities?.length
      ? { requiredCapabilities: goal.requiredCapabilities }
      : {}),
    ...(goal.requiredResourceKinds?.length
      ? { requiredResourceKinds: goal.requiredResourceKinds }
      : {}),
    ...(goal.owner ? { owner: goal.owner } : {}),
    ...(goal.blockedReason ? { blockedReason: goal.blockedReason } : {}),
    ...(goal.completedAt ? { completedAt: goal.completedAt } : {}),
  };
}
