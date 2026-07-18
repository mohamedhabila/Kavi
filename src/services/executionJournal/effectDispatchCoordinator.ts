import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { digestToolContractIdentity } from '../../engine/toolExecution/toolContractIdentity';
import {
  planEffectDispatch,
  type AtomicEffectDispatchClaimCandidate,
  type EffectDispatchBlockReason,
  type EffectDispatchIdentity,
  type EffectDispatchSnapshot,
  isEffectDispatchIdentity,
} from './effectDispatchPolicy';
import type { ExecutionEffectClass, ExecutionEffectStatus } from './types';
import { EXECUTION_EFFECT_CLASSES, EXECUTION_EFFECT_STATUSES } from './types';
import { prepareEffectReceiptRecord } from './effectReceiptStore';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export const EFFECT_DISPATCH_CLAIM_REJECTION_REASONS = [
  'generation_changed',
  'control_epoch_changed',
  'authority_changed',
  'authorization_expired',
  'approval_not_granted',
  'permission_not_granted',
  'run_not_executing',
  'effect_not_planned',
  'identity_conflict',
  'model_authority_changed',
  'model_authority_expired',
  'model_authority_unavailable',
  'journal_unavailable',
] as const;

export type EffectDispatchClaimRejectionReason =
  (typeof EFFECT_DISPATCH_CLAIM_REJECTION_REASONS)[number];
const CLAIM_REJECTION_REASON_SET = new Set<string>(EFFECT_DISPATCH_CLAIM_REJECTION_REASONS);

export const EFFECT_DISPATCH_SETTLEMENT_REJECTION_REASONS = [
  'claim_stale',
  'receipt_conflict',
  'journal_unavailable',
] as const;

export type EffectDispatchSettlementRejectionReason =
  (typeof EFFECT_DISPATCH_SETTLEMENT_REJECTION_REASONS)[number];
const SETTLEMENT_REJECTION_REASON_SET = new Set<string>(
  EFFECT_DISPATCH_SETTLEMENT_REJECTION_REASONS,
);

export interface EffectDispatchClaimEvidence {
  claimToken: string;
  identity: EffectDispatchIdentity;
  claimedAt: number;
}

export interface EffectDispatchReadState {
  snapshot: EffectDispatchSnapshot;
  existingClaim: {
    claim: EffectDispatchClaimEvidence;
    receipt: unknown | null;
  } | null;
}

export type AtomicEffectDispatchClaimResult =
  | { kind: 'claimed'; claim: EffectDispatchClaimEvidence }
  | {
      kind: 'existing';
      claim: EffectDispatchClaimEvidence;
      receipt: unknown | null;
    }
  | { kind: 'rejected'; reason: EffectDispatchClaimRejectionReason };

export type EffectDispatchReceiptDisposition =
  | 'verified'
  | 'applied_unverified'
  | 'failed'
  | 'cancelled'
  | 'uncertain';

export interface EffectDispatchSettlementCandidate {
  claim: EffectDispatchClaimEvidence;
  receipt: ToolEffectReceipt;
  receiptDigest: string;
  receiptJson: string;
  nextEffectStatus: Extract<
    ExecutionEffectStatus,
    'applied' | 'verified' | 'failed' | 'cancelled' | 'ambiguous'
  >;
  outcomeDigest: string;
  observedAt: number;
}

export type AtomicEffectDispatchSettlementResult =
  | { kind: 'recorded' }
  | { kind: 'replayed' }
  | { kind: 'rejected'; reason: EffectDispatchSettlementRejectionReason };

export interface EffectDispatchAmbiguityCandidate {
  claim: EffectDispatchClaimEvidence;
  reason: 'dispatch_threw' | 'receipt_invalid' | 'settlement_unavailable';
  observedAt: number;
}

export type EffectDispatchCallbackResult<TDeferred extends object = never> =
  | Readonly<{ kind: 'terminal_receipt'; receipt: unknown }>
  | Readonly<{ kind: 'deferred'; deferred: TDeferred }>;

export interface EffectDispatchPorts<TDeferred extends object = never> {
  now(): number;
  readState(identity: EffectDispatchIdentity): Promise<EffectDispatchReadState | null>;
  /**
   * Atomically revalidates every expected field, checks the authority lease against
   * the store clock (not `evaluatedAt`), inserts the unique exact-identity claim, and
   * moves planned to started. Only `claimed` authorizes the external executor.
   */
  claimAndStart(
    candidate: AtomicEffectDispatchClaimCandidate,
  ): Promise<AtomicEffectDispatchClaimResult>;
  /**
   * Dispatches only the durable command whose exact digest and target are in
   * the claim. A deferred response is valid only after its external pending
   * state has been durably committed by the callback implementation.
   */
  dispatch(claim: EffectDispatchClaimEvidence): Promise<EffectDispatchCallbackResult<TDeferred>>;
  /**
   * Atomically appends receipt evidence and advances the journal effect once.
   * `replayed` is valid only for the exact immutable receipt; conflicting evidence
   * is rejected. Final verification performs both applied and verified transitions.
   */
  settle(
    candidate: EffectDispatchSettlementCandidate,
  ): Promise<AtomicEffectDispatchSettlementResult>;
  /** Atomically records uncertainty without overwriting stronger terminal evidence. */
  markAmbiguous(candidate: EffectDispatchAmbiguityCandidate): Promise<void>;
}

export type EffectDispatchResult<TDeferred extends object = never> =
  | {
      kind: 'blocked';
      reason:
        | EffectDispatchBlockReason
        | EffectDispatchClaimRejectionReason
        | 'state_unavailable'
        | 'claim_identity_conflict';
    }
  | {
      kind: 'settled' | 'duplicate_suppressed';
      disposition: EffectDispatchReceiptDisposition;
      requiresReconciliation: boolean;
      receipt: ToolEffectReceipt;
    }
  | {
      kind: 'reconciliation_required';
      reason:
        | 'effect_already_started'
        | 'claim_in_flight'
        | 'claim_contract_violation'
        | 'claim_outcome_unknown'
        | 'dispatch_threw'
        | 'receipt_invalid'
        | 'settlement_unavailable'
        | EffectDispatchSettlementRejectionReason;
    }
  | { kind: 'deferred'; deferred: TDeferred };

function isExactId(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function resourcesMatch(left: EffectDispatchIdentity, right: EffectDispatchIdentity): boolean {
  if (left.expectedResource === null || right.expectedResource === null) {
    return left.expectedResource === right.expectedResource;
  }
  return (
    left.expectedResource.kind === right.expectedResource.kind &&
    left.expectedResource.id === right.expectedResource.id
  );
}

function identitiesMatch(left: EffectDispatchIdentity, right: EffectDispatchIdentity): boolean {
  return (
    left.runId === right.runId &&
    left.effectId === right.effectId &&
    left.executionRunId === right.executionRunId &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    left.toolNameDigest === right.toolNameDigest &&
    left.toolContractIdentityDigest === right.toolContractIdentityDigest &&
    left.requestDigest === right.requestDigest &&
    left.idempotencyKeyDigest === right.idempotencyKeyDigest &&
    left.dispatchTargetDigest === right.dispatchTargetDigest &&
    left.expectedEffectKind === right.expectedEffectKind &&
    resourcesMatch(left, right) &&
    left.attempt === right.attempt &&
    left.controlEpoch === right.controlEpoch &&
    left.authorityCheckpointId === right.authorityCheckpointId
  );
}

function claimMatchesCandidate(
  claim: EffectDispatchClaimEvidence,
  candidate: AtomicEffectDispatchClaimCandidate,
): boolean {
  return (
    isExactId(claim.claimToken, 256) &&
    isEffectDispatchIdentity(claim.identity) &&
    isTimestamp(claim.claimedAt) &&
    claim.claimedAt >= candidate.evaluatedAt &&
    (candidate.authorizationExpiresAt === null ||
      claim.claimedAt < candidate.authorizationExpiresAt) &&
    identitiesMatch(claim.identity, candidate.identity)
  );
}

async function receiptMatchesClaim(
  claim: EffectDispatchClaimEvidence,
  receipt: ToolEffectReceipt,
): Promise<boolean> {
  const expectedResource = claim.identity.expectedResource;
  const resourceMatches =
    !expectedResource ||
    (!receipt.resource && receipt.effectState !== 'applied') ||
    (receipt.resource?.kind === expectedResource.kind &&
      receipt.resource.id === expectedResource.id);
  const structuralMatch =
    receipt.executionRunId === claim.identity.executionRunId &&
    receipt.dispatchRunId === claim.identity.runId &&
    receipt.toolCallId === claim.identity.toolCallId &&
    receipt.toolName === claim.identity.toolName &&
    receipt.effectKind === claim.identity.expectedEffectKind &&
    receipt.requestDigest === `sha256:${claim.identity.requestDigest}` &&
    receipt.recordedAt >= claim.claimedAt &&
    resourceMatches;
  if (!structuralMatch) return false;
  try {
    const identityDigest = await digestToolContractIdentity(receipt.contractIdentity);
    return identityDigest === `sha256:${claim.identity.toolContractIdentityDigest}`;
  } catch {
    return false;
  }
}

function isClaimEvidence(value: unknown): value is EffectDispatchClaimEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Partial<EffectDispatchClaimEvidence>;
  return (
    Object.keys(value).sort().join(',') === 'claimToken,claimedAt,identity' &&
    isExactId(claim.claimToken, 256) &&
    isTimestamp(claim.claimedAt) &&
    isEffectDispatchIdentity(claim.identity)
  );
}

function isClaimResult(value: unknown): value is AtomicEffectDispatchClaimResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Partial<AtomicEffectDispatchClaimResult>;
  if (result.kind === 'rejected') {
    return CLAIM_REJECTION_REASON_SET.has(result.reason ?? '');
  }
  if (result.kind === 'claimed') {
    return isClaimEvidence(result.claim);
  }
  if (result.kind === 'existing') {
    return isClaimEvidence(result.claim) && 'receipt' in result;
  }
  return false;
}

function isSettlementResult(value: unknown): value is AtomicEffectDispatchSettlementResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Partial<AtomicEffectDispatchSettlementResult>;
  return (
    result.kind === 'recorded' ||
    result.kind === 'replayed' ||
    (result.kind === 'rejected' && SETTLEMENT_REJECTION_REASON_SET.has(result.reason ?? ''))
  );
}

function isDispatchCallbackResult<TDeferred extends object>(
  value: unknown,
): value is EffectDispatchCallbackResult<TDeferred> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Partial<EffectDispatchCallbackResult<TDeferred>>;
  const keys = Object.keys(value).sort().join(',');
  if (result.kind === 'terminal_receipt') return keys === 'kind,receipt';
  return (
    result.kind === 'deferred' &&
    keys === 'deferred,kind' &&
    typeof result.deferred === 'object' &&
    result.deferred !== null &&
    !Array.isArray(result.deferred)
  );
}

function classifyReceipt(
  effectClass: ExecutionEffectClass,
  receipt: ToolEffectReceipt,
): {
  disposition: EffectDispatchReceiptDisposition;
  nextEffectStatus: EffectDispatchSettlementCandidate['nextEffectStatus'];
  requiresReconciliation: boolean;
} | null {
  switch (receipt.effectState) {
    case 'none':
      return effectClass === 'none'
        ? { disposition: 'verified', nextEffectStatus: 'verified', requiresReconciliation: false }
        : null;
    case 'applied':
      return receipt.verificationState === 'verified'
        ? { disposition: 'verified', nextEffectStatus: 'verified', requiresReconciliation: false }
        : {
            disposition: 'applied_unverified',
            nextEffectStatus: 'applied',
            requiresReconciliation: true,
          };
    case 'failed':
      return { disposition: 'failed', nextEffectStatus: 'failed', requiresReconciliation: false };
    case 'cancelled':
      return {
        disposition: 'cancelled',
        nextEffectStatus: 'cancelled',
        requiresReconciliation: false,
      };
    case 'accepted':
    case 'handed_off':
    case 'pending':
    case 'unknown':
      return {
        disposition: 'uncertain',
        nextEffectStatus: 'ambiguous',
        requiresReconciliation: true,
      };
  }
}

async function markAmbiguousSafely(
  ports: Pick<EffectDispatchPorts, 'markAmbiguous'>,
  candidate: EffectDispatchAmbiguityCandidate,
): Promise<void> {
  try {
    await ports.markAmbiguous(candidate);
  } catch {
    // The closed result remains reconciliation-required even if persistence is unavailable.
  }
}

export async function settleEffectDispatchCallback(
  input: {
    claim: EffectDispatchClaimEvidence;
    effectClass: ExecutionEffectClass;
    receipt: unknown;
    observedAt: number;
  },
  ports: Pick<EffectDispatchPorts, 'settle' | 'markAmbiguous'>,
): Promise<EffectDispatchResult> {
  if (!isClaimEvidence(input.claim)) {
    return { kind: 'reconciliation_required', reason: 'receipt_invalid' };
  }
  const receipt = decodeToolEffectReceipt(input.receipt);
  if (
    !receipt ||
    !isTimestamp(input.observedAt) ||
    input.observedAt < input.claim.claimedAt ||
    !(await receiptMatchesClaim(input.claim, receipt))
  ) {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'receipt_invalid',
      observedAt: Math.max(
        input.claim.claimedAt,
        isTimestamp(input.observedAt) ? input.observedAt : 0,
      ),
    });
    return { kind: 'reconciliation_required', reason: 'receipt_invalid' };
  }
  const classification = classifyReceipt(input.effectClass, receipt);
  if (!classification) {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'receipt_invalid',
      observedAt: input.observedAt,
    });
    return { kind: 'reconciliation_required', reason: 'receipt_invalid' };
  }

  let preparedReceipt: Awaited<ReturnType<typeof prepareEffectReceiptRecord>>;
  try {
    preparedReceipt = await prepareEffectReceiptRecord(receipt);
  } catch {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'receipt_invalid',
      observedAt: input.observedAt,
    });
    return { kind: 'reconciliation_required', reason: 'receipt_invalid' };
  }

  let settlement: AtomicEffectDispatchSettlementResult;
  try {
    settlement = await ports.settle({
      claim: input.claim,
      receipt,
      receiptDigest: preparedReceipt.receiptDigest,
      receiptJson: preparedReceipt.receiptJson,
      nextEffectStatus: classification.nextEffectStatus,
      outcomeDigest: receipt.resultDigest.slice('sha256:'.length),
      observedAt: input.observedAt,
    });
  } catch {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'settlement_unavailable',
      observedAt: input.observedAt,
    });
    return { kind: 'reconciliation_required', reason: 'settlement_unavailable' };
  }
  if (!isSettlementResult(settlement)) {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'settlement_unavailable',
      observedAt: input.observedAt,
    });
    return { kind: 'reconciliation_required', reason: 'settlement_unavailable' };
  }
  if (settlement.kind === 'rejected') {
    await markAmbiguousSafely(ports, {
      claim: input.claim,
      reason: 'settlement_unavailable',
      observedAt: input.observedAt,
    });
    return { kind: 'reconciliation_required', reason: settlement.reason };
  }
  return {
    kind: settlement.kind === 'replayed' ? 'duplicate_suppressed' : 'settled',
    disposition: classification.disposition,
    requiresReconciliation: classification.requiresReconciliation,
    receipt,
  };
}

async function classifyExistingClaim(
  identity: EffectDispatchIdentity,
  effectClass: ExecutionEffectClass,
  existing: NonNullable<EffectDispatchReadState['existingClaim']>,
  ports: Pick<EffectDispatchPorts, 'settle' | 'markAmbiguous'>,
  observedAt: number,
): Promise<EffectDispatchResult> {
  if (!isClaimEvidence(existing.claim)) {
    return { kind: 'reconciliation_required', reason: 'claim_contract_violation' };
  }
  if (!identitiesMatch(identity, existing.claim.identity)) {
    return { kind: 'blocked', reason: 'claim_identity_conflict' };
  }
  if (existing.receipt === null) {
    return { kind: 'reconciliation_required', reason: 'claim_in_flight' };
  }
  const result = await settleEffectDispatchCallback(
    { claim: existing.claim, effectClass, receipt: existing.receipt, observedAt },
    ports,
  );
  return result.kind === 'settled' ? { ...result, kind: 'duplicate_suppressed' } : result;
}

export async function dispatchEffectExactlyOnce<TDeferred extends object = never>(
  identity: EffectDispatchIdentity,
  ports: EffectDispatchPorts<TDeferred>,
): Promise<EffectDispatchResult<TDeferred>> {
  if (!isEffectDispatchIdentity(identity)) {
    return { kind: 'blocked', reason: 'invalid_request' };
  }
  let evaluatedAt: number;
  let state: EffectDispatchReadState | null;
  try {
    evaluatedAt = ports.now();
    state = await ports.readState(identity);
  } catch {
    return { kind: 'blocked', reason: 'state_unavailable' };
  }
  if (!state) {
    return { kind: 'blocked', reason: 'state_unavailable' };
  }

  // Once a durable claim exists, later terminal/after-effect checkpoints are
  // expected and must never reopen dispatch. Classify the immutable claim
  // before applying the pre-dispatch "authority checkpoint is latest" rule.
  const observedEffectStatus = state.snapshot?.effect?.status;
  if (
    typeof observedEffectStatus === 'string' &&
    EXECUTION_EFFECT_STATUSES.includes(observedEffectStatus as ExecutionEffectStatus) &&
    observedEffectStatus !== 'planned'
  ) {
    const effectClass = state.snapshot?.effect?.effectClass;
    if (
      typeof effectClass !== 'string' ||
      !EXECUTION_EFFECT_CLASSES.includes(effectClass as ExecutionEffectClass)
    ) {
      return { kind: 'blocked', reason: 'state_unavailable' };
    }
    return state.existingClaim
      ? classifyExistingClaim(
          identity,
          effectClass as ExecutionEffectClass,
          state.existingClaim,
          ports,
          evaluatedAt,
        )
      : { kind: 'reconciliation_required', reason: 'effect_already_started' };
  }

  let decision: ReturnType<typeof planEffectDispatch>;
  try {
    decision = planEffectDispatch({ identity, snapshot: state.snapshot, evaluatedAt });
  } catch {
    return { kind: 'blocked', reason: 'state_unavailable' };
  }
  if (decision.kind === 'blocked') {
    if (decision.reason === 'effect_already_started') {
      return state.existingClaim
        ? classifyExistingClaim(
            identity,
            state.snapshot.effect.effectClass,
            state.existingClaim,
            ports,
            evaluatedAt,
          )
        : { kind: 'reconciliation_required', reason: 'effect_already_started' };
    }
    return { kind: 'blocked', reason: decision.reason };
  }

  let claimResult: AtomicEffectDispatchClaimResult;
  try {
    claimResult = await ports.claimAndStart(decision.candidate);
  } catch {
    return { kind: 'reconciliation_required', reason: 'claim_outcome_unknown' };
  }
  if (!isClaimResult(claimResult)) {
    return { kind: 'reconciliation_required', reason: 'claim_contract_violation' };
  }
  if (claimResult.kind === 'rejected') {
    return { kind: 'blocked', reason: claimResult.reason };
  }
  if (claimResult.kind === 'existing') {
    return classifyExistingClaim(
      identity,
      state.snapshot.effect.effectClass,
      { claim: claimResult.claim, receipt: claimResult.receipt },
      ports,
      evaluatedAt,
    );
  }
  if (!claimMatchesCandidate(claimResult.claim, decision.candidate)) {
    return { kind: 'reconciliation_required', reason: 'claim_contract_violation' };
  }

  let callbackResult: EffectDispatchCallbackResult<TDeferred>;
  let observedAt: number;
  try {
    const rawCallbackResult = await ports.dispatch(claimResult.claim);
    if (!isDispatchCallbackResult<TDeferred>(rawCallbackResult)) {
      return { kind: 'reconciliation_required', reason: 'receipt_invalid' };
    }
    callbackResult = rawCallbackResult;
  } catch {
    observedAt = Math.max(
      claimResult.claim.claimedAt,
      (() => {
        try {
          return ports.now();
        } catch {
          return claimResult.claim.claimedAt;
        }
      })(),
    );
    await markAmbiguousSafely(ports, {
      claim: claimResult.claim,
      reason: 'dispatch_threw',
      observedAt,
    });
    return { kind: 'reconciliation_required', reason: 'dispatch_threw' };
  }
  if (callbackResult.kind === 'deferred') {
    return { kind: 'deferred', deferred: callbackResult.deferred };
  }
  try {
    observedAt = ports.now();
  } catch {
    await markAmbiguousSafely(ports, {
      claim: claimResult.claim,
      reason: 'settlement_unavailable',
      observedAt: claimResult.claim.claimedAt,
    });
    return { kind: 'reconciliation_required', reason: 'settlement_unavailable' };
  }

  return settleEffectDispatchCallback(
    {
      claim: claimResult.claim,
      effectClass: state.snapshot.effect.effectClass,
      receipt: callbackResult.receipt,
      observedAt,
    },
    ports,
  );
}
