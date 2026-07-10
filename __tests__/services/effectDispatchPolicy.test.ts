import {
  planEffectDispatch,
  type EffectDispatchIdentity,
  type EffectDispatchSnapshot,
} from '../../src/services/executionJournal/effectDispatchPolicy';
import type { ExecutionEffectRecord } from '../../src/services/executionJournal/types';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  executionCheckpointRecord,
  executionRunRecord,
} from '../helpers/executionJournalMutationFixtures';

const TOOL_NAME = 'calendar_create';

function fixture(): {
  identity: EffectDispatchIdentity;
  snapshot: EffectDispatchSnapshot;
  evaluatedAt: number;
} {
  const run = executionRunRecord({
    status: 'running',
    updatedAt: 14,
    resumeStrategy: 'reconcile_first',
    nextRetryPolicy: 'reconcile_before_retry',
  });
  const planningCheckpoint = executionCheckpointRecord(run, {
    id: 'checkpoint-planning',
    sequence: 1,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-planning',
    resumeStrategy: 'reconcile_first',
    createdAt: 12,
  });
  const effect: ExecutionEffectRecord = {
    id: 'effect-1',
    runId: run.id,
    checkpointId: planningCheckpoint.id,
    toolCallId: 'tool-call-1',
    toolNameDigest: DIGEST_A,
    effectClass: 'remote_mutation',
    idempotencyClass: 'declared_idempotent',
    idempotencyKeyDigest: DIGEST_D,
    requestDigest: DIGEST_B,
    outcomeDigest: null,
    status: 'planned',
    retryPolicy: 'reconcile_before_retry',
    attempt: 1,
    createdAt: 13,
    startedAt: null,
    completedAt: null,
    updatedAt: 13,
  };
  const authorityCheckpoint = executionCheckpointRecord(run, {
    id: 'checkpoint-authority',
    sequence: 2,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: 'state-authority',
    resumeStrategy: 'reconcile_first',
    createdAt: 14,
  });
  return {
    identity: {
      runId: run.id,
      effectId: effect.id,
      toolCallId: effect.toolCallId,
      toolName: TOOL_NAME,
      toolNameDigest: effect.toolNameDigest,
      requestDigest: effect.requestDigest,
      idempotencyKeyDigest: effect.idempotencyKeyDigest,
      dispatchTargetDigest: DIGEST_C,
      expectedEffectKind: 'calendar.update',
      expectedResource: { kind: 'calendar_event', id: 'event-1' },
      attempt: effect.attempt,
      controlEpoch: run.controlEpoch,
      authorityCheckpointId: authorityCheckpoint.id,
    },
    snapshot: {
      run,
      effect,
      planningCheckpoint,
      authorityCheckpoint,
      latestCheckpointId: authorityCheckpoint.id,
      authorizationExpiresAt: 20,
    },
    evaluatedAt: 15,
  };
}

describe('effect dispatch policy', () => {
  it('builds an atomic claim from one exact journal generation and authority lease', () => {
    const input = fixture();

    expect(planEffectDispatch(input)).toEqual({
      kind: 'claim_dispatch',
      candidate: {
        identity: input.identity,
        expectedRunStatus: 'running',
        expectedEffectStatus: 'planned',
        expectedControlEpoch: 0,
        expectedApprovalState: 'not_required',
        expectedPermissionState: 'granted',
        expectedRunUpdatedAt: 14,
        expectedEffectUpdatedAt: 13,
        expectedPlanningCheckpointId: 'checkpoint-planning',
        expectedLatestCheckpointId: 'checkpoint-authority',
        expectedAuthoritySequence: 2,
        authorizationExpiresAt: 20,
        evaluatedAt: 15,
      },
    });
  });

  it.each([
    ['run', { runId: 'run-other' }],
    ['effect', { effectId: 'effect-other' }],
    ['tool call', { toolCallId: 'tool-call-other' }],
    ['tool digest', { toolNameDigest: DIGEST_C }],
    ['request', { requestDigest: DIGEST_C }],
    ['idempotency key', { idempotencyKeyDigest: DIGEST_C }],
    ['attempt', { attempt: 2 }],
  ] as const)('rejects a collateral %s identity change', (_label, override) => {
    const input = fixture();
    input.identity = { ...input.identity, ...override };

    expect(planEffectDispatch(input)).toEqual({ kind: 'blocked', reason: 'identity_mismatch' });
  });

  it('rejects malformed exact identities instead of normalizing them', () => {
    const input = fixture();
    input.identity = { ...input.identity, toolCallId: ' tool-call-1' };

    expect(planEffectDispatch(input)).toEqual({ kind: 'blocked', reason: 'invalid_request' });
  });

  it('rejects additional identity fields and malformed resource selectors', () => {
    const additional = fixture();
    additional.identity = { ...additional.identity, legacyTarget: 'event-1' } as never;
    expect(planEffectDispatch(additional)).toEqual({
      kind: 'blocked',
      reason: 'invalid_request',
    });

    const malformedResource = fixture();
    malformedResource.identity = {
      ...malformedResource.identity,
      expectedResource: { kind: 'calendar_event', id: ' event-1' },
    };
    expect(planEffectDispatch(malformedResource)).toEqual({
      kind: 'blocked',
      reason: 'invalid_request',
    });
  });

  it('rejects mixed journal ownership and a non-latest authority checkpoint', () => {
    const mixed = fixture();
    mixed.snapshot = {
      ...mixed.snapshot,
      planningCheckpoint: { ...mixed.snapshot.planningCheckpoint, runId: 'run-other' },
    };
    expect(planEffectDispatch(mixed)).toEqual({ kind: 'blocked', reason: 'snapshot_invalid' });

    const stale = fixture();
    stale.snapshot = { ...stale.snapshot, latestCheckpointId: 'checkpoint-newer' };
    expect(planEffectDispatch(stale)).toEqual({ kind: 'blocked', reason: 'snapshot_invalid' });
  });

  it('blocks a stale control epoch after user steering or cancellation', () => {
    const input = fixture();
    input.snapshot = {
      ...input.snapshot,
      run: { ...input.snapshot.run, controlEpoch: 1, updatedAt: 15 },
    };

    expect(planEffectDispatch(input)).toEqual({
      kind: 'blocked',
      reason: 'stale_control_epoch',
    });
  });

  it('does not acquire another claim once dispatch has started', () => {
    const input = fixture();
    input.snapshot = {
      ...input.snapshot,
      effect: {
        ...input.snapshot.effect,
        status: 'ambiguous',
        startedAt: 14,
        updatedAt: 15,
      },
      run: { ...input.snapshot.run, status: 'ambiguous', updatedAt: 15 },
    };

    expect(planEffectDispatch(input)).toEqual({
      kind: 'blocked',
      reason: 'effect_already_started',
    });
  });

  it.each(['pending', 'denied', 'expired', 'unknown'] as const)(
    'blocks %s approval at execution time',
    (approvalState) => {
      const input = fixture();
      input.snapshot = {
        ...input.snapshot,
        run: { ...input.snapshot.run, approvalState },
        authorityCheckpoint: { ...input.snapshot.authorityCheckpoint, approvalState },
      };

      expect(planEffectDispatch(input)).toEqual({
        kind: 'blocked',
        reason: 'approval_not_granted',
      });
    },
  );

  it.each(['pending', 'denied', 'expired', 'unknown'] as const)(
    'blocks %s permission at execution time',
    (permissionState) => {
      const input = fixture();
      input.snapshot = {
        ...input.snapshot,
        run: { ...input.snapshot.run, permissionState },
        authorityCheckpoint: { ...input.snapshot.authorityCheckpoint, permissionState },
      };

      expect(planEffectDispatch(input)).toEqual({
        kind: 'blocked',
        reason: 'permission_not_granted',
      });
    },
  );

  it('treats the authorization expiry instant as outside the lease', () => {
    const input = fixture();
    input.evaluatedAt = 20;

    expect(planEffectDispatch(input)).toEqual({
      kind: 'blocked',
      reason: 'authorization_expired',
    });
  });

  it.each([
    ['declared mutation without a key', { idempotencyKeyDigest: null }],
    [
      'undeclared mutation with a key',
      { idempotencyClass: 'not_declared', idempotencyKeyDigest: DIGEST_D },
    ],
    [
      'unknown mutation marked replay-safe',
      { idempotencyClass: 'unknown', idempotencyKeyDigest: null, retryPolicy: 'replay_safe' },
    ],
    [
      'effect-free work with a mutation key',
      {
        effectClass: 'none',
        idempotencyClass: 'effect_free',
        idempotencyKeyDigest: DIGEST_D,
        retryPolicy: 'replay_safe',
      },
    ],
  ] as const)('blocks an unsafe idempotency contract: %s', (_label, effectOverride) => {
    const input = fixture();
    input.snapshot = {
      ...input.snapshot,
      effect: { ...input.snapshot.effect, ...effectOverride },
    };
    input.identity = {
      ...input.identity,
      idempotencyKeyDigest: input.snapshot.effect.idempotencyKeyDigest,
    };

    expect(planEffectDispatch(input)).toEqual({
      kind: 'blocked',
      reason: 'unsafe_idempotency_contract',
    });
  });

  it('permits effect-free replay only without a mutation key', () => {
    const input = fixture();
    input.snapshot = {
      ...input.snapshot,
      effect: {
        ...input.snapshot.effect,
        effectClass: 'none',
        idempotencyClass: 'effect_free',
        idempotencyKeyDigest: null,
        retryPolicy: 'replay_safe',
      },
    };
    input.identity = { ...input.identity, idempotencyKeyDigest: null };

    expect(planEffectDispatch(input).kind).toBe('claim_dispatch');
  });
});
