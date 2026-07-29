// ---------------------------------------------------------------------------
// Kavi — Graph-Owned Goal State
// ---------------------------------------------------------------------------
// High-level goal tracking for iterative agent planning.
// Goals are the agent's working-memory intentions: what it is currently
// trying to do, what remains pending, and what is blocked.
//
// Design principles:
//   - Minimal surface: id, title, status, dependencies, evidence
//   - Language-agnostic: no English heuristics, no NLP
//   - Graph-owned: mutated via XState events, not direct store writes
//   - Iterative: model adds/completes/modifies goals turn-by-turn
//   - Human-memory analogy: goals = intention stack; evidence = associative links
// ---------------------------------------------------------------------------

import {
  readPersistedAgentGoalUserConstraintState,
  type AgentGoalUserConstraint,
  type AgentGoalUserConstraintIntegrity,
} from './userConstraints';

export type AgentGoalStatus = 'pending' | 'active' | 'completed' | 'blocked';
export type AgentGoalCompletionPolicy = 'blocking' | 'persistent';
export const CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER = 'system:effect-completion' as const;

export type { AgentGoalUserConstraint, AgentGoalUserConstraintIntegrity } from './userConstraints';

export interface AgentGoal {
  id: string;
  title: string;
  description?: string;
  status: AgentGoalStatus;
  dependencies: string[];
  evidence: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  owner?: 'supervisor' | string;
  requiredCapabilities?: string[];
  requiredResourceKinds?: string[];
  successCriteria?: string[];
  userConstraints?: AgentGoalUserConstraint[];
  userConstraintIntegrity?: AgentGoalUserConstraintIntegrity;
  /** Code-owned carryover until the constrained result is delivered to the user. */
  userConstraintDeliveryPending?: true;
  completionPolicy?: AgentGoalCompletionPolicy;
  blockedReason?: string;
}

export interface AgentGoalMutation {
  action: 'add' | 'complete' | 'activate' | 'block' | 'remove' | 'update';
  goals: Array<{
    id?: string;
    title?: string;
    description?: string;
    status?: AgentGoalStatus;
    dependencies?: string[];
    evidence?: string[];
    requiredCapabilities?: string[];
    requiredResourceKinds?: string[];
    owner?: 'supervisor' | string;
    successCriteria?: string[];
    /** Provider intent only; graph code captures the entire current user message. */
    retainCurrentUserConstraint?: true;
    completionPolicy?: AgentGoalCompletionPolicy;
    blockedReason?: string;
  }>;
}

export interface AgentGoalMutationResult {
  success: boolean;
  goals: AgentGoal[];
  errors?: string[];
}

export function createGoal(params: {
  id?: string;
  title: string;
  description?: string;
  status?: AgentGoalStatus;
  dependencies?: string[];
  evidence?: string[];
  owner?: 'supervisor' | string;
  requiredCapabilities?: string[];
  requiredResourceKinds?: string[];
  successCriteria?: string[];
  userConstraints?: AgentGoalUserConstraint[];
  completionPolicy?: AgentGoalCompletionPolicy;
  blockedReason?: string;
  now?: number;
}): AgentGoal {
  const now = params.now ?? Date.now();
  const status = params.status ?? 'pending';
  const completionPolicy = params.completionPolicy ?? resolveDefaultGoalCompletionPolicy(params);
  const successCriteria = resolveStoredSuccessCriteria({
    completionPolicy,
    successCriteria: params.successCriteria,
  });
  const userConstraintState = readPersistedAgentGoalUserConstraintState({
    value: params.userConstraints,
    allowedOnGoal: completionPolicy === 'blocking',
  });
  const hasCompletedConstraintConflict =
    status === 'completed' &&
    (userConstraintState.state === 'conflict' ||
      (userConstraintState.state === 'canonical' && userConstraintState.constraints.length > 0));
  return {
    id: params.id?.trim() || generateGoalId(),
    title: params.title.trim(),
    ...(params.description?.trim() ? { description: params.description.trim() } : {}),
    status,
    dependencies: Array.from(new Set(params.dependencies ?? [])),
    evidence: Array.from(new Set(params.evidence ?? [])),
    createdAt: now,
    updatedAt: now,
    ...(status === 'completed' ? { completedAt: now } : {}),
    ...(params.owner ? { owner: params.owner } : {}),
    ...(params.requiredCapabilities?.length
      ? { requiredCapabilities: params.requiredCapabilities }
      : {}),
    ...(params.requiredResourceKinds?.length
      ? { requiredResourceKinds: params.requiredResourceKinds }
      : {}),
    ...(successCriteria?.length ? { successCriteria } : {}),
    ...(userConstraintState.state === 'canonical' && !hasCompletedConstraintConflict
      ? { userConstraints: userConstraintState.constraints }
      : {}),
    ...(userConstraintState.state === 'conflict' || hasCompletedConstraintConflict
      ? { userConstraintIntegrity: 'conflict' as const }
      : {}),
    ...(hasCompletedConstraintConflict ? { userConstraintDeliveryPending: true as const } : {}),
    completionPolicy,
    ...(params.blockedReason?.trim() ? { blockedReason: params.blockedReason.trim() } : {}),
  };
}

function generateGoalId(): string {
  return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeGoalStatus(value: unknown): AgentGoalStatus {
  if (value === 'pending' || value === 'active' || value === 'completed' || value === 'blocked') {
    return value;
  }
  return 'pending';
}

export function normalizeGoalCompletionPolicy(
  value: unknown,
): AgentGoalCompletionPolicy | undefined {
  if (value === 'blocking' || value === 'persistent') {
    return value;
  }
  return undefined;
}

function hasStructuralCompletionRequirement(goal: Pick<AgentGoal, 'successCriteria'>): boolean {
  return (goal.successCriteria?.length ?? 0) > 0;
}

export function resolveDefaultGoalCompletionPolicy(
  goal: Pick<AgentGoal, 'successCriteria'>,
): AgentGoalCompletionPolicy {
  return hasStructuralCompletionRequirement(goal) ? 'blocking' : 'persistent';
}

function resolveStoredSuccessCriteria(params: {
  completionPolicy?: AgentGoalCompletionPolicy;
  successCriteria?: string[];
}): string[] | undefined {
  const completionPolicy = params.completionPolicy ?? resolveDefaultGoalCompletionPolicy(params);
  return completionPolicy === 'blocking' && params.successCriteria?.length
    ? params.successCriteria
    : undefined;
}

export function resolveGoalCompletionPolicy(
  goal: Pick<AgentGoal, 'completionPolicy' | 'successCriteria'>,
): AgentGoalCompletionPolicy {
  return goal.completionPolicy ?? resolveDefaultGoalCompletionPolicy(goal);
}

export function isBlockingGoal(
  goal: Pick<AgentGoal, 'completionPolicy' | 'successCriteria'>,
): boolean {
  return resolveGoalCompletionPolicy(goal) === 'blocking';
}

export function isCodeOwnedEffectCompletionGoal(goal: Pick<AgentGoal, 'owner'>): boolean {
  return goal.owner === CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER;
}

export function hasResumableBlockingGoals(goals: ReadonlyArray<AgentGoal>): boolean {
  return goals.some(
    (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'pending'),
  );
}

export function hasBlockedBlockingGoals(goals: ReadonlyArray<AgentGoal>): boolean {
  return goals.some((goal) => isBlockingGoal(goal) && goal.status === 'blocked');
}

export function hasIncompleteBlockingGoals(goals: ReadonlyArray<AgentGoal>): boolean {
  return hasResumableBlockingGoals(goals) || hasBlockedBlockingGoals(goals);
}

export function normalizeGoal(value: unknown): AgentGoal | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  const id = typeof v.id === 'string' && v.id.trim().length > 0 ? v.id.trim() : generateGoalId();
  const title = typeof v.title === 'string' && v.title.trim().length > 0 ? v.title.trim() : '';
  if (!title) return null;

  const description =
    typeof v.description === 'string' && v.description.trim().length > 0
      ? v.description.trim()
      : undefined;

  const status = normalizeGoalStatus(v.status);

  const dependencies = Array.isArray(v.dependencies)
    ? v.dependencies.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];

  const evidence = Array.isArray(v.evidence)
    ? v.evidence.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : [];

  const owner = v.owner === 'supervisor' || typeof v.owner === 'string' ? v.owner : undefined;

  const requiredCapabilities = Array.isArray(v.requiredCapabilities)
    ? v.requiredCapabilities.filter(
        (c): c is string => typeof c === 'string' && c.trim().length > 0,
      )
    : undefined;

  const requiredResourceKinds = Array.isArray(v.requiredResourceKinds)
    ? v.requiredResourceKinds.filter(
        (r): r is string => typeof r === 'string' && r.trim().length > 0,
      )
    : undefined;

  const successCriteria = Array.isArray(v.successCriteria)
    ? v.successCriteria.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : undefined;

  const completionPolicy =
    normalizeGoalCompletionPolicy(v.completionPolicy) ??
    resolveDefaultGoalCompletionPolicy({ successCriteria });
  const storedSuccessCriteria = resolveStoredSuccessCriteria({
    completionPolicy,
    successCriteria,
  });
  const userConstraintState =
    v.userConstraintIntegrity !== undefined
      ? ({ state: 'conflict' } as const)
      : readPersistedAgentGoalUserConstraintState({
          value: v.userConstraints,
          allowedOnGoal: completionPolicy === 'blocking',
        });

  const blockedReason =
    typeof v.blockedReason === 'string' && v.blockedReason.trim().length > 0
      ? v.blockedReason.trim()
      : undefined;

  const createdAt =
    typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? v.createdAt : Date.now();
  const updatedAt =
    typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : createdAt;
  const completedAt =
    status === 'completed' && typeof v.completedAt === 'number' && Number.isFinite(v.completedAt)
      ? v.completedAt
      : undefined;
  const hasCanonicalUserConstraints =
    userConstraintState.state === 'canonical' && userConstraintState.constraints.length > 0;
  const hasCompletedConstraintObligation =
    status === 'completed' &&
    (hasCanonicalUserConstraints ||
      userConstraintState.state === 'conflict' ||
      v.userConstraintDeliveryPending === true);
  const hasCanonicalPendingConstraintDelivery =
    status === 'completed' &&
    v.userConstraintDeliveryPending === true &&
    hasCanonicalUserConstraints;
  const hasUserConstraintConflict =
    userConstraintState.state === 'conflict' ||
    (hasCompletedConstraintObligation && !hasCanonicalPendingConstraintDelivery);

  return {
    id,
    title,
    ...(description ? { description } : {}),
    status,
    dependencies: Array.from(new Set(dependencies)),
    evidence: Array.from(new Set(evidence)),
    createdAt,
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(owner ? { owner } : {}),
    ...(requiredCapabilities?.length ? { requiredCapabilities } : {}),
    ...(requiredResourceKinds?.length ? { requiredResourceKinds } : {}),
    ...(storedSuccessCriteria?.length ? { successCriteria: storedSuccessCriteria } : {}),
    ...(userConstraintState.state === 'canonical' && !hasUserConstraintConflict
      ? { userConstraints: userConstraintState.constraints }
      : {}),
    ...(hasUserConstraintConflict ? { userConstraintIntegrity: 'conflict' as const } : {}),
    ...(hasCompletedConstraintObligation ? { userConstraintDeliveryPending: true as const } : {}),
    completionPolicy,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

export function normalizeGoals(value: unknown): AgentGoal[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGoal).filter((g): g is AgentGoal => g !== null);
}

export function getActiveGoalId(goals: ReadonlyArray<AgentGoal>): string | null {
  for (let i = goals.length - 1; i >= 0; i--) {
    if (goals[i].status === 'active') return goals[i].id;
  }
  return null;
}

export function getActiveGoal(goals: ReadonlyArray<AgentGoal>): AgentGoal | null {
  for (let i = goals.length - 1; i >= 0; i--) {
    if (goals[i].status === 'active') return goals[i];
  }
  return null;
}

export function getGoalById(goals: ReadonlyArray<AgentGoal>, id: string): AgentGoal | null {
  return goals.find((g) => g.id === id) ?? null;
}
