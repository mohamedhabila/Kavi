import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { isCountOnlySuccessCriterion, isSuccessCriterionMet } from './completionEvidence';
import {
  effectReceiptEvidenceTargetsCriterion,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from './effectCompletionEvidence';
import { isDelegationOwnedGoal } from './delegation';
import { isCodeOwnedEffectCompletionGoal, type AgentGoal } from './types';

export type RoutedGoalEvidence = {
  goalId: string;
  evidence: string;
};

function normalizeTags(values: ReadonlyArray<string> | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function intersects(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function hasRoutableSuccessCriteria(goal: AgentGoal): boolean {
  return (goal.successCriteria ?? []).some((criterion) => !isCountOnlySuccessCriterion(criterion));
}

function hasGoalContractRequirements(goal: AgentGoal): boolean {
  return (
    normalizeTags(goal.requiredCapabilities).length > 0 ||
    normalizeTags(goal.requiredResourceKinds).length > 0
  );
}

function goalCriterionMatchesEvidence(goal: AgentGoal, evidence: string): boolean {
  const criteria = goal.successCriteria ?? [];
  if (criteria.length === 0) {
    return false;
  }

  const hypotheticalGoal: AgentGoal = {
    ...goal,
    evidence: [evidence],
  };
  return criteria.some(
    (criterion) =>
      !isCountOnlySuccessCriterion(criterion) && isSuccessCriterionMet(hypotheticalGoal, criterion),
  );
}

function goalEffectCriterionTargetsEvidence(goal: AgentGoal, evidence: string): boolean {
  const receipt = parseToolEffectReceiptEvidence(evidence);
  if (!receipt) {
    return false;
  }
  return (goal.successCriteria ?? []).some((criterion) => {
    const effectCriterion = parseEffectCompletionCriterion(criterion);
    return effectCriterion
      ? effectReceiptEvidenceTargetsCriterion(receipt, effectCriterion)
      : false;
  });
}

function goalMatchesToolContract(goal: AgentGoal, tool: Pick<ToolDefinition, 'contract'>): boolean {
  const requiredCapabilities = normalizeTags(goal.requiredCapabilities);
  const requiredResourceKinds = normalizeTags(goal.requiredResourceKinds);
  if (requiredCapabilities.length === 0 && requiredResourceKinds.length === 0) {
    return false;
  }

  const toolCapabilities = normalizeTags(tool.contract?.capabilities);
  const toolResourceKinds = normalizeTags(tool.contract?.resourceKinds);
  const capabilitiesMatch =
    requiredCapabilities.length === 0 || intersects(requiredCapabilities, toolCapabilities);
  const resourcesMatch =
    requiredResourceKinds.length === 0 || intersects(requiredResourceKinds, toolResourceKinds);
  return capabilitiesMatch && resourcesMatch;
}

/**
 * `activeGoalCount` counts only goals the model actually declared.
 *
 * Executing an effectful tool materializes a code-owned "Verify <tool> effect" goal
 * alongside the model's own. That pushed the active count to two and silently
 * disqualified the model's goal from this fallback, so a run with a single objective
 * and an unscoped criterion collected no evidence at all — the receipt landed on the
 * bookkeeping goal and nothing else. The model's only recourse was to repeat the side
 * effect to try to earn evidence it had already earned. Bookkeeping goals still
 * receive evidence; they just no longer make the run look multi-objective.
 */
function shouldFallbackToSingleUnscopedGoal(goal: AgentGoal, activeGoalCount: number): boolean {
  return (
    activeGoalCount === 1 && !hasGoalContractRequirements(goal) && !hasRoutableSuccessCriteria(goal)
  );
}

function routeEvidenceToGoal(params: {
  goal: AgentGoal;
  activeGoalCount: number;
  toolDefinition?: Pick<ToolDefinition, 'contract'>;
  evidence: string;
}): boolean {
  if (goalCriterionMatchesEvidence(params.goal, params.evidence)) {
    return true;
  }
  if (goalEffectCriterionTargetsEvidence(params.goal, params.evidence)) {
    return true;
  }
  if (params.toolDefinition && goalMatchesToolContract(params.goal, params.toolDefinition)) {
    return true;
  }
  return shouldFallbackToSingleUnscopedGoal(params.goal, params.activeGoalCount);
}

/**
 * Evidence is routed exactly once, at the moment a tool result arrives. A goal
 * declared after that moment therefore starts empty even when evidence proving its
 * criteria is already sitting on another goal in the same run — which is what happens
 * whenever the model writes a file first and states the goal second. The model's only
 * recovery is to repeat the tool call. That is merely wasteful for a workspace write,
 * but for a non-idempotent effect — sending a message, creating a calendar event — it
 * means doing the real-world action twice.
 *
 * Back-fill replays evidence the run already holds against a newly declared goal. It
 * deliberately reuses only the criterion predicates: a goal receives evidence it
 * explicitly asserts it needs, never evidence it merely happens to be adjacent to. The
 * single-active-goal fallback is excluded for the same reason — that rule exists to
 * catch evidence for an unscoped goal at routing time, and applying it here would let
 * an unrelated receipt land on a goal that never asked for it.
 */
export function backfillGoalEvidenceFromExistingGoals(params: {
  goal: AgentGoal;
  existingGoals: ReadonlyArray<AgentGoal>;
}): string[] {
  if ((params.goal.successCriteria ?? []).length === 0) {
    return [];
  }

  const alreadyHeld = new Set(params.goal.evidence);
  const backfilled: string[] = [];

  for (const source of params.existingGoals) {
    if (source.id === params.goal.id || isDelegationOwnedGoal(source)) {
      continue;
    }
    for (const evidence of source.evidence) {
      if (alreadyHeld.has(evidence)) {
        continue;
      }
      if (
        !goalCriterionMatchesEvidence(params.goal, evidence) &&
        !goalEffectCriterionTargetsEvidence(params.goal, evidence)
      ) {
        continue;
      }
      alreadyHeld.add(evidence);
      backfilled.push(evidence);
    }
  }

  return backfilled;
}

export function routeToolEvidenceToActiveGoals(params: {
  toolName: string;
  toolDefinitions: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>;
  goals: ReadonlyArray<AgentGoal>;
  evidenceStrings: ReadonlyArray<string>;
}): RoutedGoalEvidence[] {
  const normalizedToolName = normalizeToolName(params.toolName);
  const toolDefinition = params.toolDefinitions.find(
    (tool) => normalizeToolName(tool.name) === normalizedToolName,
  );
  const activeGoals = params.goals.filter(
    (goal) =>
      (goal.status === 'active' || goal.status === 'blocked') && !isDelegationOwnedGoal(goal),
  );
  const modelDeclaredGoalCount = activeGoals.filter(
    (goal) => !isCodeOwnedEffectCompletionGoal(goal),
  ).length;
  const routed: RoutedGoalEvidence[] = [];
  const seen = new Set<string>();

  for (const goal of activeGoals) {
    for (const evidence of params.evidenceStrings) {
      if (
        !routeEvidenceToGoal({
          goal,
          activeGoalCount: modelDeclaredGoalCount,
          toolDefinition,
          evidence,
        })
      ) {
        continue;
      }
      const key = `${goal.id}\u0000${evidence}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      routed.push({ goalId: goal.id, evidence });
    }
  }

  return routed;
}
