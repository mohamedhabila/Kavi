import type { ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';
import type {
  MobileControllerAction,
  MobileControllerCapability,
  MobileControllerObservationRef,
} from './contracts';
import {
  mobileControllerActionReferencesObservation,
  qualifyMobileControllerAction,
  qualifyMobileControllerCapability,
  qualifyMobileControllerObservationRef,
} from './validation';

export interface MobileControllerDeferredExecution {
  readonly kind: 'mobile_controller_handoff_requested';
  readonly capability: MobileControllerCapability;
  readonly action: MobileControllerAction;
  readonly beforeObservation: MobileControllerObservationRef;
  readonly approvalRequest?: Readonly<{
    title: string;
    description: string;
  }>;
}

export type ToolRuntimeExecution = ToolRuntimeOutcome | MobileControllerDeferredExecution;

const CODE_OWNED_DEFERRED_EXECUTIONS = new WeakSet<object>();

export function buildMobileControllerDeferredExecution(input: {
  capability: unknown;
  action: unknown;
  beforeObservation: unknown;
}): MobileControllerDeferredExecution | null {
  const capability = qualifyMobileControllerCapability(input.capability);
  const action = capability ? qualifyMobileControllerAction(input.action, capability) : null;
  const beforeObservation = qualifyMobileControllerObservationRef(input.beforeObservation);
  if (
    !capability ||
    !action ||
    !beforeObservation ||
    !mobileControllerActionReferencesObservation(action, beforeObservation.observationId)
  ) {
    return null;
  }
  const deferred = Object.freeze({
    kind: 'mobile_controller_handoff_requested' as const,
    capability,
    action,
    beforeObservation,
  });
  CODE_OWNED_DEFERRED_EXECUTIONS.add(deferred);
  return deferred;
}

export function isMobileControllerDeferredExecution(
  candidate: ToolRuntimeExecution,
): candidate is MobileControllerDeferredExecution {
  return (
    'kind' in candidate &&
    candidate.kind === 'mobile_controller_handoff_requested' &&
    CODE_OWNED_DEFERRED_EXECUTIONS.has(candidate)
  );
}

export function attachMobileControllerApprovalRequest(
  deferred: MobileControllerDeferredExecution,
  approvalRequest: Readonly<{ title: string; description: string }>,
): MobileControllerDeferredExecution {
  if (!CODE_OWNED_DEFERRED_EXECUTIONS.has(deferred)) {
    throw new Error('mobile_controller_deferred_execution_untrusted');
  }
  const reviewed = Object.freeze({
    ...deferred,
    approvalRequest: Object.freeze({
      title: approvalRequest.title,
      description: approvalRequest.description,
    }),
  });
  CODE_OWNED_DEFERRED_EXECUTIONS.add(reviewed);
  return reviewed;
}
