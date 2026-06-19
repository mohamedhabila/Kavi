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

export type AgentGoalStatus = 'pending' | 'active' | 'completed' | 'blocked';
export type AgentGoalCompletionPolicy = 'blocking' | 'persistent';

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
  completionPolicy?: AgentGoalCompletionPolicy;
  blockedReason?: string;
  now?: number;
}): AgentGoal {
  const now = params.now ?? Date.now();
  const completionPolicy = params.completionPolicy ?? resolveDefaultGoalCompletionPolicy(params);
  const successCriteria = resolveStoredSuccessCriteria({
    completionPolicy,
    successCriteria: params.successCriteria,
  });
  return {
    id: params.id?.trim() || generateGoalId(),
    title: params.title.trim(),
    ...(params.description?.trim() ? { description: params.description.trim() } : {}),
    status: params.status ?? 'pending',
    dependencies: Array.from(new Set(params.dependencies ?? [])),
    evidence: Array.from(new Set(params.evidence ?? [])),
    createdAt: now,
    updatedAt: now,
    ...(params.owner ? { owner: params.owner } : {}),
    ...(params.requiredCapabilities?.length
      ? { requiredCapabilities: params.requiredCapabilities }
      : {}),
    ...(params.requiredResourceKinds?.length
      ? { requiredResourceKinds: params.requiredResourceKinds }
      : {}),
    ...(successCriteria?.length ? { successCriteria } : {}),
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
  const completionPolicy =
    params.completionPolicy ?? resolveDefaultGoalCompletionPolicy(params);
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
