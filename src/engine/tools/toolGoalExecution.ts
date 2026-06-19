// ---------------------------------------------------------------------------
// Kavi — Goal Tool Execution
// ---------------------------------------------------------------------------
// The update_goals tool is a meta-tool: the actual graph-state mutation is
// applied by the tool execution outcome resolver so the graph snapshot remains
// the single source of truth. This executor only validates arguments and
// returns a preview that the resolver uses.
// ---------------------------------------------------------------------------

import type { AgentGoalMutation } from '../goals/types';
import {
  normalizeGoalCompletionPolicy,
  type AgentGoalStatus,
} from '../goals/types';

function parseStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function parseGoalStatus(value: unknown): AgentGoalStatus | undefined {
  return value === 'pending' || value === 'active' || value === 'completed' || value === 'blocked'
    ? value
    : undefined;
}

function normalizeParsedGoal(item: Record<string, unknown>): AgentGoalMutation['goals'][number] {
  const completionPolicy = normalizeGoalCompletionPolicy(item.completionPolicy);
  const explicitTitle = typeof item.name === 'string' ? item.name : undefined;
  const status = parseGoalStatus(item.status);
  const successCriteria = parseStringList(item.successCriteria).filter(
    (criterion) => criterion.trim().length > 0,
  );
  const storedSuccessCriteria = completionPolicy === 'persistent' ? [] : successCriteria;

  return {
    ...(typeof item.id === 'string' ? { id: item.id } : {}),
    ...(explicitTitle ? { title: explicitTitle } : {}),
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    ...(status ? { status } : {}),
    ...(completionPolicy ? { completionPolicy } : {}),
    ...(Array.isArray(item.dependencies)
      ? { dependencies: item.dependencies.filter((d): d is string => typeof d === 'string') }
      : {}),
    ...(Array.isArray(item.evidence)
      ? { evidence: item.evidence.filter((e): e is string => typeof e === 'string') }
      : {}),
    ...(Array.isArray(item.requiredCapabilities)
      ? {
          requiredCapabilities: item.requiredCapabilities.filter(
            (c): c is string => typeof c === 'string',
          ),
        }
      : {}),
    ...(Array.isArray(item.requiredResourceKinds)
      ? {
          requiredResourceKinds: item.requiredResourceKinds.filter(
            (r): r is string => typeof r === 'string',
          ),
        }
      : {}),
    ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
    ...(storedSuccessCriteria.length > 0 ? { successCriteria: storedSuccessCriteria } : {}),
    ...(typeof item.blockedReason === 'string' ? { blockedReason: item.blockedReason } : {}),
  };
}

export function buildUpdateGoalsResult(params: {
  mutation: AgentGoalMutation;
  validationErrors: string[];
}): string {
  if (params.validationErrors.length > 0) {
    return JSON.stringify(
      {
        status: 'error',
        action: params.mutation.action,
        errors: params.validationErrors,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      status: 'ok',
      action: params.mutation.action,
      goals: params.mutation.goals.map((g) => ({
        ...(g.id ? { id: g.id } : {}),
        ...(g.title ? { title: g.title } : {}),
        ...(g.status ? { status: g.status } : {}),
        ...(g.completionPolicy ? { completionPolicy: g.completionPolicy } : {}),
      })),
    },
    null,
    2,
  );
}

export function parseUpdateGoalsArgs(args: Record<string, unknown>): {
  mutation: AgentGoalMutation;
  errors: string[];
} {
  const action = args.action;
  if (
    action !== 'add' &&
    action !== 'complete' &&
    action !== 'activate' &&
    action !== 'block' &&
    action !== 'remove' &&
    action !== 'update'
  ) {
    return {
      mutation: { action: 'add', goals: [] },
      errors: [
        `Invalid action: ${action}. Must be one of: add, complete, activate, block, remove, update.`,
      ],
    };
  }

  const parsedGoal = normalizeParsedGoal(args);
  if (!parsedGoal.id?.trim()) {
    return {
      mutation: { action, goals: [] },
      errors: ['id is required for update_goals. Provide the goal fields at the tool argument root.'],
    };
  }

  const mutation: AgentGoalMutation = {
    action,
    goals: [parsedGoal],
  };

  // Full validation happens in the outcome resolver where the actual goal state is available.
  return { mutation, errors: [] };
}

export function executeUpdateGoals(args: Record<string, unknown>): string {
  const parsed = parseUpdateGoalsArgs(args);
  return buildUpdateGoalsResult({
    mutation: parsed.mutation,
    validationErrors: parsed.errors,
  });
}
