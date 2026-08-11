// ---------------------------------------------------------------------------
// Kavi — Goal Tool Execution
// ---------------------------------------------------------------------------
// The update_goals tool is a meta-tool: the actual graph-state mutation is
// applied by the tool execution outcome resolver so the graph snapshot remains
// the single source of truth. This executor only validates arguments and
// returns a preview that the resolver uses.
// ---------------------------------------------------------------------------

import {
  CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
  normalizeGoalCompletionPolicy,
  type AgentGoal,
  type AgentGoalMutation,
  type AgentGoalStatus,
} from '../goals/types';
import {
  areGoalSuccessCriteriaSatisfied,
  describeCriterionSatisfactionAction,
  isSuccessCriterionMet,
  resolveGatingSuccessCriteria,
} from '../goals/completionEvidence';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

const ALLOWED_UPDATE_GOALS_ROOT_FIELDS = new Set([
  'action',
  'blockedReason',
  'completionPolicy',
  'dependencies',
  'description',
  // Present on a batched call; an empty array falls through to the single-goal path.
  'goals',
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
    if (field !== 'action' && field !== 'id' && normalized[field] === null) {
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

function validateUpdateGoalsRootShape(
  args: Record<string, unknown>,
  action: AgentGoalMutation['action'],
): UpdateGoalsArgumentError[] {
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
  if (action === 'add' && (typeof args.name !== 'string' || !args.name.trim())) {
    return [
      argumentError(
        'missing_title',
        'name is required when adding a goal and must be a non-empty string.',
        'name',
      ),
    ];
  }
  if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) {
    return [
      argumentError('invalid_field_type', 'name must be a non-empty string when supplied.', 'name'),
    ];
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (args[field] !== undefined && typeof args[field] !== 'string') {
      return [
        argumentError('invalid_field_type', `${field} must be a string when supplied.`, field),
      ];
    }
  }
  if (args.owner === CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER) {
    return [
      argumentError(
        'provider_owned_field',
        'This goal owner is reserved for code-owned effect completion bookkeeping.',
        'owner',
      ),
    ];
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

/**
 * What a `complete` request will actually do, reported back to the model.
 *
 * Traced live on an Android emulator. `complete` answered `{"status":"ok"}` whether or
 * not the goal closed, because the result echoed the requested mutation and nothing else.
 * A goal whose success criteria were unmet stayed open, the model read "ok", saw the goal
 * still active, and asked again — six times across one run, interleaved with `activate`
 * calls trying to shake it loose. The loop detector eventually ended the run for
 * "update_goals calls without goal state change".
 *
 * Nothing was refused and nothing was broken; the model was simply told the wrong thing.
 * So the result now states whether the goal closes and, when it does not, which criteria
 * are outstanding and the action that satisfies each — a move, not just a verdict.
 */
function describeCompletionOutcome(
  goalId: string,
  graphGoals: ReadonlyArray<AgentGoal>,
): Record<string, unknown> | null {
  const goal = graphGoals.find((entry) => entry.id === goalId);
  if (!goal) {
    return null;
  }

  if (areGoalSuccessCriteriaSatisfied(goal)) {
    return { closes: true };
  }

  const criteria = goal.successCriteria ?? [];
  const unmet = (criteria.length > 0 ? resolveGatingSuccessCriteria(criteria) : []).filter(
    (criterion) => !isSuccessCriterionMet(goal, criterion),
  );

  return {
    closes: false,
    reason:
      criteria.length === 0
        ? 'This goal has recorded no evidence yet, so completing it has no effect.'
        : 'Success criteria are not satisfied, so this goal stays open.',
    unmetCriteria: unmet.map((criterion) => {
      const action = describeCriterionSatisfactionAction(criterion);
      return action ? { criterion, satisfyBy: action } : { criterion };
    }),
    nextStep:
      'Produce the missing evidence with the relevant tool, or call update_goals with ' +
      'action "update" to correct successCriteria. Repeating this complete call changes nothing.',
  };
}

/**
 * The goals this mutation moves back to pending, when it activates something.
 *
 * Exactly one goal is active per owner lane, so activating a goal demotes whichever goal
 * was active there. Nothing said so, and the silence was expensive.
 *
 * Traced live on an Android emulator. The model declared a four-step plan with every step
 * `status: "active"`, which leaves only the last one active:
 *
 *   add [g1, g2, g3] all active  ->  g1=pending g2=pending g3=active
 *   activate g1                  ->  g1=active  g2=pending g3=pending
 *
 * It then spent twelve update_goals calls on four goals, re-activating each step as it
 * reached it and demoting another every time. Reporting the demotion turns a silent rule
 * into an observable one, so the plan can be written the way the graph actually works.
 */
function describeGoalsDemotedByActivation(params: {
  mutation: AgentGoalMutation;
  graphGoals?: ReadonlyArray<AgentGoal>;
}): Record<string, unknown> | null {
  const graphGoals = params.graphGoals;
  if (!graphGoals?.length) {
    return null;
  }

  const activatedIds = params.mutation.goals
    .filter(
      (goal) =>
        params.mutation.action === 'activate' ||
        (goal.status === 'active' &&
          (params.mutation.action === 'add' || params.mutation.action === 'update')),
    )
    .map((goal) => goal.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (activatedIds.length === 0) {
    return null;
  }

  const lanesActivated = new Set(
    activatedIds.map((id) => graphGoals.find((goal) => goal.id === id)?.owner?.trim() || 'supervisor'),
  );
  const demotedIds = graphGoals
    .filter(
      (goal) =>
        goal.status === 'active' &&
        !activatedIds.includes(goal.id) &&
        lanesActivated.has(goal.owner?.trim() || 'supervisor'),
    )
    .map((goal) => goal.id);

  const extraActivations = activatedIds.length > 1 ? activatedIds.slice(0, -1) : [];
  if (demotedIds.length === 0 && extraActivations.length === 0) {
    return null;
  }

  return {
    ...(demotedIds.length > 0 ? { movedToPending: demotedIds } : {}),
    ...(extraActivations.length > 0 ? { notActivated: extraActivations } : {}),
    reason:
      'One goal is active at a time per owner. Activating a goal moves the previously ' +
      'active one back to pending, and marking several goals active in one call leaves ' +
      'only the last of them active.',
    nextStep:
      'Keep later steps pending and advance the plan by completing the active goal and ' +
      'activating the next in the same call.',
  };
}

export function buildUpdateGoalsResult(params: {
  mutation: AgentGoalMutation;
  validationErrors: ReadonlyArray<UpdateGoalsArgumentError>;
  graphGoals?: ReadonlyArray<AgentGoal>;
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

  const demoted = describeGoalsDemotedByActivation({
    mutation: params.mutation,
    graphGoals: params.graphGoals,
  });

  return JSON.stringify(
    {
      status: 'ok',
      action: params.mutation.action,
      ...(demoted ? { activationSideEffect: demoted } : {}),
      goals: params.mutation.goals.map((g) => {
        const completion =
          params.mutation.action === 'complete' && g.id && params.graphGoals
            ? describeCompletionOutcome(g.id, params.graphGoals)
            : null;

        return {
          ...(g.id ? { id: g.id } : {}),
          ...(g.title ? { title: g.title } : {}),
          ...(g.status ? { status: g.status } : {}),
          ...(g.completionPolicy ? { completionPolicy: g.completionPolicy } : {}),
          ...(completion ?? {}),
        };
      }),
    },
    null,
    2,
  );
}

/**
 * Whether this call declares several goals at once under one shared action.
 *
 * The graph has always applied `AgentGoalMutation.goals` as an array; only this tool's
 * arguments were flat, so one call could carry exactly one goal. Every additional goal,
 * and every lifecycle transition, therefore cost its own round-trip — traced on-device as
 * three calls to open a two-goal plan (add, activate, add) and six more to close it.
 * Batching removes the calls without changing what the graph does with them.
 */
function readBatchedGoalEntries(args: Record<string, unknown>): Record<string, unknown>[] | null {
  const entries = args.goals;
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  return entries.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

export function parseUpdateGoalsArgs(args: Record<string, unknown>): {
  mutation: AgentGoalMutation;
  errors: UpdateGoalsArgumentError[];
} {
  const batchedEntries = readBatchedGoalEntries(args);
  if (batchedEntries) {
    const sharedAction = args.action;
    const parsedEntries = batchedEntries.map((entry) =>
      parseUpdateGoalsArgs({
        // A per-goal action wins, so one call can still be uniform without repeating it.
        ...(sharedAction === undefined ? {} : { action: sharedAction }),
        ...entry,
      }),
    );
    const errors = parsedEntries.flatMap((entry) => entry.errors);
    const resolvedAction = parsedEntries[0]?.mutation.action ?? 'add';
    if (errors.length > 0) {
      return { mutation: { action: resolvedAction, goals: [] }, errors };
    }
    return {
      mutation: {
        action: resolvedAction,
        goals: parsedEntries.flatMap((entry) => entry.mutation.goals),
      },
      errors: [],
    };
  }

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
  const shapeErrors = validateUpdateGoalsRootShape(normalizedArgs, action);
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
  const parsedGoal = normalizeParsedGoal(normalizedArgs, constraints.retain);

  const mutation: AgentGoalMutation = {
    action,
    goals: [parsedGoal],
  };

  // Full validation happens in the outcome resolver where the actual goal state is available.
  return { mutation, errors: [] };
}

export function executeUpdateGoals(
  args: Record<string, unknown>,
  graphGoals?: ReadonlyArray<AgentGoal>,
): ToolRuntimeOutcome {
  const parsed = parseUpdateGoalsArgs(args);
  const content = buildUpdateGoalsResult({
    mutation: parsed.mutation,
    validationErrors: parsed.errors,
    ...(graphGoals ? { graphGoals } : {}),
  });
  return parsed.errors.length > 0 ? failedToolOutcome(content) : completedToolOutcome(content);
}
