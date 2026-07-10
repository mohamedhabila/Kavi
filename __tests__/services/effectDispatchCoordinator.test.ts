import {
  dispatchEffectExactlyOnce,
  settleEffectDispatchCallback,
  type AtomicEffectDispatchClaimResult,
  type AtomicEffectDispatchSettlementResult,
  type EffectDispatchAmbiguityCandidate,
  type EffectDispatchClaimEvidence,
  type EffectDispatchPorts,
  type EffectDispatchReadState,
  type EffectDispatchSettlementCandidate,
} from '../../src/services/executionJournal/effectDispatchCoordinator';
import type {
  EffectDispatchIdentity,
  EffectDispatchSnapshot,
} from '../../src/services/executionJournal/effectDispatchPolicy';
import type { ExecutionEffectRecord } from '../../src/services/executionJournal/types';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../src/utils/toolEffectReceipt';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  executionCheckpointRecord,
  executionRunRecord,
} from '../helpers/executionJournalMutationFixtures';

function dispatchFixture(): {
  identity: EffectDispatchIdentity;
  snapshot: EffectDispatchSnapshot;
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
      toolName: 'calendar_update',
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
      authorizationExpiresAt: 30,
    },
  };
}

function effectReceipt(overrides: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
  const receipt = decodeToolEffectReceipt({
    version: 1,
    receiptId: 'ter_0123456789abcdef0123456789abcdef',
    toolCallId: 'tool-call-1',
    toolName: 'calendar_update',
    runId: 'run-1',
    transportState: 'returned',
    effectKind: 'calendar.update',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: `sha256:${DIGEST_B}`,
    resultDigest: `sha256:${DIGEST_C}`,
    resource: { kind: 'calendar_event', id: 'event-1' },
    recordedAt: 16,
    ...overrides,
  });
  if (!receipt) throw new Error('invalid test receipt');
  return receipt;
}

function claimFor(identity: EffectDispatchIdentity): EffectDispatchClaimEvidence {
  return { claimToken: 'claim-1', identity, claimedAt: 15 };
}

function harness(
  options: {
    state?: EffectDispatchReadState | null;
    claimResult?: AtomicEffectDispatchClaimResult;
    dispatchResult?: unknown;
    dispatchError?: Error;
    settlementResult?: AtomicEffectDispatchSettlementResult;
    settlementError?: Error;
    now?: number[];
  } = {},
) {
  const fixture = dispatchFixture();
  const calls = {
    claims: [] as Parameters<EffectDispatchPorts['claimAndStart']>,
    dispatches: [] as EffectDispatchClaimEvidence[],
    settlements: [] as EffectDispatchSettlementCandidate[],
    ambiguities: [] as EffectDispatchAmbiguityCandidate[],
  };
  let durableClaim: EffectDispatchClaimEvidence | null =
    options.state?.existingClaim?.claim ?? null;
  let durableReceipt: unknown | null = options.state?.existingClaim?.receipt ?? null;
  const times = [...(options.now ?? [15, 16, 17, 18])];
  const ports: EffectDispatchPorts = {
    now: () => times.shift() ?? 18,
    readState: async () =>
      options.state === null
        ? null
        : {
            snapshot: options.state?.snapshot ?? fixture.snapshot,
            existingClaim: durableClaim ? { claim: durableClaim, receipt: durableReceipt } : null,
          },
    claimAndStart: async (candidate) => {
      calls.claims.push(candidate);
      if (options.claimResult) return options.claimResult;
      if (durableClaim) {
        return { kind: 'existing', claim: durableClaim, receipt: durableReceipt };
      }
      durableClaim = claimFor(candidate.identity);
      return { kind: 'claimed', claim: durableClaim };
    },
    dispatch: async (claim) => {
      calls.dispatches.push(claim);
      if (options.dispatchError) throw options.dispatchError;
      return options.dispatchResult ?? effectReceipt();
    },
    settle: async (candidate) => {
      calls.settlements.push(candidate);
      if (options.settlementError) throw options.settlementError;
      if (options.settlementResult) return options.settlementResult;
      if (durableReceipt) return { kind: 'replayed' };
      durableReceipt = candidate.receipt;
      return { kind: 'recorded' };
    },
    markAmbiguous: async (candidate) => {
      calls.ambiguities.push(candidate);
    },
  };
  return { ...fixture, calls, ports };
}

describe('exactly-once effect dispatch coordinator', () => {
  it('dispatches only after an exact atomic claim and settles verified evidence', async () => {
    const test = harness();

    const result = await dispatchEffectExactlyOnce(test.identity, test.ports);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'settled',
        disposition: 'verified',
        requiresReconciliation: false,
      }),
    );
    expect(test.calls.claims).toHaveLength(1);
    expect(test.calls.claims[0]).toEqual(
      expect.objectContaining({
        identity: test.identity,
        expectedRunUpdatedAt: 14,
        expectedEffectUpdatedAt: 13,
        expectedLatestCheckpointId: 'checkpoint-authority',
        authorizationExpiresAt: 30,
      }),
    );
    expect(test.calls.dispatches).toEqual([claimFor(test.identity)]);
    expect(test.calls.settlements[0]).toEqual(
      expect.objectContaining({
        claim: claimFor(test.identity),
        nextEffectStatus: 'verified',
        outcomeDigest: DIGEST_C,
      }),
    );
    expect(test.calls.ambiguities).toHaveLength(0);
  });

  it('suppresses a repeated coordinator callback without dispatching twice', async () => {
    const test = harness();

    const first = await dispatchEffectExactlyOnce(test.identity, test.ports);
    const second = await dispatchEffectExactlyOnce(test.identity, test.ports);

    expect(first.kind).toBe('settled');
    expect(second).toEqual(
      expect.objectContaining({
        kind: 'duplicate_suppressed',
        disposition: 'verified',
        requiresReconciliation: false,
      }),
    );
    expect(test.calls.dispatches).toHaveLength(1);
  });

  it('makes duplicate settlement callbacks idempotent', async () => {
    const test = harness();
    const claim = claimFor(test.identity);
    const receipt = effectReceipt();

    const first = await settleEffectDispatchCallback(
      { claim, effectClass: 'remote_mutation', receipt, observedAt: 17 },
      test.ports,
    );
    const replay = await settleEffectDispatchCallback(
      { claim, effectClass: 'remote_mutation', receipt, observedAt: 18 },
      test.ports,
    );

    expect(first.kind).toBe('settled');
    expect(replay.kind).toBe('duplicate_suppressed');
    expect(test.calls.settlements).toHaveLength(2);
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it.each([
    [
      'timeout or unknown outcome',
      effectReceipt({ effectState: 'unknown', verificationState: 'unverified' }),
      'uncertain',
      'ambiguous',
    ],
    [
      'partial acknowledged mutation',
      effectReceipt({ effectState: 'applied', verificationState: 'acknowledged' }),
      'applied_unverified',
      'applied',
    ],
  ] as const)('never automatically retries a %s', async (_label, receipt, disposition, status) => {
    const test = harness({ dispatchResult: receipt });

    const first = await dispatchEffectExactlyOnce(test.identity, test.ports);
    const retry = await dispatchEffectExactlyOnce(test.identity, test.ports);

    expect(first).toEqual(
      expect.objectContaining({ kind: 'settled', disposition, requiresReconciliation: true }),
    );
    expect(test.calls.settlements[0]?.nextEffectStatus).toBe(status);
    expect(retry).toEqual(
      expect.objectContaining({
        kind: 'duplicate_suppressed',
        disposition,
        requiresReconciliation: true,
      }),
    );
    expect(test.calls.dispatches).toHaveLength(1);
  });

  it('blocks provider failover after a target has claimed the exact effect', async () => {
    const test = harness();
    const first = await dispatchEffectExactlyOnce(test.identity, test.ports);
    const failoverIdentity = { ...test.identity, dispatchTargetDigest: DIGEST_D };

    const failover = await dispatchEffectExactlyOnce(failoverIdentity, test.ports);

    expect(first.kind).toBe('settled');
    expect(failover).toEqual({ kind: 'blocked', reason: 'claim_identity_conflict' });
    expect(test.calls.dispatches).toHaveLength(1);
  });

  it('does not claim after a user steering or cancellation epoch change', async () => {
    const fixture = dispatchFixture();
    const test = harness({
      state: {
        snapshot: {
          ...fixture.snapshot,
          run: { ...fixture.snapshot.run, controlEpoch: 1, updatedAt: 15 },
        },
        existingClaim: null,
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'blocked',
      reason: 'stale_control_epoch',
    });
    expect(test.calls.claims).toHaveLength(0);
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it('closes permission denial before the atomic claim', async () => {
    const fixture = dispatchFixture();
    const test = harness({
      state: {
        snapshot: {
          ...fixture.snapshot,
          run: { ...fixture.snapshot.run, permissionState: 'denied' },
          authorityCheckpoint: {
            ...fixture.snapshot.authorityCheckpoint,
            permissionState: 'denied',
          },
        },
        existingClaim: null,
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'blocked',
      reason: 'permission_not_granted',
    });
    expect(test.calls.claims).toHaveLength(0);
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it.each(['authorization_expired', 'generation_changed'] as const)(
    'honors atomic claim rejection after the read: %s',
    async (reason) => {
      const test = harness({ claimResult: { kind: 'rejected', reason } });

      await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
        kind: 'blocked',
        reason,
      });
      expect(test.calls.dispatches).toHaveLength(0);
    },
  );

  it('treats a lost claim response as uncertain and never dispatches', async () => {
    const test = harness();
    test.ports.claimAndStart = async () => {
      throw new Error('response lost after transaction');
    };

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'claim_outcome_unknown',
    });
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it('does not dispatch when a claim result violates the port contract', async () => {
    const test = harness();
    test.ports.claimAndStart = async () => ({ kind: 'claimed' }) as never;

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'claim_contract_violation',
    });
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it('rejects a claim acquired at the authorization expiry boundary', async () => {
    const test = harness({
      claimResult: {
        kind: 'claimed',
        claim: { ...claimFor(dispatchFixture().identity), claimedAt: 30 },
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'claim_contract_violation',
    });
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it.each([
    ['effect kind', effectReceipt({ effectKind: 'calendar.create' })],
    [
      'resource identity',
      effectReceipt({ resource: { kind: 'calendar_event', id: 'event-other' } }),
    ],
    ['request digest', effectReceipt({ requestDigest: `sha256:${DIGEST_A}` })],
  ] as const)('rejects collateral %s receipt evidence', async (_label, receipt) => {
    const test = harness({ dispatchResult: receipt });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'receipt_invalid',
    });
    expect(test.calls.settlements).toHaveLength(0);
    expect(test.calls.ambiguities).toEqual([
      expect.objectContaining({ reason: 'receipt_invalid' }),
    ]);
  });

  it('records thrown dispatch as ambiguous instead of retryable failure', async () => {
    const test = harness({ dispatchError: new Error('timeout after provider accepted request') });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'dispatch_threw',
    });
    expect(test.calls.ambiguities).toEqual([expect.objectContaining({ reason: 'dispatch_threw' })]);
    expect(test.calls.settlements).toHaveLength(0);
  });

  it('preserves a resource-less timeout receipt as uncertain evidence', async () => {
    const test = harness({
      dispatchResult: effectReceipt({
        effectState: 'unknown',
        verificationState: 'unverified',
        resource: undefined,
      }),
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual(
      expect.objectContaining({
        kind: 'settled',
        disposition: 'uncertain',
        requiresReconciliation: true,
      }),
    );
    expect(test.calls.settlements[0]?.nextEffectStatus).toBe('ambiguous');
  });

  it('does not report completion when durable settlement is unavailable', async () => {
    const test = harness({ settlementError: new Error('journal unavailable') });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'settlement_unavailable',
    });
    expect(test.calls.ambiguities).toEqual([
      expect.objectContaining({ reason: 'settlement_unavailable' }),
    ]);
  });

  it('fails closed on a malformed settlement result', async () => {
    const test = harness();
    test.ports.settle = async () => ({ kind: 'accepted_without_persistence' }) as never;

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'settlement_unavailable',
    });
    expect(test.calls.ambiguities).toEqual([
      expect.objectContaining({ reason: 'settlement_unavailable' }),
    ]);
  });

  it.each([
    [
      'provider failure',
      effectReceipt({
        transportState: 'rejected',
        effectState: 'failed',
        verificationState: 'unverified',
        resource: undefined,
      }),
      'failed',
    ],
    [
      'pre-dispatch cancellation',
      effectReceipt({
        transportState: 'rejected',
        effectState: 'cancelled',
        verificationState: 'unverified',
        resource: undefined,
      }),
      'cancelled',
    ],
  ] as const)('settles %s without claiming application', async (_label, receipt, disposition) => {
    const test = harness({ dispatchResult: receipt });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual(
      expect.objectContaining({
        kind: 'settled',
        disposition,
        requiresReconciliation: false,
      }),
    );
  });
});
