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
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { normalizeGoalCompletionPolicy, type AgentGoalStatus } from '../goals/types';

const ALLOWED_UPDATE_GOALS_ROOT_FIELDS = new Set([
  'action',
  'blockedReason',
  'completionPolicy',
  'dependencies',
  'description',
  'id',
  'name',
  'owner',
  'requiredCapabilities',
  'requiredResourceKinds',
  'retainCurrentUserConstraint',
  'status',
  'successCriteria',
]);

const OPTIONAL_STRING_FIELDS = ['blockedReason', 'description', 'owner'] as const;
const OPTIONAL_STRING_LIST_FIELDS = [
  'dependencies',
  'requiredCapabilities',
  'requiredResourceKinds',
  'successCriteria',
] as const;

export type UpdateGoalsArgumentErrorCode =
  | 'invalid_action'
  | 'unsupported_field'
  | 'missing_id'
  | 'missing_title'
  | 'invalid_field_type'
  | 'invalid_status'
  | 'invalid_completion_policy'
  | 'provider_owned_field'
  | 'invalid_user_constraint_retention'
  | 'invalid_lifecycle'
  | 'invalid_success_criteria';

export type UpdateGoalsArgumentError = Readonly<{
  code: UpdateGoalsArgumentErrorCode;
  message: string;
  field?: string;
}>;

function argumentError(
  code: UpdateGoalsArgumentErrorCode,
  message: string,
  field?: string,
): UpdateGoalsArgumentError {
  return { code, message, ...(field ? { field } : {}) };
}

function omitAdapterNullOptionals(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  for (const field of ALLOWED_UPDATE_GOALS_ROOT_FIELDS) {
    if (field !== 'action' && field !== 'id' && field !== 'name' && normalized[field] === null) {
      delete normalized[field];
    }
  }
  return normalized;
}

function readStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]).slice() : undefined;
}

function parseGoalStatus(value: unknown): AgentGoalStatus | undefined {
  return value === 'pending' || value === 'active' || value === 'completed' || value === 'blocked'
    ? value
    : undefined;
}

function normalizeParsedGoal(
  item: Record<string, unknown>,
  retainCurrentUserConstraint: true | undefined,
): AgentGoalMutation['goals'][number] {
  const completionPolicy = normalizeGoalCompletionPolicy(item.completionPolicy);
  const explicitTitle = typeof item.name === 'string' ? item.name : undefined;
  const status = parseGoalStatus(item.status);
  const successCriteria = readStringList(item.successCriteria);

  return {
    ...(typeof item.id === 'string' ? { id: item.id } : {}),
    ...(explicitTitle ? { title: explicitTitle } : {}),
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    ...(status ? { status } : {}),
    ...(completionPolicy ? { completionPolicy } : {}),
    ...(readStringList(item.dependencies) !== undefined
      ? { dependencies: readStringList(item.dependencies) }
      : {}),
    ...(readStringList(item.requiredCapabilities) !== undefined
      ? { requiredCapabilities: readStringList(item.requiredCapabilities) }
      : {}),
    ...(readStringList(item.requiredResourceKinds) !== undefined
      ? { requiredResourceKinds: readStringList(item.requiredResourceKinds) }
      : {}),
    ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
    ...(successCriteria !== undefined ? { successCriteria } : {}),
    ...(retainCurrentUserConstraint ? { retainCurrentUserConstraint } : {}),
    ...(typeof item.blockedReason === 'string' ? { blockedReason: item.blockedReason } : {}),
  };
}

function validateUpdateGoalsRootShape(args: Record<string, unknown>): UpdateGoalsArgumentError[] {
  const unknownFields = Object.keys(args).filter(
    (field) => !ALLOWED_UPDATE_GOALS_ROOT_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    return [
      argumentError(
        'unsupported_field',
        `Unsupported update_goals field(s): ${unknownFields.sort().join(', ')}.`,
        unknownFields.sort()[0],
      ),
    ];
  }
  if (typeof args.id !== 'string' || !args.id.trim()) {
    return [
      argumentError(
        'missing_id',
        'id is required for update_goals and must be a non-empty string.',
        'id',
      ),
    ];
  }
  if (typeof args.name !== 'string' || !args.name.trim()) {
    return [
      argumentError(
        'missing_title',
        'name is required for update_goals and must be a non-empty string.',
        'name',
      ),
    ];
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (args[field] !== undefined && typeof args[field] !== 'string') {
      return [
        argumentError(
          'invalid_field_type',
          `${field} must be a string when supplied.`,
          field,
        ),
      ];
    }
  }
  for (const field of OPTIONAL_STRING_LIST_FIELDS) {
    if (
      args[field] !== undefined &&
      (!Array.isArray(args[field]) ||
        !(args[field] as unknown[]).every((entry) => typeof entry === 'string'))
    ) {
      return [
        argumentError(
          'invalid_field_type',
          `${field} must be an array containing only strings.`,
          field,
        ),
      ];
    }
  }
  if (args.status !== undefined && parseGoalStatus(args.status) === undefined) {
    return [
      argumentError(
        'invalid_status',
        'status must be one of: pending, active, completed, blocked.',
        'status',
      ),
    ];
  }
  if (
    args.completionPolicy !== undefined &&
    normalizeGoalCompletionPolicy(args.completionPolicy) === undefined
  ) {
    return [
      argumentError(
        'invalid_completion_policy',
        'completionPolicy must be either blocking or persistent.',
        'completionPolicy',
      ),
    ];
  }
  return [];
}

function parseUserConstraintRetention(params: {
  args: Record<string, unknown>;
  action: AgentGoalMutation['action'];
  completionPolicy: AgentGoalMutation['goals'][number]['completionPolicy'];
}): { retain?: true; errors: UpdateGoalsArgumentError[] } {
  for (const unsupported of [
    'userConstraints',
    'sourceMessageId',
    'userConstraintTexts',
    'groundedUserConstraints',
    'userConstraintIntegrity',
    'userConstraintDeliveryPending',
  ]) {
    if (Object.prototype.hasOwnProperty.call(params.args, unsupported)) {
      return {
        errors: [
          argumentError(
            'provider_owned_field',
            `${unsupported} is unsupported. Supply only retainCurrentUserConstraint: true; source identity and retained text are code-owned.`,
            unsupported,
          ),
        ],
      };
    }
  }
  if (!Object.prototype.hasOwnProperty.call(params.args, 'retainCurrentUserConstraint')) {
    return { errors: [] };
  }
  if (params.args.retainCurrentUserConstraint !== true) {
    return {
      errors: [
        argumentError(
          'invalid_user_constraint_retention',
          'retainCurrentUserConstraint must be true when supplied.',
          'retainCurrentUserConstraint',
        ),
      ],
    };
  }
  if (params.action !== 'add' && params.action !== 'update') {
    return {
      errors: [
        argumentError(
          'invalid_user_constraint_retention',
          'retainCurrentUserConstraint is supported only for add or update actions on blocking goals.',
          'retainCurrentUserConstraint',
        ),
      ],
    };
  }
  if (params.args.status === 'completed') {
    return {
      errors: [
        argumentError(
          'invalid_lifecycle',
          'Completed goals cannot retain the current user statement.',
          'status',
        ),
      ],
    };
  }
  if (params.completionPolicy === 'persistent') {
    return {
      errors: [
        argumentError(
          'invalid_user_constraint_retention',
          'Persistent goals cannot retain current user constraint statements.',
          'completionPolicy',
        ),
      ],
    };
  }
  if (params.action === 'add' && params.completionPolicy !== 'blocking') {
    return {
      errors: [
        argumentError(
          'invalid_user_constraint_retention',
          'retainCurrentUserConstraint on add requires completionPolicy "blocking".',
          'completionPolicy',
        ),
      ],
    };
  }
  return { retain: true, errors: [] };
}

export function buildUpdateGoalsResult(params: {
  mutation: AgentGoalMutation;
  validationErrors: ReadonlyArray<UpdateGoalsArgumentError>;
}): string {
  if (params.validationErrors.length > 0) {
    return JSON.stringify(
      {
        status: 'error',
        action: params.mutation.action,
        errors: params.validationErrors.map((error) => error.message),
        structuredErrors: params.validationErrors,
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
  errors: UpdateGoalsArgumentError[];
} {
  const normalizedArgs = omitAdapterNullOptionals(args);
  const action = normalizedArgs.action;
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
        argumentError(
          'invalid_action',
          `Invalid action: ${action}. Must be one of: add, complete, activate, block, remove, update.`,
          'action',
        ),
      ],
    };
  }

  const completionPolicy = normalizeGoalCompletionPolicy(normalizedArgs.completionPolicy);
  if (Object.prototype.hasOwnProperty.call(normalizedArgs, 'evidence')) {
    return {
      mutation: { action, goals: [] },
      errors: [
        argumentError(
          'provider_owned_field',
          'evidence is code-owned and cannot be supplied by update_goals.',
          'evidence',
        ),
      ],
    };
  }
  const constraints = parseUserConstraintRetention({
    args: normalizedArgs,
    action,
    completionPolicy,
  });
  if (constraints.errors.length > 0) {
    return { mutation: { action, goals: [] }, errors: constraints.errors };
  }
  const shapeErrors = validateUpdateGoalsRootShape(normalizedArgs);
  if (shapeErrors.length > 0) {
    return { mutation: { action, goals: [] }, errors: shapeErrors };
  }
  if (completionPolicy === 'persistent' && normalizedArgs.successCriteria !== undefined) {
    return {
      mutation: { action, goals: [] },
      errors: [
        argumentError(
          'invalid_success_criteria',
          'Persistent goals must omit successCriteria.',
          'successCriteria',
        ),
      ],
    };
  }
  if ((action === 'add' || action === 'update') && normalizedArgs.status === 'completed') {
    return {
      mutation: { action, goals: [] },
      errors: [
        argumentError(
          'invalid_lifecycle',
          'Use action "complete" for the canonical goal completion transition.',
          'status',
        ),
      ],
    };
  }
  const parsedGoal = normalizeParsedGoal(normalizedArgs, constraints.retain);

  const mutation: AgentGoalMutation = {
    action,
    goals: [parsedGoal],
  };

  // Full validation happens in the outcome resolver where the actual goal state is available.
  return { mutation, errors: [] };
}

export function executeUpdateGoals(args: Record<string, unknown>): ToolRuntimeOutcome {
  const parsed = parseUpdateGoalsArgs(args);
  const content = buildUpdateGoalsResult({
    mutation: parsed.mutation,
    validationErrors: parsed.errors,
  });
  return parsed.errors.length > 0 ? failedToolOutcome(content) : completedToolOutcome(content);
}
