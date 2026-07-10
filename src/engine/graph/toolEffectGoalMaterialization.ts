import type { AgentGoal } from '../../types/agentRun';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import { applyGoalMutation } from '../goals/graphState';
import { isBlockingGoal } from '../goals/types';
import {
  findGoalForEffectCompletionRequirement,
  resolveToolEffectCompletionRequirement,
  type ToolEffectCompletionRequirement,
} from '../toolExecution/toolEffectCompletionContract';
import { normalizeToolName } from '../tools/toolNameNormalization';

type EffectfulRequirement = Extract<ToolEffectCompletionRequirement, { kind: 'effectful' }>;

export type ToolEffectGoalMaterialization =
  | { status: 'unchanged'; goals: AgentGoal[] }
  | { status: 'materialized'; goals: AgentGoal[]; reason: string; timestamp: number }
  | { status: 'rejected'; goals: AgentGoal[]; errors: string[] };

function uniqueEffectfulRequirements(
  requirements: ReadonlyArray<ToolEffectCompletionRequirement>,
): EffectfulRequirement[] {
  const byCriterion = new Map<string, EffectfulRequirement>();
  for (const requirement of requirements) {
    if (requirement.kind === 'effectful') {
      byCriterion.set(requirement.serializedCriterion, requirement);
    }
  }
  return Array.from(byCriterion.values());
}

function buildGoalIdBase(requirement: EffectfulRequirement): string {
  const toolToken =
    normalizeToolName(requirement.toolName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 32) || 'tool';
  const requestToken = requirement.criterion.requestDigest.slice('sha256:'.length, 31);
  return `effect-${toolToken}-${requestToken}`;
}

function buildUnusedGoalId(goals: ReadonlyArray<AgentGoal>, base: string): string {
  const ids = new Set(goals.map((goal) => goal.id));
  if (!ids.has(base)) return base;
  let ordinal = 2;
  while (ids.has(`${base}-${ordinal}`)) ordinal += 1;
  return `${base}-${ordinal}`;
}

function applyMaterialization(params: {
  goals: ReadonlyArray<AgentGoal>;
  action: 'add' | 'activate' | 'update';
  goal: {
    id: string;
    title: string;
    status?: 'active';
    completionPolicy?: 'blocking';
    successCriteria: string[];
  };
  now: number;
}): ToolEffectGoalMaterialization {
  const result = applyGoalMutation(
    params.goals,
    { action: params.action, goals: [params.goal] },
    params.now,
  );
  if (result.errors.length > 0) {
    return { status: 'rejected', goals: [...params.goals], errors: result.errors };
  }
  return {
    status: 'materialized',
    goals: result.goals,
    reason: `effect_completion_contract:${params.action}`,
    timestamp: params.now,
  };
}

/**
 * Materialize only internal completion bookkeeping. This never authorizes or
 * executes a tool effect; approval and tool execution remain on their existing
 * boundaries. The exact receipt criterion keeps finalization fail closed.
 */
export async function materializeToolEffectCompletionGoals(params: {
  toolCalls: ReadonlyArray<{ name: string; arguments: string }>;
  goals: ReadonlyArray<AgentGoal> | undefined;
  now?: number;
}): Promise<ToolEffectGoalMaterialization> {
  const goals = [...(params.goals ?? [])];
  if (
    params.toolCalls.some(
      (toolCall) => normalizeToolName(toolCall.name) === GOAL_BOOTSTRAP_TOOL_NAME,
    )
  ) {
    return { status: 'unchanged', goals };
  }

  const requirements = await Promise.all(
    params.toolCalls.map((toolCall) =>
      resolveToolEffectCompletionRequirement({
        toolName: toolCall.name,
        argumentsText: toolCall.arguments,
      }),
    ),
  );
  const missing = uniqueEffectfulRequirements(requirements).filter(
    (requirement) => !findGoalForEffectCompletionRequirement(goals, requirement),
  );
  if (missing.length === 0) {
    return { status: 'unchanged', goals };
  }

  const missingCriteria = missing.map((requirement) => requirement.serializedCriterion);
  const blockedContractExists = goals.some(
    (goal) =>
      goal.status === 'blocked' &&
      isBlockingGoal(goal) &&
      (goal.successCriteria ?? []).some((criterion) => missingCriteria.includes(criterion)),
  );
  if (blockedContractExists) {
    return {
      status: 'rejected',
      goals,
      errors: ['effect_completion_verification_blocked'],
    };
  }
  const activeBlockingGoal = goals.find(
    (goal) => goal.status === 'active' && isBlockingGoal(goal),
  );
  const now = params.now ?? Date.now();
  if (activeBlockingGoal) {
    return applyMaterialization({
      goals,
      action: 'update',
      goal: {
        id: activeBlockingGoal.id,
        title: activeBlockingGoal.title,
        successCriteria: Array.from(
          new Set([...(activeBlockingGoal.successCriteria ?? []), ...missingCriteria]),
        ),
      },
      now,
    });
  }

  const reusablePendingGoal = goals.find(
    (goal) =>
      goal.status === 'pending' &&
      isBlockingGoal(goal) &&
      missingCriteria.every((criterion) => (goal.successCriteria ?? []).includes(criterion)),
  );
  if (reusablePendingGoal) {
    return applyMaterialization({
      goals,
      action: 'activate',
      goal: {
        id: reusablePendingGoal.id,
        title: reusablePendingGoal.title,
        status: 'active',
        successCriteria: [...(reusablePendingGoal.successCriteria ?? [])],
      },
      now,
    });
  }

  const first = missing[0]!;
  const toolNames = Array.from(new Set(missing.map((requirement) => requirement.toolName))).sort();
  return applyMaterialization({
    goals,
    action: 'add',
    goal: {
      id: buildUnusedGoalId(goals, buildGoalIdBase(first)),
      title:
        toolNames.length === 1
          ? `Verify ${toolNames[0]} effect`
          : `Verify ${toolNames.length} tool effects`,
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: missingCriteria,
    },
    now,
  });
}
