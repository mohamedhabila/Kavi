import {
  dispatchEffectExactlyOnce,
  settleEffectDispatchCallback,
} from '../../src/services/executionJournal/effectDispatchCoordinator';
import { DIGEST_A, DIGEST_C, DIGEST_D } from '../helpers/executionJournalMutationFixtures';
import {
  claimFor,
  dispatchFixture,
  effectDispatchHarness as harness,
  effectFreeHarness,
  effectReceipt,
} from '../helpers/effectDispatchCoordinatorFixtures';

describe('exactly-once effect dispatch coordinator', () => {
  it('rejects malformed identity before consulting any port', async () => {
    const test = harness();
    test.ports.now = jest.fn(test.ports.now);
    test.ports.readState = jest.fn(test.ports.readState);

    await expect(
      dispatchEffectExactlyOnce({ ...test.identity, runId: ' run-1' }, test.ports),
    ).resolves.toEqual({ kind: 'blocked', reason: 'invalid_request' });
    expect(test.ports.now).not.toHaveBeenCalled();
    expect(test.ports.readState).not.toHaveBeenCalled();
    expect(test.calls.claims).toHaveLength(0);
  });

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

  it('settles an effect-free dispatch without inventing a mutation', async () => {
    const test = effectFreeHarness();

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual(
      expect.objectContaining({
        kind: 'settled',
        disposition: 'verified',
        requiresReconciliation: false,
      }),
    );
    expect(test.calls.settlements[0]?.nextEffectStatus).toBe('verified');
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

  it('keeps an existing claim without a receipt in reconciliation', async () => {
    const fixture = dispatchFixture();
    const test = harness({
      state: {
        snapshot: fixture.snapshot,
        existingClaim: { claim: claimFor(fixture.identity), receipt: null },
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'claim_in_flight',
    });
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it('fails a malformed existing claim closed', async () => {
    const fixture = dispatchFixture();
    const test = harness({
      state: {
        snapshot: {
          ...fixture.snapshot,
          effect: {
            ...fixture.snapshot.effect,
            status: 'started',
            startedAt: 14,
            updatedAt: 14,
          },
        },
        existingClaim: {
          claim: { ...claimFor(fixture.identity), claimToken: ' invalid' },
          receipt: null,
        },
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'claim_contract_violation',
    });
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

  it('fails closed on an unknown claim result variant', async () => {
    const test = harness();
    test.ports.claimAndStart = async () => ({ kind: 'legacy_claimed' }) as never;

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

  it('rejects a no-effect receipt for a mutating command', async () => {
    const test = harness({
      dispatchResult: effectReceipt({
        effectState: 'none',
        verificationState: 'not_applicable',
        resource: undefined,
      }),
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'receipt_invalid',
    });
    expect(test.calls.settlements).toHaveLength(0);
  });

  it('rejects a malformed callback claim before persistence', async () => {
    const test = harness();

    await expect(
      settleEffectDispatchCallback(
        {
          claim: { ...claimFor(test.identity), claimToken: ' invalid' },
          effectClass: 'remote_mutation',
          receipt: effectReceipt(),
          observedAt: 17,
        },
        test.ports,
      ),
    ).resolves.toEqual({ kind: 'reconciliation_required', reason: 'receipt_invalid' });
    expect(test.calls.settlements).toHaveLength(0);
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

  it('keeps an explicitly rejected settlement in reconciliation', async () => {
    const test = harness({
      settlementResult: { kind: 'rejected', reason: 'receipt_conflict' },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'receipt_conflict',
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

  it('blocks when the state cannot be read', async () => {
    const missing = harness({ state: null });
    await expect(dispatchEffectExactlyOnce(missing.identity, missing.ports)).resolves.toEqual({
      kind: 'blocked',
      reason: 'state_unavailable',
    });

    const unavailable = harness();
    unavailable.ports.readState = async () => {
      throw new Error('journal unavailable');
    };
    await expect(
      dispatchEffectExactlyOnce(unavailable.identity, unavailable.ports),
    ).resolves.toEqual({ kind: 'blocked', reason: 'state_unavailable' });
  });

  it('keeps a started effect without claim evidence in reconciliation', async () => {
    const fixture = dispatchFixture();
    const test = harness({
      state: {
        snapshot: {
          ...fixture.snapshot,
          effect: {
            ...fixture.snapshot.effect,
            status: 'started',
            startedAt: 14,
            updatedAt: 14,
          },
        },
        existingClaim: null,
      },
    });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'effect_already_started',
    });
    expect(test.calls.dispatches).toHaveLength(0);
  });

  it('fails closed when the clock is unavailable after dispatch', async () => {
    const test = harness();
    test.ports.now = jest
      .fn()
      .mockReturnValueOnce(15)
      .mockImplementationOnce(() => {
        throw new Error('clock unavailable');
      });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'settlement_unavailable',
    });
    expect(test.calls.settlements).toHaveLength(0);
  });

  it('uses the claim timestamp if both dispatch and clock fail', async () => {
    const test = harness({ dispatchError: new Error('dispatch unknown') });
    test.ports.now = jest
      .fn()
      .mockReturnValueOnce(15)
      .mockImplementationOnce(() => {
        throw new Error('clock unavailable');
      });

    await expect(dispatchEffectExactlyOnce(test.identity, test.ports)).resolves.toEqual({
      kind: 'reconciliation_required',
      reason: 'dispatch_threw',
    });
    expect(test.calls.ambiguities[0]?.observedAt).toBe(15);
  });
});
