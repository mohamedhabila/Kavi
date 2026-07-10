import type { ExecutionCheckpointRecord, ExecutionEffectRecord, ExecutionRunRecord } from './types';
import { TOOL_EFFECT_KINDS, type ToolEffectKind } from '../../types/toolEffectReceipt';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const AUTHORITY_GRANTED_STATES = new Set(['granted', 'not_required']);
const IDENTITY_KEYS = [
  'attempt',
  'authorityCheckpointId',
  'controlEpoch',
  'dispatchTargetDigest',
  'effectId',
  'expectedEffectKind',
  'expectedResource',
  'idempotencyKeyDigest',
  'requestDigest',
  'runId',
  'toolCallId',
  'toolName',
  'toolNameDigest',
] as const;

export const EFFECT_DISPATCH_BLOCK_REASONS = [
  'invalid_request',
  'snapshot_invalid',
  'identity_mismatch',
  'run_not_executing',
  'effect_already_started',
  'stale_control_epoch',
  'stale_authority',
  'approval_not_granted',
  'permission_not_granted',
  'authorization_expired',
  'unsafe_idempotency_contract',
] as const;

export type EffectDispatchBlockReason = (typeof EFFECT_DISPATCH_BLOCK_REASONS)[number];

export interface EffectDispatchExpectedResource {
  kind: string;
  id: string;
}

export interface EffectDispatchIdentity {
  runId: string;
  effectId: string;
  toolCallId: string;
  toolName: string;
  toolNameDigest: string;
  requestDigest: string;
  idempotencyKeyDigest: string | null;
  dispatchTargetDigest: string;
  expectedEffectKind: ToolEffectKind;
  expectedResource: EffectDispatchExpectedResource | null;
  attempt: number;
  controlEpoch: number;
  authorityCheckpointId: string;
}

export interface EffectDispatchSnapshot {
  run: ExecutionRunRecord;
  effect: ExecutionEffectRecord;
  planningCheckpoint: ExecutionCheckpointRecord;
  authorityCheckpoint: ExecutionCheckpointRecord;
  latestCheckpointId: string;
  authorizationExpiresAt: number | null;
}

export interface AtomicEffectDispatchClaimCandidate {
  identity: EffectDispatchIdentity;
  expectedRunStatus: 'running';
  expectedEffectStatus: 'planned';
  expectedControlEpoch: number;
  expectedApprovalState: 'granted' | 'not_required';
  expectedPermissionState: 'granted' | 'not_required';
  expectedRunUpdatedAt: number;
  expectedEffectUpdatedAt: number;
  expectedPlanningCheckpointId: string;
  expectedLatestCheckpointId: string;
  expectedAuthoritySequence: number;
  authorizationExpiresAt: number | null;
  evaluatedAt: number;
}

export type EffectDispatchPolicyDecision =
  | {
      kind: 'claim_dispatch';
      candidate: AtomicEffectDispatchClaimCandidate;
    }
  | {
      kind: 'blocked';
      reason: EffectDispatchBlockReason;
    };

function isExactId(value: unknown, maximumLength = 200): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isEffectDispatchIdentity(value: unknown): value is EffectDispatchIdentity {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== IDENTITY_KEYS.length ||
    keys.some((key, index) => key !== IDENTITY_KEYS[index])
  ) {
    return false;
  }
  const identity = value as unknown as EffectDispatchIdentity;
  const expectedResource = identity.expectedResource;
  return (
    isExactId(identity.runId) &&
    isExactId(identity.effectId) &&
    isExactId(identity.toolCallId) &&
    isExactId(identity.toolName, 256) &&
    isDigest(identity.toolNameDigest) &&
    isDigest(identity.requestDigest) &&
    (identity.idempotencyKeyDigest === null || isDigest(identity.idempotencyKeyDigest)) &&
    isDigest(identity.dispatchTargetDigest) &&
    TOOL_EFFECT_KINDS.includes(identity.expectedEffectKind) &&
    (expectedResource === null ||
      (isPlainRecord(expectedResource) &&
        Object.keys(expectedResource).sort().join(',') === 'id,kind' &&
        isExactId(expectedResource.kind, 128) &&
        isExactId(expectedResource.id, 1024))) &&
    Number.isSafeInteger(identity.attempt) &&
    identity.attempt >= 1 &&
    Number.isSafeInteger(identity.controlEpoch) &&
    identity.controlEpoch >= 0 &&
    isExactId(identity.authorityCheckpointId)
  );
}

function snapshotOwnsExactEffect(snapshot: EffectDispatchSnapshot): boolean {
  const { run, effect, planningCheckpoint, authorityCheckpoint } = snapshot;
  return (
    effect.runId === run.id &&
    planningCheckpoint.runId === run.id &&
    authorityCheckpoint.runId === run.id &&
    effect.checkpointId === planningCheckpoint.id &&
    planningCheckpoint.boundary === 'before_effect' &&
    authorityCheckpoint.boundary === 'before_effect' &&
    authorityCheckpoint.sequence > planningCheckpoint.sequence &&
    effect.createdAt >= planningCheckpoint.createdAt &&
    authorityCheckpoint.createdAt >= effect.createdAt &&
    authorityCheckpoint.id === snapshot.latestCheckpointId &&
    run.updatedAt >= authorityCheckpoint.createdAt &&
    run.updatedAt >= effect.updatedAt &&
    (snapshot.authorizationExpiresAt === null || isSafeTimestamp(snapshot.authorizationExpiresAt))
  );
}

function identityMatchesSnapshot(
  identity: EffectDispatchIdentity,
  snapshot: EffectDispatchSnapshot,
): boolean {
  const { run, effect } = snapshot;
  return (
    identity.runId === run.id &&
    identity.effectId === effect.id &&
    identity.toolCallId === effect.toolCallId &&
    identity.toolNameDigest === effect.toolNameDigest &&
    identity.requestDigest === effect.requestDigest &&
    identity.idempotencyKeyDigest === effect.idempotencyKeyDigest &&
    identity.attempt === effect.attempt
  );
}

function hasSafeIdempotencyContract(effect: ExecutionEffectRecord): boolean {
  if (effect.effectClass === 'none') {
    return (
      effect.idempotencyClass === 'effect_free' &&
      effect.idempotencyKeyDigest === null &&
      effect.retryPolicy === 'replay_safe'
    );
  }
  if (effect.idempotencyClass === 'effect_free') {
    return false;
  }
  if (effect.idempotencyClass === 'declared_idempotent') {
    return effect.idempotencyKeyDigest !== null;
  }
  return effect.idempotencyKeyDigest === null && effect.retryPolicy !== 'replay_safe';
}

function isGrantedAuthorityState(value: string): value is 'granted' | 'not_required' {
  return AUTHORITY_GRANTED_STATES.has(value);
}

export function planEffectDispatch(input: {
  identity: EffectDispatchIdentity;
  snapshot: EffectDispatchSnapshot;
  evaluatedAt: number;
}): EffectDispatchPolicyDecision {
  if (!input || !isEffectDispatchIdentity(input.identity) || !isSafeTimestamp(input.evaluatedAt)) {
    return { kind: 'blocked', reason: 'invalid_request' };
  }
  if (!input.snapshot || !snapshotOwnsExactEffect(input.snapshot)) {
    return { kind: 'blocked', reason: 'snapshot_invalid' };
  }
  if (!identityMatchesSnapshot(input.identity, input.snapshot)) {
    return { kind: 'blocked', reason: 'identity_mismatch' };
  }

  const { run, effect, authorityCheckpoint, authorizationExpiresAt } = input.snapshot;
  if (effect.status !== 'planned') {
    return { kind: 'blocked', reason: 'effect_already_started' };
  }
  if (
    input.identity.controlEpoch !== run.controlEpoch ||
    input.snapshot.planningCheckpoint.controlEpoch !== run.controlEpoch ||
    authorityCheckpoint.controlEpoch !== run.controlEpoch
  ) {
    return { kind: 'blocked', reason: 'stale_control_epoch' };
  }
  if (run.status !== 'running') {
    return { kind: 'blocked', reason: 'run_not_executing' };
  }
  if (input.identity.authorityCheckpointId !== authorityCheckpoint.id) {
    return { kind: 'blocked', reason: 'stale_authority' };
  }
  if (
    run.approvalState !== authorityCheckpoint.approvalState ||
    run.permissionState !== authorityCheckpoint.permissionState
  ) {
    return { kind: 'blocked', reason: 'stale_authority' };
  }
  if (!isGrantedAuthorityState(authorityCheckpoint.approvalState)) {
    return { kind: 'blocked', reason: 'approval_not_granted' };
  }
  if (!isGrantedAuthorityState(authorityCheckpoint.permissionState)) {
    return { kind: 'blocked', reason: 'permission_not_granted' };
  }
  if (authorizationExpiresAt !== null && input.evaluatedAt >= authorizationExpiresAt) {
    return { kind: 'blocked', reason: 'authorization_expired' };
  }
  if (!hasSafeIdempotencyContract(effect)) {
    return { kind: 'blocked', reason: 'unsafe_idempotency_contract' };
  }

  return {
    kind: 'claim_dispatch',
    candidate: {
      identity: input.identity,
      expectedRunStatus: 'running',
      expectedEffectStatus: 'planned',
      expectedControlEpoch: run.controlEpoch,
      expectedApprovalState: authorityCheckpoint.approvalState,
      expectedPermissionState: authorityCheckpoint.permissionState,
      expectedRunUpdatedAt: run.updatedAt,
      expectedEffectUpdatedAt: effect.updatedAt,
      expectedPlanningCheckpointId: input.snapshot.planningCheckpoint.id,
      expectedLatestCheckpointId: authorityCheckpoint.id,
      expectedAuthoritySequence: authorityCheckpoint.sequence,
      authorizationExpiresAt,
      evaluatedAt: input.evaluatedAt,
    },
  };
}
