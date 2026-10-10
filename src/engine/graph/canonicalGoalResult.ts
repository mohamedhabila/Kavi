import type { AgentGoal } from '../../types/agentRun';
import { describeUnmetGatingCriteria, isBlockingGoalClosedWithoutProof } from '../goals/goalProof';

/**
 * Closing a goal is accepted whether or not its criteria hold, and the canonical result
 * used to say only `status: "completed"`. Traced live: the model closed a verification
 * goal whose memory writes had all been refused, read "completed", and told the user the
 * verification was recorded — while finalization, which does check the proof, refused to
 * settle the run. The result now says so when the goal it reports is closed unproven.
 *
 * The note names only recoveries the graph accepts. It once told the model to "correct
 * them with update_goals action \"update\"" for any unmet criterion, while blocking
 * criteria that name a deliverable are monotonic and refuse exactly that — traced live as
 * five refused corrections and a run ended blocked. Each unmet criterion now carries its
 * own `satisfyBy`, which says when a correction is the legal step.
 */
const UNPROVEN_CLOSE_NOTE =
  'Closed, but its success criteria are not met, so the run cannot finish as verified. ' +
  'Each unmet criterion says what would meet it; do that if the work allows, otherwise ' +
  'tell the user plainly what could not be confirmed.';
const NO_CRITERIA_CLOSE_NOTE =
  'Closed, but it has no success criteria, so nothing proves it and the run cannot ' +
  'finish as verified. Add a specific criterion naming the evidence the work produced ' +
  'with update_goals action "update", or tell the user plainly what could not be confirmed.';

function buildUnprovenCloseReport(goal: AgentGoal): Record<string, unknown> | undefined {
  if (!isBlockingGoalClosedWithoutProof(goal)) return undefined;
  const unmetCriteria = describeUnmetGatingCriteria(goal);
  return {
    proven: false,
    ...(unmetCriteria.length > 0 ? { unmetCriteria } : {}),
    note: (goal.successCriteria?.length ?? 0) === 0 ? NO_CRITERIA_CLOSE_NOTE : UNPROVEN_CLOSE_NOTE,
  };
}

export function buildCanonicalGoalResult(goal: AgentGoal): Record<string, unknown> {
  const proof = buildUnprovenCloseReport(goal);
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
    ...(proof ? { proof } : {}),
  };
}
