import { failedToolOutcome } from '../../types/toolRuntimeOutcome';
import type { ToolRuntimeExecution } from './runtimeExecution';
import { buildMobileControllerDeferredExecution } from './runtimeExecution';
import { attachMobileControllerApprovalRequest } from './runtimeExecution';
import {
  qualifyMobileControllerActionReview,
  type MobileControllerExecutionBinding,
} from './runtimeBinding';

function failure(
  code: string,
  error: string,
  repair?: Readonly<Record<string, unknown>>,
): ToolRuntimeExecution {
  return failedToolOutcome(
    JSON.stringify({
      status: 'error',
      code,
      error,
      retryable: code === 'action_invalid' || code === 'arguments_invalid',
      ...(repair ? { repair } : {}),
    }),
  );
}

export async function executeMobileControllerTool(
  argumentsText: string,
  binding: MobileControllerExecutionBinding | undefined,
): Promise<ToolRuntimeExecution> {
  if (!binding) {
    return failure('controller_unavailable', 'No admitted mobile controller is bound.');
  }
  let action: unknown;
  try {
    action = argumentsText ? JSON.parse(argumentsText) : {};
  } catch {
    return failure('arguments_invalid', 'The mobile action arguments are not valid JSON.');
  }
  const deferred = buildMobileControllerDeferredExecution({
    capability: binding.capability,
    action,
    beforeObservation: binding.currentObservation,
  });
  if (!deferred) {
    return failure('action_invalid', 'The action is invalid for the current capability.', {
      supportedActionKinds: [...binding.capability.supportedActionKinds],
      currentObservationId: binding.currentObservation.observationId,
      normalizedCoordinateRange: {
        minimum: 0,
        maximum: binding.capability.normalizedCoordinateScale - 1,
      },
    });
  }
  if (binding.capability.environmentClass === 'sandbox') return deferred;

  let reviewCandidate: unknown;
  try {
    reviewCandidate = await binding.reviewAction?.({
      action: deferred.action,
      currentObservation: deferred.beforeObservation,
    });
  } catch {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: 'controller_action_review_unavailable',
        error: 'The controller action policy could not review this action.',
        retryable: false,
      }),
      'controller_action_review_unavailable',
    );
  }
  const review = qualifyMobileControllerActionReview(reviewCandidate);
  if (!review) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: 'controller_action_review_unavailable',
        error: 'The controller action policy returned an invalid decision.',
        retryable: false,
      }),
      'controller_action_review_unavailable',
    );
  }
  if (review.kind === 'takeover') {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: 'user_takeover_required',
        title: review.title,
        message: review.description,
        retryable: false,
      }),
      'user_takeover_required',
    );
  }
  return review.kind === 'confirm'
    ? attachMobileControllerApprovalRequest(deferred, review)
    : deferred;
}
