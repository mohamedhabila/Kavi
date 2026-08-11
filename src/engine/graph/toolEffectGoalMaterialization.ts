import type { AgentGoal } from '../../types/agentRun';
import type { ToolDefinition } from '../../types/tool';
import {
  effectCompletionCriteriaEqual,
  effectReceiptEvidenceTargetsCriterion,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
  type EffectCompletionCriterion,
} from '../goals/effectCompletionEvidence';
import { applyGoalMutation } from '../goals/graphState';
import { CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER, isBlockingGoal } from '../goals/types';
import { isDelegationOwnedGoal } from '../goals/delegation';
import {
  findGoalForEffectCompletionRequirement,
  resolveToolEffectCompletionRequirement,
  type ToolEffectCompletionRequirement,
} from '../toolExecution/toolEffectCompletionContract';
import { validateToolArgumentsAgainstSchema } from '../toolExecution/toolArgumentSchemaValidation';
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

function resourcesCanDescribeOneRetry(
  previous: EffectCompletionCriterion,
  next: EffectCompletionCriterion,
): boolean {
  if (previous.resource.kind !== next.resource.kind) {
    return false;
  }
  if (previous.resource.id === next.resource.id) {
    return true;
  }
  return (
    previous.resource.id === '*' ||
    next.resource.id === '*' ||
    previous.resource.kind === 'effect_request'
  );
}

function hasTerminalFailedReceipt(params: {
  goal: AgentGoal;
  criterion: EffectCompletionCriterion;
  toolName: string;
}): boolean {
  const normalizedToolName = normalizeToolName(params.toolName);
  return params.goal.evidence.some((value) => {
    const evidence = parseToolEffectReceiptEvidence(value);
    return (
      evidence !== null &&
      normalizeToolName(evidence.toolName) === normalizedToolName &&
      effectReceiptEvidenceTargetsCriterion(evidence, params.criterion) &&
      (evidence.effectState === 'failed' || evidence.effectState === 'cancelled')
    );
  });
}

function findUnambiguousFailedRetryCandidate(
  goals: ReadonlyArray<AgentGoal>,
  requirement: EffectfulRequirement,
): { goal: AgentGoal; criterion: string } | null {
  const candidates: Array<{ goal: AgentGoal; criterion: string }> = [];
  for (const goal of goals) {
    if (goal.status !== 'active' || !isBlockingGoal(goal)) {
      continue;
    }
    for (const serializedCriterion of goal.successCriteria ?? []) {
      const criterion = parseEffectCompletionCriterion(serializedCriterion);
      if (
        criterion === null ||
        effectCompletionCriteriaEqual(criterion, requirement.criterion) ||
        criterion.effectKind !== requirement.criterion.effectKind ||
        !resourcesCanDescribeOneRetry(criterion, requirement.criterion) ||
        !hasTerminalFailedReceipt({
          goal,
          criterion,
          toolName: requirement.toolName,
        })
      ) {
        continue;
      }
      candidates.push({ goal, criterion: serializedCriterion });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function replaceUnambiguousFailedRetryCriteria(params: {
  goals: ReadonlyArray<AgentGoal>;
  requirements: ReadonlyArray<EffectfulRequirement>;
  now: number;
}): { status: 'unchanged'; goals: AgentGoal[] } | { status: 'replaced'; goals: AgentGoal[] } {
  let goals = [...params.goals];
  let replaced = false;
  for (const requirement of params.requirements) {
    if (findGoalForEffectCompletionRequirement(goals, requirement)) {
      continue;
    }
    const candidate = findUnambiguousFailedRetryCandidate(goals, requirement);
    if (!candidate) {
      continue;
    }
    // Provider-authored goal mutations remain monotonic. This narrower
    // code-owned rewrite retires only one receipt-proven terminal attempt so
    // a corrected retry is not required to satisfy impossible old arguments.
    goals = goals.map((goal) =>
      goal.id === candidate.goal.id
        ? {
            ...goal,
            successCriteria: (goal.successCriteria ?? []).map((criterion) =>
              criterion === candidate.criterion ? requirement.serializedCriterion : criterion,
            ),
            updatedAt: params.now,
          }
        : goal,
    );
    replaced = true;
  }
  return replaced ? { status: 'replaced', goals } : { status: 'unchanged', goals };
}

function applyMaterialization(params: {
  goals: ReadonlyArray<AgentGoal>;
  action: 'add' | 'activate' | 'update';
  goal: {
    id: string;
    title: string;
    status?: 'active';
    completionPolicy?: 'blocking';
    owner?: string;
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
  tools?: ReadonlyArray<ToolDefinition>;
  now?: number;
}): Promise<ToolEffectGoalMaterialization> {
  const goals = [...(params.goals ?? [])];

  /**
   * A batch that also mutates goals used to skip materialization entirely, which turned
   * one refused effect into a loop the model could only escape by accident.
   *
   * Traced live on an Android emulator. The model batched `update_goals` with the
   * `write_file` that mutation was setting up. The batch boundary refused the write, and
   * this skip meant the effect-completion goal that would have admitted it was never
   * created — so the retry, batched the same way, was refused for the same reason. Only
   * when the model happened to send the write alone did materialization run and the write
   * succeed on the first attempt:
   *
   *   10:05:36  update_goals ok, write_file  -> goal_mutation_boundary
   *   10:06:19  write_file, update_goals ok  -> goal_mutation_boundary
   *   10:06:34  write_file alone             -> written
   *
   * The skip was guarding against clobbering the model's pending mutation. It cannot:
   * the goals materialized here carry code-owned `effect-<tool>-<digest>` ids that no
   * model mutation addresses, this runs and commits before the batch executes, and the
   * goal-mutation canonicalization that applies the model's own mutation afterwards reads
   * a fresh graph snapshot rather than the one captured here.
   */
  const materializableToolCalls = params.tools
    ? params.toolCalls.filter(
        (toolCall) =>
          !validateToolArgumentsAgainstSchema({
            toolName: toolCall.name,
            argumentsText: toolCall.arguments,
            tools: params.tools,
          }),
      )
    : params.toolCalls;
  const requirements = await Promise.all(
    materializableToolCalls.map((toolCall) =>
      resolveToolEffectCompletionRequirement({
        toolName: toolCall.name,
        argumentsText: toolCall.arguments,
      }),
    ),
  );
  const effectfulRequirements = uniqueEffectfulRequirements(requirements);
  const now = params.now ?? Date.now();
  const retryReplacement = replaceUnambiguousFailedRetryCriteria({
    goals,
    requirements: effectfulRequirements,
    now,
  });
  const workingGoals = retryReplacement.goals;
  const missing = effectfulRequirements.filter(
    (requirement) => !findGoalForEffectCompletionRequirement(workingGoals, requirement),
  );
  if (missing.length === 0) {
    return retryReplacement.status === 'replaced'
      ? {
          status: 'materialized',
          goals: workingGoals,
          reason: 'effect_completion_contract:retry_replaced',
          timestamp: now,
        }
      : { status: 'unchanged', goals: workingGoals };
  }

  const missingCriteria = missing.map((requirement) => requirement.serializedCriterion);
  const blockedContractExists = workingGoals.some(
    (goal) =>
      goal.status === 'blocked' &&
      isBlockingGoal(goal) &&
      (goal.successCriteria ?? []).some((criterion) => missingCriteria.includes(criterion)),
  );
  if (blockedContractExists) {
    return {
      status: 'rejected',
      goals: workingGoals,
      errors: ['effect_completion_verification_blocked'],
    };
  }
  // A delegation goal's contract belongs to the worker, so this run's own side effects
  // must not add criteria to it — the same rule evidence routing already applies when it
  // decides where tool output may land. Skipping it here falls through to the branch that
  // creates a dedicated code-owned verification goal, which is what happens whenever
  // there is no active blocking deliverable of this run's own.
  const activeBlockingGoal = workingGoals.find(
    (goal) => goal.status === 'active' && isBlockingGoal(goal) && !isDelegationOwnedGoal(goal),
  );
  if (activeBlockingGoal) {
    return applyMaterialization({
      goals: workingGoals,
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

  const reusablePendingGoal = workingGoals.find(
    (goal) =>
      goal.status === 'pending' &&
      isBlockingGoal(goal) &&
      missingCriteria.every((criterion) => (goal.successCriteria ?? []).includes(criterion)),
  );
  if (reusablePendingGoal) {
    return applyMaterialization({
      goals: workingGoals,
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
    goals: workingGoals,
    action: 'add',
    goal: {
      id: buildUnusedGoalId(workingGoals, buildGoalIdBase(first)),
      title:
        toolNames.length === 1
          ? `Verify ${toolNames[0]} effect`
          : `Verify ${toolNames.length} tool effects`,
      status: 'active',
      completionPolicy: 'blocking',
      owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
      successCriteria: missingCriteria,
    },
    now,
  });
}
