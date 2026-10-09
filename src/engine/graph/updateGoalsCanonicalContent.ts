// ---------------------------------------------------------------------------
// Kavi — Canonical update_goals result content
// ---------------------------------------------------------------------------
// The JSON an update_goals call is answered with once the graph has decided its
// outcome: the goal state that is actually true, the errors in typed form, and a
// repair contract the model can act on. Extracted from
// toolExecutionOutcomeCanonicalization.ts, which decides the outcome.
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';
import { formatModelAuthoredSuccessCriteriaFormsDescription } from '../goals/completionEvidence';
import { findUnmetCompletionCriteria } from '../goals/completionRefusalMessage';
import type { UpdateGoalsArgumentError } from '../tools/toolGoalExecution';
import { buildCanonicalGoalResult } from './canonicalGoalResult';

/**
 * Compact goal state for a rejected mutation.
 *
 * A rejection needs to tell the model what is actually true so it can adapt instead of
 * retrying against a stale picture — but it does not need the evidence itself. Evidence
 * entries are effect receipts, roughly a kilobyte of digests each, and echoing the full
 * array back on every rejection inflated error responses enough to dominate a run's
 * token cost. Status and the criteria still outstanding are what the model can act on.
 */
function buildRejectedMutationGoalState(goal: AgentGoal): Record<string, unknown> {
  const unmetCriteria = findUnmetCompletionCriteria(goal);
  return {
    id: goal.id,
    status: goal.status,
    completionPolicy: goal.completionPolicy,
    evidenceCount: goal.evidence.length,
    ...(unmetCriteria.length ? { unmetCriteria } : {}),
    ...(goal.blockedReason ? { blockedReason: goal.blockedReason } : {}),
  };
}

export const GOALLESS_UPDATE_GOALS_NOTE =
  'This call named no goal, so nothing was recorded. Each action you take records its own ' +
  'completion evidence, so continue with the task. To track a multi-step task, send ' +
  'update_goals with the goal itself: id, name, completionPolicy, and successCriteria.';

export function buildCanonicalUpdateGoalsContent(params: {
  status: 'ok' | 'error';
  action?: string;
  goals?: ReadonlyArray<AgentGoal>;
  errors?: ReadonlyArray<string>;
  structuredErrors?: ReadonlyArray<Record<string, unknown>>;
  attemptedArguments?: unknown;
  note?: string;
}): string {
  const repair = buildUpdateGoalsRepair(params);
  return JSON.stringify(
    {
      status: params.status,
      ...(params.action ? { action: params.action } : {}),
      ...(params.note ? { note: params.note } : {}),
      ...(params.goals
        ? {
            goals: params.goals.map(
              params.status === 'error' ? buildRejectedMutationGoalState : buildCanonicalGoalResult,
            ),
          }
        : {}),
      ...(params.errors ? { errors: params.errors } : {}),
      ...(params.structuredErrors ? { structuredErrors: params.structuredErrors } : {}),
      ...(repair ? { repair } : {}),
    },
    null,
    2,
  );
}

export function serializeParsedUpdateGoalsErrors(
  errors: ReadonlyArray<UpdateGoalsArgumentError>,
  args: unknown,
): Array<Record<string, unknown>> {
  const goalId =
    args && typeof args === 'object' && typeof (args as Record<string, unknown>).id === 'string'
      ? ((args as Record<string, unknown>).id as string).trim()
      : '';
  return errors.map((error) => ({
    ...(goalId ? { goalId } : {}),
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
    message: error.message,
  }));
}

function buildUpdateGoalsRepair(params: {
  status: 'ok' | 'error';
  action?: string;
  structuredErrors?: ReadonlyArray<Record<string, unknown>>;
  attemptedArguments?: unknown;
}): Record<string, unknown> | undefined {
  if (params.status !== 'error') {
    return undefined;
  }

  const codes = new Set(
    (params.structuredErrors ?? [])
      .map((entry) => (typeof entry.code === 'string' ? entry.code.trim() : ''))
      .filter(Boolean),
  );
  const code = Array.from(codes)[0];
  const attemptedArguments =
    params.attemptedArguments &&
    typeof params.attemptedArguments === 'object' &&
    !Array.isArray(params.attemptedArguments)
      ? (params.attemptedArguments as Record<string, unknown>)
      : undefined;
  const attemptedSuccessCriteria = Array.isArray(attemptedArguments?.successCriteria)
    ? attemptedArguments.successCriteria.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
  const hasSuccessCriteriaError =
    codes.has('missing_success_criteria') ||
    codes.has('weak_success_criteria') ||
    codes.has('invalid_success_criteria');
  const goalWasNotFound = codes.has('goal_not_found');
  const missingFields = [
    ...(codes.has('missing_title') ? ['name'] : []),
    ...(codes.has('missing_completion_policy') ? ['completionPolicy'] : []),
    ...(codes.has('missing_success_criteria') ? ['successCriteria'] : []),
  ];
  const invalidFields = hasSuccessCriteriaError ? ['successCriteria'] : [];
  const missingFieldLocations = buildGoalMissingFieldLocations(params.structuredErrors);
  const action = params.action ?? 'add';
  const expectedShape =
    action === 'add'
      ? {
          action: 'add',
          id: '<stable-goal-id>',
          name: '<visible-goal-name>',
          completionPolicy: 'blocking|persistent',
          status: 'pending|active',
          ...(hasSuccessCriteriaError
            ? { successCriteria: ['<specific-structural-success-criterion>'] }
            : {}),
        }
      : {
          action,
          id: '<existing-goal-id>',
        };

  return {
    retryable: true,
    ...(code ? { code } : {}),
    sideEffectApplied: false,
    expectedShape,
    fieldPlacement: 'Put goal fields at the root of the update_goals arguments object.',
    valueSource:
      'Replace angle-bracket templates with exact values from the user request, current goals, or prior tool results; never send template text literally.',
    ...(missingFields.length > 0 ? { missingFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    ...(missingFieldLocations.length > 0 ? { missingFieldLocations } : {}),
    ...(missingFieldLocations.length > 0
      ? { retryTemplate: buildGoalRetrySkeleton(action, missingFieldLocations) }
      : {}),
    ...(hasSuccessCriteriaError
      ? {
          successCriteriaContract: {
            acceptedForms: formatModelAuthoredSuccessCriteriaFormsDescription(),
            specificityRule:
              'A blocking goal needs at least one specific criterion; evidence.min and evidence.count may supplement it but cannot stand alone.',
            workspaceArtifactRule:
              'For each required workspace file use evidence.artifact:<exact-workspace-relative-path>. Never use evidence.prefix:artifact.',
            prefixRule:
              'evidence.prefix:<token> accepts only a registered tool evidence source or the registered worker prefix.',
          },
          ...(attemptedSuccessCriteria.length > 0 ? { attemptedSuccessCriteria } : {}),
        }
      : {}),
    ...(goalWasNotFound
      ? {
          goalNotFoundRepair: {
            instruction:
              'This mutation was not applied. If this id belongs to a new goal or an earlier add failed, retry with action add and the full add fields. Otherwise retry the intended action with an id from the current goal graph.',
            addShape: {
              action: 'add',
              id: '<stable-goal-id>',
              name: '<visible-goal-name>',
              completionPolicy: 'blocking|persistent',
              status: 'pending|active',
              successCriteria: ['<required-for-blocking-only>'],
            },
          },
        }
      : {}),
  };
}

function buildGoalMissingFieldLocations(
  structuredErrors: ReadonlyArray<Record<string, unknown>> | undefined,
): Array<{ goalId: string; field: string; path: string }> {
  const locations: Array<{ goalId: string; field: string; path: string }> = [];
  for (const error of structuredErrors ?? []) {
    const goalId = typeof error.goalId === 'string' ? error.goalId.trim() : '';
    if (!goalId) {
      continue;
    }

    if (error.code === 'missing_title') {
      locations.push({ goalId, field: 'name', path: 'name' });
    }
    if (error.code === 'missing_completion_policy') {
      locations.push({
        goalId,
        field: 'completionPolicy',
        path: 'completionPolicy',
      });
    }
    if (error.code === 'missing_success_criteria') {
      locations.push({
        goalId,
        field: 'successCriteria',
        path: 'successCriteria',
      });
    }
  }
  return locations;
}

function buildGoalRetrySkeleton(
  action: string,
  locations: ReadonlyArray<{ goalId: string; field: string }>,
): Record<string, unknown> {
  const skeleton: Record<string, unknown> = { action };
  for (const location of locations) {
    if (!skeleton.id) {
      skeleton.id = location.goalId;
    }
    if (location.field === 'name') {
      skeleton.name = '<visible-goal-name>';
    }
    if (location.field === 'completionPolicy') {
      skeleton.completionPolicy = 'blocking|persistent';
    }
    if (location.field === 'successCriteria') {
      skeleton.successCriteria = ['<structural-success-criterion>'];
    }
  }
  return skeleton;
}
