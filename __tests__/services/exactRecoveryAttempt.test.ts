import { coordinateExactRecoveryAttempt } from '../../src/services/executionJournal/exactRecoveryAttempt';
import type { ExecutionRecoveryCoordinatorOutcome } from '../../src/services/executionJournal/recoveryCoordinatorTypes';

const identity = {
  runId: 'run-1',
  controlEpoch: 2,
  snapshotUpdatedAtMillis: 3_000,
  snapshotDigest: 'a'.repeat(64),
  commandKind: 'reconcile_external_handles' as const,
  commandDigest: 'b'.repeat(64),
};

function outcome(
  value: Partial<ExecutionRecoveryCoordinatorOutcome> &
    Pick<ExecutionRecoveryCoordinatorOutcome, 'kind'>,
): ExecutionRecoveryCoordinatorOutcome {
  return {
    runId: identity.runId,
    commandKind: identity.commandKind,
    controlEpoch: identity.controlEpoch,
    snapshotDigest: identity.snapshotDigest,
    commandDigest: identity.commandDigest,
    dispatchId: 'dispatch-1',
    dispatchDigest: 'c'.repeat(64),
    fenceId: 'fence-1',
    fenceDigest: 'd'.repeat(64),
    ...value,
  } as ExecutionRecoveryCoordinatorOutcome;
}

describe('exact recovery attempt', () => {
  it.each(['completed', 'pending'] as const)('settles an exact fenced %s receipt', async (kind) => {
    const coordinate = jest.fn().mockResolvedValue(
      outcome({
        kind,
        receiptId: 'receipt-1',
        receiptDigest: 'e'.repeat(64),
        ...(kind === 'pending' ? { reason: 'remote_still_pending', retryAt: 30_000 } : {}),
      }),
    );

    await expect(coordinateExactRecoveryAttempt(identity, { coordinate })).resolves.toEqual({
      kind: 'complete',
      receiptDigest: 'e'.repeat(64),
    });
    expect(coordinate).toHaveBeenCalledWith({
      runId: 'run-1',
      expectedGeneration: {
        controlEpoch: 2,
        updatedAt: 3_000,
        snapshotDigest: 'a'.repeat(64),
      },
    });
  });

  it('blocks a mismatched generation without settling native work', async () => {
    const coordinate = jest.fn().mockResolvedValue(
      outcome({
        kind: 'completed',
        controlEpoch: 3,
        receiptId: 'receipt-1',
        receiptDigest: 'e'.repeat(64),
      }),
    );
    await expect(coordinateExactRecoveryAttempt(identity, { coordinate })).resolves.toEqual({
      kind: 'block',
      reason: 'generation_changed',
    });
  });

  it.each([
    [
      outcome({ kind: 'deferred', reason: 'generation_changed' }),
      { kind: 'block', reason: 'generation_changed' },
    ],
    [outcome({ kind: 'deferred', reason: 'query_unavailable' }), { kind: 'retry' }],
    [
      outcome({ kind: 'blocked', reason: 'authority_revoked', sourceReason: null }),
      { kind: 'block', reason: 'authority_changed' },
    ],
    [
      outcome({ kind: 'blocked', reason: 'handler_failed', sourceReason: null }),
      { kind: 'block', reason: 'handler_failed' },
    ],
    [
      outcome({ kind: 'blocked', reason: 'handler_rejected', sourceReason: null }),
      { kind: 'block', reason: 'handler_rejected' },
    ],
    [outcome({ kind: 'blocked', reason: 'cancelled', sourceReason: null }), { kind: 'cancel' }],
  ] as const)('maps coordinator closure %# consistently', async (coordinator, expected) => {
    await expect(
      coordinateExactRecoveryAttempt(identity, {
        coordinate: jest.fn().mockResolvedValue(coordinator),
      }),
    ).resolves.toEqual(expected);
  });

  it('treats coordinator unavailability as a transient retry', async () => {
    await expect(
      coordinateExactRecoveryAttempt(identity, {
        coordinate: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }),
    ).resolves.toEqual({ kind: 'retry' });
  });
});
