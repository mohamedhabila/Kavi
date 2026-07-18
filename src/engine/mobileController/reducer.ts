import {
  MOBILE_CONTROLLER_CONTRACT_VERSION,
  type MobileControllerActionKind,
  type MobileControllerAuditEvent,
  type MobileControllerOutcome,
  type MobileControllerPendingHandoff,
} from './contracts';
import {
  mobileControllerOutcomesMatch,
  qualifyMobileControllerCapability,
  qualifyMobileControllerOutcome,
  qualifyMobileControllerPendingHandoff,
} from './validation';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface MobileControllerSettlement {
  readonly handoffId: string;
  readonly actionKind: MobileControllerActionKind;
  readonly actionDigest: MobileControllerPendingHandoff['actionDigest'];
  readonly outcome: MobileControllerOutcome;
  readonly requiresReconciliation: boolean;
  readonly automaticRetryAllowed: false;
  readonly settledAt: number;
}

export interface MobileControllerHandoffState {
  readonly version: typeof MOBILE_CONTROLLER_CONTRACT_VERSION;
  readonly executionRunId: string;
  readonly pending: MobileControllerPendingHandoff | null;
  readonly lastSettlement: MobileControllerSettlement | null;
  readonly updatedAt: number;
}

export const MOBILE_CONTROLLER_TRANSITION_REJECTION_REASONS = [
  'invalid_capability',
  'invalid_handoff',
  'invalid_outcome',
  'invalid_transition_time',
  'run_mismatch',
  'pending_handoff_exists',
  'terminal_identity_reused',
  'handoff_not_current',
  'stale_outcome',
  'handoff_mismatch',
  'controller_mismatch',
  'dispatch_identity_mismatch',
  'observation_mismatch',
  'outcome_time_mismatch',
  'expired_outcome',
  'conflicting_outcome',
] as const;
export type MobileControllerTransitionRejectionReason =
  (typeof MOBILE_CONTROLLER_TRANSITION_REJECTION_REASONS)[number];

export type MobileControllerTransitionResult =
  | Readonly<{
      kind: 'accepted';
      state: MobileControllerHandoffState;
      auditEvent: MobileControllerAuditEvent;
    }>
  | Readonly<{
      kind: 'replayed';
      state: MobileControllerHandoffState;
    }>
  | Readonly<{
      kind: 'rejected';
      reason: MobileControllerTransitionRejectionReason;
      state: MobileControllerHandoffState;
    }>;

function isExactId(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function reject(
  state: MobileControllerHandoffState,
  reason: MobileControllerTransitionRejectionReason,
): MobileControllerTransitionResult {
  return Object.freeze({ kind: 'rejected', reason, state });
}

export function createMobileControllerHandoffState(params: {
  executionRunId: string;
  now: number;
}): MobileControllerHandoffState {
  if (!isExactId(params.executionRunId, 256) || !isTimestamp(params.now)) {
    throw new Error('invalid_mobile_controller_state_identity');
  }
  return Object.freeze({
    version: MOBILE_CONTROLLER_CONTRACT_VERSION,
    executionRunId: params.executionRunId,
    pending: null,
    lastSettlement: null,
    updatedAt: params.now,
  });
}

function handoffReusesTerminalIdentity(
  handoff: MobileControllerPendingHandoff,
  settlement: MobileControllerSettlement | null,
): boolean {
  if (!settlement) return false;
  const prior = settlement.outcome;
  return (
    handoff.handoffId === settlement.handoffId ||
    handoff.dispatchIdentity.runId === prior.correlation.runId ||
    handoff.dispatchIdentity.effectId === prior.correlation.effectId ||
    handoff.dispatchIdentity.toolCallId === prior.correlation.toolCallId
  );
}

export function beginMobileControllerHandoff(params: {
  state: MobileControllerHandoffState;
  capability: unknown;
  handoff: unknown;
  acceptedAt: number;
}): MobileControllerTransitionResult {
  const { state } = params;
  if (!isTimestamp(params.acceptedAt) || params.acceptedAt < state.updatedAt) {
    return reject(state, 'invalid_transition_time');
  }
  const capability = qualifyMobileControllerCapability(params.capability);
  if (!capability) return reject(state, 'invalid_capability');
  const handoff = qualifyMobileControllerPendingHandoff(params.handoff, capability);
  if (!handoff) return reject(state, 'invalid_handoff');
  if (handoff.dispatchIdentity.executionRunId !== state.executionRunId) {
    return reject(state, 'run_mismatch');
  }
  if (state.pending) return reject(state, 'pending_handoff_exists');
  if (handoffReusesTerminalIdentity(handoff, state.lastSettlement)) {
    return reject(state, 'terminal_identity_reused');
  }
  if (handoff.createdAt > params.acceptedAt || params.acceptedAt >= handoff.expiresAt) {
    return reject(state, 'handoff_not_current');
  }

  const nextState = Object.freeze({
    ...state,
    pending: handoff,
    updatedAt: params.acceptedAt,
  });
  const identity = handoff.dispatchIdentity;
  const auditEvent = Object.freeze({
    type: 'mobile_controller_handoff_pending' as const,
    handoffId: handoff.handoffId,
    runId: identity.runId,
    executionRunId: identity.executionRunId,
    effectId: identity.effectId,
    toolCallId: identity.toolCallId,
    controllerId: handoff.controllerId,
    actionKind: handoff.action.kind,
    actionDigest: handoff.actionDigest,
    timestamp: params.acceptedAt,
  });
  return Object.freeze({ kind: 'accepted', state: nextState, auditEvent });
}

function outcomeMatchesController(
  outcome: MobileControllerOutcome,
  handoff: MobileControllerPendingHandoff,
): boolean {
  return (
    outcome.controllerId === handoff.controllerId &&
    outcome.capabilityDigest === handoff.capabilityDigest
  );
}

function outcomeMatchesDispatch(
  outcome: MobileControllerOutcome,
  handoff: MobileControllerPendingHandoff,
): boolean {
  const correlation = outcome.correlation;
  const identity = handoff.dispatchIdentity;
  return (
    correlation.runId === identity.runId &&
    correlation.effectId === identity.effectId &&
    correlation.executionRunId === identity.executionRunId &&
    correlation.toolCallId === identity.toolCallId
  );
}

function settlementRequiresReconciliation(outcome: MobileControllerOutcome): boolean {
  return (
    outcome.effectState === 'unknown' ||
    (outcome.effectState === 'applied' && outcome.verificationState !== 'verified')
  );
}

function settleAuditEvent(
  handoff: MobileControllerPendingHandoff,
  outcome: MobileControllerOutcome,
  settledAt: number,
): MobileControllerAuditEvent {
  const identity = handoff.dispatchIdentity;
  return Object.freeze({
    type: 'mobile_controller_outcome_settled',
    handoffId: handoff.handoffId,
    outcomeId: outcome.outcomeId,
    runId: identity.runId,
    executionRunId: identity.executionRunId,
    effectId: identity.effectId,
    toolCallId: identity.toolCallId,
    controllerId: handoff.controllerId,
    actionKind: handoff.action.kind,
    actionDigest: handoff.actionDigest,
    executionState: outcome.executionState,
    effectState: outcome.effectState,
    verificationState: outcome.verificationState,
    observableDelta: outcome.observableDelta,
    timestamp: settledAt,
  });
}

export function settleMobileControllerHandoff(params: {
  state: MobileControllerHandoffState;
  outcome: unknown;
  receivedAt: number;
}): MobileControllerTransitionResult {
  const { state } = params;
  if (!isTimestamp(params.receivedAt) || params.receivedAt < state.updatedAt) {
    return reject(state, 'invalid_transition_time');
  }
  const outcome = qualifyMobileControllerOutcome(params.outcome);
  if (!outcome) return reject(state, 'invalid_outcome');

  if (state.lastSettlement?.handoffId === outcome.handoffId) {
    return mobileControllerOutcomesMatch(state.lastSettlement.outcome, outcome)
      ? Object.freeze({ kind: 'replayed', state })
      : reject(state, 'conflicting_outcome');
  }

  const handoff = state.pending;
  if (!handoff) return reject(state, 'stale_outcome');
  if (outcome.handoffId !== handoff.handoffId) return reject(state, 'handoff_mismatch');
  if (!outcomeMatchesController(outcome, handoff)) return reject(state, 'controller_mismatch');
  if (!outcomeMatchesDispatch(outcome, handoff)) {
    return reject(state, 'dispatch_identity_mismatch');
  }
  if (outcome.beforeObservationId !== handoff.beforeObservation.observationId) {
    return reject(state, 'observation_mismatch');
  }
  if (outcome.observedAt < handoff.createdAt || outcome.observedAt > params.receivedAt) {
    return reject(state, 'outcome_time_mismatch');
  }
  if (params.receivedAt >= handoff.expiresAt) return reject(state, 'expired_outcome');

  const settlement = Object.freeze({
    handoffId: handoff.handoffId,
    actionKind: handoff.action.kind,
    actionDigest: handoff.actionDigest,
    outcome,
    requiresReconciliation: settlementRequiresReconciliation(outcome),
    automaticRetryAllowed: false as const,
    settledAt: params.receivedAt,
  });
  const nextState = Object.freeze({
    ...state,
    pending: null,
    lastSettlement: settlement,
    updatedAt: params.receivedAt,
  });
  return Object.freeze({
    kind: 'accepted',
    state: nextState,
    auditEvent: settleAuditEvent(handoff, outcome, params.receivedAt),
  });
}
