jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    randomUUID: jest.fn(() => 'unused-random-uuid'),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
    digest: jest.fn(
      async (_algorithm: string, value: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(Buffer.from(value)).digest()).buffer,
    ),
  };
});

import type * as SQLite from 'expo-sqlite';
import {
  closeExecutionJournalDb,
  getExecutionJournalDb,
} from '../../src/services/executionJournal/database';
import {
  createExecutionRecoveryControlStore,
  type ExecutionRecoveryControlStore,
} from '../../src/services/executionJournal/recoveryControlStore';
import type {
  ExecutionRecoveryAuthorityInput,
  ExecutionRecoveryDispatchFenceIntent,
} from '../../src/services/executionJournal/recoveryCoordinatorTypes';
import { transitionExecutionRun } from '../../src/services/executionJournal/mutations';
import { seedExecutionRun } from '../helpers/executionJournalMutationFixtures';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests: () => void;
};

const SNAPSHOT_DIGEST = 'a'.repeat(64);
const COMMAND_DIGEST = 'b'.repeat(64);

function authorityInput(updatedAt = 10): ExecutionRecoveryAuthorityInput {
  return {
    runId: 'run-1',
    controlEpoch: 0,
    updatedAt,
    snapshotDigest: SNAPSHOT_DIGEST,
    commandKind: 'reconcile_external_handles',
    commandDigest: COMMAND_DIGEST,
  };
}

async function fenceIntent(
  store: ExecutionRecoveryControlStore,
  input = authorityInput(),
): Promise<ExecutionRecoveryDispatchFenceIntent> {
  const authority = await store.readAuthority(input);
  if (authority.kind !== 'authority_snapshot') throw new Error('expected authority snapshot');
  return {
    ...input,
    cancellationState: authority.cancellationState,
    executionAuthority: authority.executionAuthority,
    authorityDigest: authority.authorityDigest,
  };
}

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
});

afterEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
});

describe('persistent execution recovery authority and dispatch fences', () => {
  function makeStore(clock: () => number, ids: string[]): ExecutionRecoveryControlStore {
    return createExecutionRecoveryControlStore({
      clock,
      fenceLeaseMs: 1_000,
      createId: (kind) => `${kind}-${ids.shift() ?? 'missing'}`,
    });
  }

  it('derives authority from the canonical journal and persists one exact command fence', async () => {
    seedExecutionRun();
    const store = makeStore(() => 100, ['dispatch-1', 'fence-1', 'dispatch-2', 'fence-2']);
    const intent = await fenceIntent(store);

    const acquired = await store.acquireDispatchFence(intent);
    const contended = await store.acquireDispatchFence(intent);

    expect(acquired).toEqual({
      kind: 'fence_acquired',
      dispatchId: 'dispatch-dispatch-1',
      dispatchDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      fenceId: 'fence-fence-1',
      fenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(contended).toEqual({ kind: 'fence_deferred', reason: 'fence_contended' });
    expect(
      getExecutionJournalDb().getFirstSync<Record<string, unknown>>(
        `SELECT run_id, control_epoch, command_kind, cancellation_state,
                execution_authority, state
         FROM execution_recovery_dispatches`,
      ),
    ).toEqual({
      run_id: 'run-1',
      control_epoch: 0,
      command_kind: 'reconcile_external_handles',
      cancellation_state: 'active',
      execution_authority: 'granted',
      state: 'acquired',
    });
  });

  it('reclaims only an expired read-only reconciliation fence', async () => {
    seedExecutionRun();
    let now = 100;
    const store = makeStore(() => now, ['dispatch-1', 'fence-1', 'dispatch-2', 'fence-2']);
    const intent = await fenceIntent(store);
    const first = await store.acquireDispatchFence(intent);
    now = 1_101;

    const reclaimed = await store.acquireDispatchFence(intent);

    expect(first.kind).toBe('fence_acquired');
    expect(reclaimed).toEqual({
      kind: 'fence_acquired',
      dispatchId: 'dispatch-dispatch-1',
      dispatchDigest: first.kind === 'fence_acquired' ? first.dispatchDigest : expect.any(String),
      fenceId: 'fence-fence-2',
      fenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(reclaimed).not.toEqual(expect.objectContaining({ fenceId: 'fence-fence-1' }));
  });

  it('persists cancellation intent and invalidates the prior authority generation', async () => {
    seedExecutionRun();
    const store = makeStore(() => 100, ['dispatch-1', 'fence-1']);
    const oldInput = authorityInput();
    const oldIntent = await fenceIntent(store, oldInput);

    expect(
      store.requestCancellation({ runId: 'run-1', expectedControlEpoch: 0, occurredAt: 11 }),
    ).toEqual({
      runId: 'run-1',
      controlEpoch: 0,
      cancellationState: 'cancel_requested',
      updatedAt: 11,
    });
    await expect(store.readAuthority(oldInput)).resolves.toEqual({
      kind: 'control_deferred',
      reason: 'generation_changed',
    });
    await expect(store.acquireDispatchFence(oldIntent)).resolves.toEqual({
      kind: 'fence_deferred',
      reason: 'fence_changed',
    });
    await expect(store.readAuthority(authorityInput(11))).resolves.toEqual(
      expect.objectContaining({
        kind: 'authority_snapshot',
        cancellationState: 'cancel_requested',
      }),
    );
  });

  it('makes journal cancellation terminal state authoritative in the same transaction', () => {
    seedExecutionRun();
    transitionExecutionRun({
      runId: 'run-1',
      expectedStatus: 'queued',
      nextStatus: 'cancelled',
      expectedControlEpoch: 0,
      nextControlEpoch: 0,
      occurredAt: 11,
    });

    expect(
      getExecutionJournalDb().getFirstSync<{ cancellation_state: string }>(
        'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
        'run-1',
      ),
    ).toEqual({ cancellation_state: 'cancelled' });
  });

  it('fails closed when the control row is unavailable instead of inventing authority', async () => {
    seedExecutionRun();
    const database = getExecutionJournalDb() as SQLite.SQLiteDatabase;
    database.runSync('DELETE FROM execution_recovery_controls WHERE run_id = ?', 'run-1');
    const store = makeStore(() => 100, []);

    await expect(store.readAuthority(authorityInput())).resolves.toEqual({
      kind: 'control_deferred',
      reason: 'control_unavailable',
    });
  });
});
