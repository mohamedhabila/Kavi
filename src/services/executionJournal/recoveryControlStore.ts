import * as Crypto from 'expo-crypto';
import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow } from './decoders';
import { readRun, withImmediateTransaction } from './mutationStore';
import {
  DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS,
  EXECUTION_RECOVERY_AUTHORITY_STATES,
  EXECUTION_RECOVERY_CANCELLATION_STATES,
  EXECUTION_RECOVERY_DISPATCH_STATES,
  type ExecutionRecoveryAuthorityInput,
  type ExecutionRecoveryAuthorityResult,
  type ExecutionRecoveryAuthorityState,
  type ExecutionRecoveryCancellationState,
  type ExecutionRecoveryDispatchFenceIntent,
  type ExecutionRecoveryDispatchFenceResult,
  type ExecutionRecoveryDispatchState,
} from './recoveryCoordinatorTypes';
import type {
  ExecutionApprovalState,
  ExecutionCheckpointRecord,
  ExecutionRunRecord,
} from './types';

const AUTHORITY_DIGEST_FORMAT = 'kavi.execution-recovery-authority.v1';
const DISPATCH_DIGEST_FORMAT = 'kavi.execution-recovery-dispatch.v1';
const FENCE_DIGEST_FORMAT = 'kavi.execution-recovery-fence.v1';
const DEFAULT_FENCE_LEASE_MS = 2 * 60 * 1_000;
const MINIMUM_FENCE_LEASE_MS = 1_000;
const MAXIMUM_FENCE_LEASE_MS = 10 * 60 * 1_000;

interface RecoveryControlRow {
  run_id: string;
  cancellation_state: string;
  updated_at: number;
}

interface RecoveryDispatchRow {
  dispatch_id: string;
  dispatch_digest: string;
  fence_id: string;
  fence_digest: string;
  fence_expires_at: number;
  state: string;
  updated_at: number;
}

interface AuthorityAnchor {
  run: ExecutionRunRecord;
  checkpoint: ExecutionCheckpointRecord;
  cancellationState: ExecutionRecoveryCancellationState;
  controlUpdatedAt: number;
  executionAuthority: ExecutionRecoveryAuthorityState;
}

export interface ExecutionRecoveryControlStoreOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
  clock?: () => number;
  createId?: (kind: 'dispatch' | 'fence' | 'receipt') => string;
  digest?: (value: string) => Promise<string>;
  fenceLeaseMs?: number;
}

export interface RequestExecutionRecoveryCancellationInput {
  runId: string;
  expectedControlEpoch: number;
  occurredAt: number;
}

export interface ExecutionRecoveryCancellationReceipt {
  runId: string;
  controlEpoch: number;
  cancellationState: 'cancel_requested';
  updatedAt: number;
}

export interface ExecutionRecoveryControlStore {
  readAuthority(input: ExecutionRecoveryAuthorityInput): Promise<ExecutionRecoveryAuthorityResult>;
  acquireDispatchFence(
    input: ExecutionRecoveryDispatchFenceIntent,
  ): Promise<ExecutionRecoveryDispatchFenceResult>;
  requestCancellation(
    input: RequestExecutionRecoveryCancellationInput,
  ): ExecutionRecoveryCancellationReceipt;
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validAuthorityInput(value: unknown): value is ExecutionRecoveryAuthorityInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).sort().join(',') ===
      'commandDigest,commandKind,controlEpoch,runId,snapshotDigest,updatedAt' &&
    validId(input.runId) &&
    validInteger(input.controlEpoch) &&
    validInteger(input.updatedAt) &&
    validDigest(input.snapshotDigest) &&
    DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS.includes(input.commandKind as never) &&
    validDigest(input.commandDigest)
  );
}

function validFenceIntent(value: unknown): value is ExecutionRecoveryDispatchFenceIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const authorityInput = {
    runId: input.runId,
    controlEpoch: input.controlEpoch,
    updatedAt: input.updatedAt,
    snapshotDigest: input.snapshotDigest,
    commandKind: input.commandKind,
    commandDigest: input.commandDigest,
  };
  return (
    Object.keys(input).sort().join(',') ===
      'authorityDigest,cancellationState,commandDigest,commandKind,controlEpoch,executionAuthority,runId,snapshotDigest,updatedAt' &&
    validAuthorityInput(authorityInput) &&
    EXECUTION_RECOVERY_CANCELLATION_STATES.includes(input.cancellationState as never) &&
    EXECUTION_RECOVERY_AUTHORITY_STATES.includes(input.executionAuthority as never) &&
    validDigest(input.authorityDigest)
  );
}

function decodeControlRow(value: unknown): RecoveryControlRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== 'cancellation_state,run_id,updated_at' ||
    !validId(row.run_id) ||
    !EXECUTION_RECOVERY_CANCELLATION_STATES.includes(row.cancellation_state as never) ||
    !validInteger(row.updated_at)
  ) {
    return null;
  }
  return row as unknown as RecoveryControlRow;
}

function decodeDispatchRow(value: unknown): RecoveryDispatchRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
      'dispatch_digest,dispatch_id,fence_digest,fence_expires_at,fence_id,state,updated_at' ||
    !validId(row.dispatch_id) ||
    !validDigest(row.dispatch_digest) ||
    !validId(row.fence_id) ||
    !validDigest(row.fence_digest) ||
    !validInteger(row.fence_expires_at) ||
    !EXECUTION_RECOVERY_DISPATCH_STATES.includes(row.state as never) ||
    !validInteger(row.updated_at)
  ) {
    return null;
  }
  return row as unknown as RecoveryDispatchRow;
}

function deriveExecutionAuthority(
  approvalState: ExecutionApprovalState,
  permissionState: ExecutionApprovalState,
): ExecutionRecoveryAuthorityState {
  const states = [approvalState, permissionState];
  if (states.some((state) => state === 'denied' || state === 'expired')) return 'revoked';
  if (states.includes('pending')) return 'pending';
  if (states.includes('unknown')) return 'unavailable';
  return 'granted';
}

function readAuthorityAnchor(
  database: SQLite.SQLiteDatabase,
  runId: string,
): AuthorityAnchor | null {
  const run = readRun(database, runId);
  const control = decodeControlRow(
    database.getFirstSync<unknown>(
      `SELECT run_id, cancellation_state, updated_at
       FROM execution_recovery_controls WHERE run_id = ?`,
      runId,
    ),
  );
  const checkpointRow = database.getFirstSync<unknown>(
    `SELECT * FROM execution_checkpoints
     WHERE run_id = ? ORDER BY sequence DESC, id ASC LIMIT 1`,
    runId,
  );
  if (!control || !checkpointRow) return null;
  const checkpoint = decodeExecutionCheckpointRow(checkpointRow);
  if (
    control.run_id !== run.id ||
    control.updated_at > run.updatedAt ||
    checkpoint.runId !== run.id ||
    checkpoint.controlEpoch > run.controlEpoch ||
    checkpoint.resumeStrategy !== run.resumeStrategy ||
    checkpoint.approvalState !== run.approvalState ||
    checkpoint.permissionState !== run.permissionState
  ) {
    return null;
  }
  return {
    run,
    checkpoint,
    cancellationState: control.cancellation_state as ExecutionRecoveryCancellationState,
    controlUpdatedAt: control.updated_at,
    executionAuthority: deriveExecutionAuthority(run.approvalState, run.permissionState),
  };
}

function canonicalAuthority(
  input: ExecutionRecoveryAuthorityInput,
  anchor: AuthorityAnchor,
): string {
  return JSON.stringify([
    AUTHORITY_DIGEST_FORMAT,
    input.runId,
    input.controlEpoch,
    input.updatedAt,
    input.snapshotDigest,
    input.commandKind,
    input.commandDigest,
    anchor.run.status,
    anchor.run.controlEpoch,
    anchor.run.updatedAt,
    anchor.run.approvalState,
    anchor.run.permissionState,
    anchor.checkpoint.id,
    anchor.checkpoint.sequence,
    anchor.checkpoint.controlEpoch,
    anchor.cancellationState,
    anchor.controlUpdatedAt,
    anchor.executionAuthority,
  ]);
}

function sameAuthorityAnchor(left: AuthorityAnchor, right: AuthorityAnchor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function existingFenceResult(row: RecoveryDispatchRow): ExecutionRecoveryDispatchFenceResult {
  return {
    kind: 'duplicate',
    dispatchId: row.dispatch_id,
    dispatchDigest: row.dispatch_digest,
    fenceId: row.fence_id,
    fenceDigest: row.fence_digest,
  };
}

function requireClockValue(clock: () => number): number {
  const value = clock();
  if (!validInteger(value)) {
    throw new Error('execution_recovery_invalid_clock');
  }
  return value;
}

export function createExecutionRecoveryControlStore(
  options: ExecutionRecoveryControlStoreOptions = {},
): ExecutionRecoveryControlStore {
  const getDatabase = options.getDatabase ?? getExecutionJournalDb;
  const clock = options.clock ?? Date.now;
  const createId = options.createId ?? ((kind) => `${kind}-${Crypto.randomUUID()}`);
  const digest =
    options.digest ??
    ((value: string) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) as Promise<string>);
  const fenceLeaseMs = options.fenceLeaseMs ?? DEFAULT_FENCE_LEASE_MS;
  if (
    !Number.isSafeInteger(fenceLeaseMs) ||
    fenceLeaseMs < MINIMUM_FENCE_LEASE_MS ||
    fenceLeaseMs > MAXIMUM_FENCE_LEASE_MS
  ) {
    throw new Error('execution_recovery_invalid_fence_lease');
  }

  const checkedDigest = async (value: string): Promise<string> => {
    const result = await digest(value);
    if (!validDigest(result)) throw new Error('execution_recovery_invalid_digest');
    return result;
  };

  const checkedId = (kind: 'dispatch' | 'fence' | 'receipt'): string => {
    const result = createId(kind);
    if (!validId(result)) throw new Error('execution_recovery_invalid_id');
    return result;
  };

  const readAuthority = async (
    input: ExecutionRecoveryAuthorityInput,
  ): Promise<ExecutionRecoveryAuthorityResult> => {
    if (!validAuthorityInput(input)) {
      return { kind: 'control_deferred', reason: 'control_unavailable' };
    }
    try {
      const anchor = readAuthorityAnchor(getDatabase(), input.runId);
      if (!anchor) return { kind: 'control_deferred', reason: 'control_unavailable' };
      if (
        anchor.run.controlEpoch !== input.controlEpoch ||
        anchor.run.updatedAt !== input.updatedAt
      ) {
        return { kind: 'control_deferred', reason: 'generation_changed' };
      }
      const authorityDigest = await checkedDigest(canonicalAuthority(input, anchor));
      return {
        kind: 'authority_snapshot',
        runId: anchor.run.id,
        controlEpoch: anchor.run.controlEpoch,
        cancellationState: anchor.cancellationState,
        executionAuthority: anchor.executionAuthority,
        authorityDigest,
      };
    } catch {
      return { kind: 'control_deferred', reason: 'control_unavailable' };
    }
  };

  const acquireDispatchFence = async (
    input: ExecutionRecoveryDispatchFenceIntent,
  ): Promise<ExecutionRecoveryDispatchFenceResult> => {
    if (!validFenceIntent(input)) {
      return { kind: 'fence_deferred', reason: 'fence_unavailable' };
    }

    const database = getDatabase();
    const anchor = readAuthorityAnchor(database, input.runId);
    if (
      !anchor ||
      anchor.run.controlEpoch !== input.controlEpoch ||
      anchor.run.updatedAt !== input.updatedAt
    ) {
      return { kind: 'fence_deferred', reason: 'fence_changed' };
    }
    const currentAuthorityDigest = await checkedDigest(canonicalAuthority(input, anchor));
    if (
      currentAuthorityDigest !== input.authorityDigest ||
      anchor.cancellationState !== input.cancellationState ||
      anchor.executionAuthority !== input.executionAuthority
    ) {
      return { kind: 'fence_deferred', reason: 'fence_changed' };
    }

    const dispatchId = checkedId('dispatch');
    const fenceId = checkedId('fence');
    const now = Math.max(requireClockValue(clock), anchor.run.updatedAt);
    const fenceExpiresAt = now + fenceLeaseMs;
    if (!Number.isSafeInteger(fenceExpiresAt)) {
      return { kind: 'fence_deferred', reason: 'fence_unavailable' };
    }
    const dispatchDigest = await checkedDigest(
      JSON.stringify([DISPATCH_DIGEST_FORMAT, input, dispatchId]),
    );
    const fenceDigest = await checkedDigest(
      JSON.stringify([FENCE_DIGEST_FORMAT, input.commandDigest, fenceId, fenceExpiresAt]),
    );

    return withImmediateTransaction(database, () => {
      const lockedAnchor = readAuthorityAnchor(database, input.runId);
      if (!lockedAnchor || !sameAuthorityAnchor(anchor, lockedAnchor)) {
        return { kind: 'fence_deferred', reason: 'fence_changed' };
      }

      const existing = decodeDispatchRow(
        database.getFirstSync<unknown>(
          `SELECT dispatch_id, dispatch_digest, fence_id, fence_digest,
                  fence_expires_at, state, updated_at
           FROM execution_recovery_dispatches
           WHERE run_id = ? AND control_epoch = ?
             AND snapshot_digest = ? AND command_digest = ?`,
          input.runId,
          input.controlEpoch,
          input.snapshotDigest,
          input.commandDigest,
        ),
      );
      if (existing) {
        const state = existing.state as ExecutionRecoveryDispatchState;
        if (['completed', 'pending', 'blocked'].includes(state)) {
          return existingFenceResult(existing);
        }
        if (existing.fence_expires_at > now) {
          return { kind: 'fence_deferred', reason: 'fence_contended' };
        }
        if (input.commandKind !== 'reconcile_external_handles') {
          return existingFenceResult(existing);
        }
        const updatedAt = Math.max(now, existing.updated_at + 1);
        const result = database.runSync(
          `UPDATE execution_recovery_dispatches
           SET fence_id = ?, fence_digest = ?, fence_expires_at = ?,
               state = 'acquired', updated_at = ?
           WHERE dispatch_id = ? AND state IN ('acquired', 'claimed')
             AND fence_expires_at <= ?`,
          fenceId,
          fenceDigest,
          Math.max(fenceExpiresAt, updatedAt + fenceLeaseMs),
          updatedAt,
          existing.dispatch_id,
          now,
        );
        if (result.changes !== 1) {
          return { kind: 'fence_deferred', reason: 'fence_contended' };
        }
        return {
          kind: 'fence_acquired',
          dispatchId: existing.dispatch_id,
          dispatchDigest: existing.dispatch_digest,
          fenceId,
          fenceDigest,
        };
      }

      database.runSync(
        `INSERT INTO execution_recovery_dispatches (
           dispatch_id, run_id, control_epoch, snapshot_digest, command_kind,
           command_digest, cancellation_state, execution_authority,
           authority_digest, dispatch_digest, fence_id, fence_digest,
           fence_expires_at, state, receipt_id, receipt_digest, outcome_reason,
           retry_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'acquired', NULL, NULL, NULL, NULL, ?, ?)`,
        dispatchId,
        input.runId,
        input.controlEpoch,
        input.snapshotDigest,
        input.commandKind,
        input.commandDigest,
        input.cancellationState,
        input.executionAuthority,
        input.authorityDigest,
        dispatchDigest,
        fenceId,
        fenceDigest,
        fenceExpiresAt,
        now,
        now,
      );
      return {
        kind: 'fence_acquired',
        dispatchId,
        dispatchDigest,
        fenceId,
        fenceDigest,
      };
    });
  };

  const requestCancellation = (
    input: RequestExecutionRecoveryCancellationInput,
  ): ExecutionRecoveryCancellationReceipt => {
    if (
      !input ||
      !validId(input.runId) ||
      !validInteger(input.expectedControlEpoch) ||
      !validInteger(input.occurredAt)
    ) {
      throw new Error('execution_recovery_invalid_cancellation_request');
    }
    const database = getDatabase();
    return withImmediateTransaction(database, () => {
      const run = readRun(database, input.runId);
      if (run.controlEpoch !== input.expectedControlEpoch) {
        throw new Error('execution_recovery_stale_control_epoch');
      }
      if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        throw new Error('execution_recovery_terminal_run');
      }
      const control = decodeControlRow(
        database.getFirstSync<unknown>(
          `SELECT run_id, cancellation_state, updated_at
           FROM execution_recovery_controls WHERE run_id = ?`,
          run.id,
        ),
      );
      if (!control || control.cancellation_state !== 'active') {
        throw new Error('execution_recovery_cancellation_state_conflict');
      }
      if (input.occurredAt <= Math.max(run.updatedAt, control.updated_at)) {
        throw new Error('execution_recovery_non_monotonic_time');
      }
      const controlResult = database.runSync(
        `UPDATE execution_recovery_controls
         SET cancellation_state = 'cancel_requested', updated_at = ?
         WHERE run_id = ? AND cancellation_state = 'active'`,
        input.occurredAt,
        run.id,
      );
      const runResult = database.runSync(
        `UPDATE execution_runs SET updated_at = ?
         WHERE id = ? AND control_epoch = ? AND updated_at = ?`,
        input.occurredAt,
        run.id,
        run.controlEpoch,
        run.updatedAt,
      );
      if (controlResult.changes !== 1 || runResult.changes !== 1) {
        throw new Error('execution_recovery_concurrent_cancellation');
      }
      return {
        runId: run.id,
        controlEpoch: run.controlEpoch,
        cancellationState: 'cancel_requested',
        updatedAt: input.occurredAt,
      };
    });
  };

  return {
    readAuthority,
    acquireDispatchFence,
    requestCancellation,
  };
}
