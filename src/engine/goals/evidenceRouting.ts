import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { isCountOnlySuccessCriterion, isSuccessCriterionMet } from './completionEvidence';
import type { AgentGoal } from './types';

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
      !isCountOnlySuccessCriterion(criterion) &&
      isSuccessCriterionMet(hypotheticalGoal, criterion),
  );
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

function shouldFallbackToSingleUnscopedGoal(goal: AgentGoal, activeGoalCount: number): boolean {
  return (
    activeGoalCount === 1 &&
    !hasGoalContractRequirements(goal) &&
    !hasRoutableSuccessCriteria(goal)
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
  if (params.toolDefinition && goalMatchesToolContract(params.goal, params.toolDefinition)) {
    return true;
  }
  return shouldFallbackToSingleUnscopedGoal(params.goal, params.activeGoalCount);
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
    (goal) => goal.status === 'active' || goal.status === 'blocked',
  );
  const routed: RoutedGoalEvidence[] = [];
  const seen = new Set<string>();

  for (const goal of activeGoals) {
    for (const evidence of params.evidenceStrings) {
      if (
        !routeEvidenceToGoal({
          goal,
          activeGoalCount: activeGoals.length,
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
