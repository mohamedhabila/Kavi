jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
    digest: jest.fn(async (_algorithm: string, value: Uint8Array) =>
      Uint8Array.from(createHash('sha256').update(Buffer.from(value)).digest()).buffer,
    ),
  };
});

import * as Crypto from 'expo-crypto';
import type { ExecutionRecoveryQueryResult } from '../../src/services/executionJournal/recoveryQuery';
import { coordinateExecutionRecovery } from '../../src/services/executionJournal/recoveryCoordinator';
import {
  COORDINATOR_AUTHORITY_DIGEST,
  COORDINATOR_BLOCK_COMMAND,
  COORDINATOR_COMMANDS,
  COORDINATOR_DISPATCH_DIGEST,
  COORDINATOR_FENCE_DIGEST,
  COORDINATOR_RECEIPT_DIGEST,
  COORDINATOR_ROUTING_CASES,
  COORDINATOR_SNAPSHOT_DIGEST,
  coordinatorAuthority,
  expectNoHandlerCalls,
  makeHarness,
} from '../helpers/executionRecoveryCoordinatorFixtures';

describe('execution recovery coordinator routing', () => {
  it.each(COORDINATOR_ROUTING_CASES)(
    'revalidates and routes exactly one %s command',
    async (commandKind, expectedHandler, command) => {
      const harness = makeHarness(command);

      const outcome = await coordinateExecutionRecovery(
        { queryResult: harness.initial },
        harness.ports,
      );

      expect(harness.events).toEqual(['query', 'authority', 'fence', expectedHandler]);
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') throw new Error('expected completed outcome');
      expect(harness.queryRecovery).toHaveBeenCalledWith({
        runId: 'run-1',
        expectedGeneration: harness.initial.generation,
      });
      const intent = {
        runId: 'run-1',
        controlEpoch: 0,
        updatedAt: 100,
        snapshotDigest: COORDINATOR_SNAPSHOT_DIGEST,
        commandKind,
        commandDigest: outcome.commandDigest,
      };
      expect(harness.readAuthority).toHaveBeenCalledWith(intent);
      expect(outcome.commandDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(harness.acquireDispatchFence).toHaveBeenCalledWith({
        ...intent,
        cancellationState: 'active',
        executionAuthority: 'granted',
        authorityDigest: COORDINATOR_AUTHORITY_DIGEST,
      });
      for (const [name, handler] of Object.entries(harness.handlers)) {
        expect(handler).toHaveBeenCalledTimes(name === expectedHandler ? 1 : 0);
      }
      expect(harness.handlers[expectedHandler]).toHaveBeenCalledWith({
        command,
        context: {
          fence: {
            ...intent,
            cancellationState: 'active',
            executionAuthority: 'granted',
            authorityDigest: COORDINATOR_AUTHORITY_DIGEST,
            dispatchId: 'dispatch-1',
            dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
            fenceId: 'fence-1',
            fenceDigest: COORDINATOR_FENCE_DIGEST,
          },
          generation: harness.initial.generation,
        },
      });
      expect(outcome).toEqual({
        kind: 'completed',
        runId: 'run-1',
        commandKind,
        controlEpoch: 0,
        snapshotDigest: COORDINATOR_SNAPSHOT_DIGEST,
        commandDigest: outcome.commandDigest,
        authorityDigest: COORDINATOR_AUTHORITY_DIGEST,
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
        receiptId: `receipt-${expectedHandler}`,
        receiptDigest: COORDINATOR_RECEIPT_DIGEST,
      });
    },
  );

  it('propagates a receipt-bearing pending result without calling it completion', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.reconcile_external_handles);
    harness.handlers.reconcileExternalHandles.mockResolvedValueOnce({
      kind: 'pending',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
      receiptId: 'receipt-pending',
      receiptDigest: COORDINATOR_RECEIPT_DIGEST,
      reason: 'remote_still_pending',
      retryAt: 1_000,
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'pending',
        reason: 'remote_still_pending',
        retryAt: 1_000,
        receiptId: 'receipt-pending',
      }),
    );
  });

  it('propagates a persisted handler block through the closed source reason', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.reconcile_external_handles);
    harness.handlers.reconcileExternalHandles.mockResolvedValueOnce({
      kind: 'blocked',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
      receiptId: 'receipt-blocked',
      receiptDigest: COORDINATOR_RECEIPT_DIGEST,
      reason: 'remote_action_required',
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        reason: 'handler_blocked',
        sourceReason: 'remote_action_required',
      }),
    );
  });

  it('blocks an unavailable command before acquiring a permanent fence', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step);
    const ports = { ...harness.ports, handlers: {} };

    const outcome = await coordinateExecutionRecovery({ queryResult: harness.initial }, ports);

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'handler_unavailable' }),
    );
    expect(harness.acquireDispatchFence).not.toHaveBeenCalled();
  });

  it('returns a planner block without consulting any dispatch port', async () => {
    const harness = makeHarness(COORDINATOR_BLOCK_COMMAND);

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual({
      kind: 'blocked',
      runId: 'run-1',
      commandKind: 'block',
      controlEpoch: 0,
      snapshotDigest: COORDINATOR_SNAPSHOT_DIGEST,
      commandDigest: null,
      dispatchId: null,
      dispatchDigest: null,
      fenceId: null,
      fenceDigest: null,
      reason: 'planner_blocked',
      sourceReason: 'run_blocked',
    });
    expect(harness.events).toEqual([]);
    expectNoHandlerCalls(harness.handlers);
  });

  it('returns an initial query block without opening another authority path', async () => {
    const harness = makeHarness();
    const queryResult: ExecutionRecoveryQueryResult = {
      kind: 'query_blocked',
      runId: 'run-1',
      generation: null,
      reason: 'malformed_row',
    };

    const outcome = await coordinateExecutionRecovery({ queryResult }, harness.ports);

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        reason: 'query_blocked',
        sourceReason: 'malformed_row',
      }),
    );
    expect(harness.events).toEqual([]);
  });

  it.each([
    ['generation_mismatch', 'generation_changed'],
    ['journal_unavailable', 'query_unavailable'],
  ] as const)('defers transient initial query state %s', async (sourceReason, reason) => {
    const harness = makeHarness();
    const queryResult: ExecutionRecoveryQueryResult = {
      kind: 'query_blocked',
      runId: 'run-1',
      generation: null,
      reason: sourceReason,
    };

    const outcome = await coordinateExecutionRecovery({ queryResult }, harness.ports);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'deferred', reason }));
    expect(harness.events).toEqual([]);
  });

  it('defers without reading state when the closed command digest is unavailable', async () => {
    const harness = makeHarness();
    jest.mocked(Crypto.digest).mockRejectedValueOnce(new Error('private crypto error'));

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'dispatch_fence_unavailable' }),
    );
    expect(JSON.stringify(outcome)).not.toContain('private crypto error');
    expect(harness.events).toEqual([]);
  });
});

describe('execution recovery coordinator concurrency and authority fences', () => {
  it('defers when concurrent progress invalidates the snapshot generation', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_persisted_tool_batch, {
      current: {
        kind: 'query_blocked',
        runId: 'run-1',
        generation: null,
        reason: 'generation_mismatch',
      },
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'generation_changed' }),
    );
    expect(harness.events).toEqual(['query']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks when the authority control epoch no longer owns the command', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
      authority: coordinatorAuthority({ controlEpoch: 1 }),
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'control_epoch_changed' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks active execution when authority was revoked after planning', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_persisted_tool_batch, {
      authority: coordinatorAuthority({ executionAuthority: 'revoked' }),
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'authority_revoked' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
    expectNoHandlerCalls(harness.handlers);
  });

  it.each(['cancel_requested', 'cancelled'] as const)(
    'blocks active execution when cancellation is %s',
    async (cancellationState) => {
      const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
        authority: coordinatorAuthority({ cancellationState }),
      });

      const outcome = await coordinateExecutionRecovery(
        { queryResult: harness.initial },
        harness.ports,
      );

      expect(outcome).toEqual(expect.objectContaining({ kind: 'blocked', reason: 'cancelled' }));
      expect(harness.events).toEqual(['query', 'authority']);
      expectNoHandlerCalls(harness.handlers);
    },
  );

  it.each(['pending', 'revoked', 'unavailable'] as const)(
    'reconciles existing handles when active execution authority is %s',
    async (executionAuthority) => {
      const harness = makeHarness(COORDINATOR_COMMANDS.reconcile_external_handles, {
        authority: coordinatorAuthority({
          cancellationState: 'cancelled',
          executionAuthority,
        }),
      });

      const outcome = await coordinateExecutionRecovery(
        { queryResult: harness.initial },
        harness.ports,
      );

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: 'completed',
          commandKind: 'reconcile_external_handles',
        }),
      );
      expect(harness.events).toEqual(['query', 'authority', 'fence', 'reconcileExternalHandles']);
      expect(harness.acquireDispatchFence).toHaveBeenCalledWith(
        expect.objectContaining({ cancellationState: 'cancelled', executionAuthority }),
      );
      expect(harness.handlers.resumePersistedToolBatch).not.toHaveBeenCalled();
    },
  );

  it('defers pending authority before acquiring a dispatch fence', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_review, {
      authority: coordinatorAuthority({ executionAuthority: 'pending' }),
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'authority_pending' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
  });

  it('defers a failed generation re-read without consulting authority', async () => {
    const harness = makeHarness();
    harness.queryRecovery.mockRejectedValueOnce(new Error('private database failure'));

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'query_unavailable' }),
    );
    expect(JSON.stringify(outcome)).not.toContain('private database failure');
    expect(harness.events).toEqual([]);
  });

  it.each([
    ['journal_unavailable', 'deferred', 'query_unavailable'],
    ['run_unavailable', 'blocked', 'revalidation_blocked'],
  ] as const)(
    'classifies a revalidation %s result as %s',
    async (sourceReason, outcomeKind, reason) => {
      const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
        current: {
          kind: 'query_blocked',
          runId: 'run-1',
          generation: null,
          reason: sourceReason,
        },
      });

      const outcome = await coordinateExecutionRecovery(
        { queryResult: harness.initial },
        harness.ports,
      );

      expect(outcome).toEqual(expect.objectContaining({ kind: outcomeKind, reason }));
      expect(harness.events).toEqual(['query']);
    },
  );

  it('defers unavailable active-execution authority', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
      authority: coordinatorAuthority({ executionAuthority: 'unavailable' }),
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'authority_unavailable' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
  });

  it('defers only when control ownership itself is unavailable for reconciliation', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.reconcile_external_handles, {
      authority: { kind: 'control_deferred', reason: 'control_unavailable' },
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'authority_unavailable' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
  });

  it('defers an authority-port exception without fencing or dispatching', async () => {
    const harness = makeHarness();
    harness.readAuthority.mockRejectedValueOnce(new Error('private authority failure'));

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'authority_unavailable' }),
    );
    expect(harness.events).toEqual(['query']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks malformed authority metadata without using a fallback', async () => {
    const harness = makeHarness();
    harness.readAuthority.mockResolvedValueOnce({
      ...coordinatorAuthority(),
      authorityDigest: 'invalid',
    } as never);

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'invalid_authority' }),
    );
    expect(harness.events).toEqual(['query']);
    expectNoHandlerCalls(harness.handlers);
  });
});

describe('execution recovery coordinator single-dispatch fence', () => {
  it('dispatches once and defers a duplicate without calling the handler again', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step);
    harness.acquireDispatchFence
      .mockResolvedValueOnce({
        kind: 'fence_acquired',
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
      })
      .mockResolvedValueOnce({
        kind: 'duplicate',
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
      });

    const first = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );
    const duplicate = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(first.kind).toBe('completed');
    expect(duplicate).toEqual(
      expect.objectContaining({
        kind: 'deferred',
        reason: 'duplicate_dispatch',
        dispatchId: 'dispatch-1',
      }),
    );
    expect(harness.handlers.resumeModelStep).toHaveBeenCalledTimes(1);
  });

  it('never retries or infers success when a fenced mutating handler throws', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_persisted_tool_batch);
    harness.acquireDispatchFence
      .mockResolvedValueOnce({
        kind: 'fence_acquired',
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
      })
      .mockResolvedValueOnce({
        kind: 'duplicate',
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
      });
    harness.handlers.resumePersistedToolBatch.mockRejectedValueOnce(
      new Error('secret remote mutation failure'),
    );

    const failed = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );
    const repeated = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(failed).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        reason: 'handler_failed',
        dispatchId: 'dispatch-1',
      }),
    );
    expect(JSON.stringify(failed)).not.toMatch(/secret|remote mutation failure/u);
    expect(repeated).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'duplicate_dispatch' }),
    );
    expect(harness.handlers.resumePersistedToolBatch).toHaveBeenCalledTimes(1);
  });

  it('defers when the handler atomically rejects a stale authority-bound fence', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_persisted_tool_batch);
    harness.handlers.resumePersistedToolBatch.mockResolvedValueOnce({
      kind: 'rejected',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
      reason: 'authority_changed',
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'deferred',
        reason: 'dispatch_fence_changed',
        fenceId: 'fence-1',
      }),
    );
    expect(harness.handlers.resumePersistedToolBatch).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit completed receipt instead of treating rejection as completion', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.continue_after_tool_result);
    harness.handlers.continueAfterToolResult.mockResolvedValueOnce({
      kind: 'rejected',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
      reason: 'prerequisite_changed',
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'handler_rejected' }),
    );
    expect(harness.handlers.continueAfterToolResult).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['fence_contended', 'dispatch_fence_contended'],
    ['fence_unavailable', 'dispatch_fence_unavailable'],
  ] as const)('defers a dispatch fence result %s', async (sourceReason, reason) => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
      fence: { kind: 'fence_deferred', reason: sourceReason },
    });

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(expect.objectContaining({ kind: 'deferred', reason }));
    expect(harness.events).toEqual(['query', 'authority', 'fence']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('defers a dispatch-fence exception without dispatching', async () => {
    const harness = makeHarness();
    harness.acquireDispatchFence.mockRejectedValueOnce(new Error('private fence failure'));

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'dispatch_fence_unavailable' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks malformed dispatch-fence metadata without dispatching', async () => {
    const harness = makeHarness();
    harness.acquireDispatchFence.mockResolvedValueOnce({
      kind: 'fence_acquired',
      dispatchId: 'dispatch-1',
      dispatchDigest: 'invalid',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
    } as never);

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'invalid_dispatch_fence' }),
    );
    expect(harness.events).toEqual(['query', 'authority']);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks a malformed handler receipt instead of inferring dispatch', async () => {
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_review);
    harness.handlers.resumeReview.mockResolvedValueOnce({
      kind: 'completed',
      fenceId: 'fence-1',
      fenceDigest: COORDINATOR_FENCE_DIGEST,
      receiptId: 'receipt-1',
      receiptDigest: 'invalid',
    } as never);

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(expect.objectContaining({ kind: 'blocked', reason: 'handler_failed' }));
    expect(harness.handlers.resumeReview).toHaveBeenCalledTimes(1);
  });
});
