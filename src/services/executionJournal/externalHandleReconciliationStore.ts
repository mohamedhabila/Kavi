import * as Crypto from 'expo-crypto';
import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow, decodeExecutionExternalHandleRow } from './decoders';
import {
  checkpointRow,
  insertCheckpoint,
  readEffect,
  readRun,
  withImmediateTransaction,
} from './mutationStore';
import type { ExecutionRecoveryControlStoreOptions } from './recoveryControlStore';
import {
  DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS,
  EXECUTION_RECOVERY_AUTHORITY_STATES,
  EXECUTION_RECOVERY_CANCELLATION_STATES,
  EXECUTION_RECOVERY_DISPATCH_STATES,
  EXECUTION_RECOVERY_HANDLER_BLOCK_REASONS,
  EXECUTION_RECOVERY_PENDING_REASONS,
  type ExecutionRecoveryAuthorityState,
  type ExecutionRecoveryCancellationState,
  type ExecutionRecoveryHandlerInput,
  type ExecutionRecoveryHandlerRejectionReason,
  type ExecutionRecoveryHandlerResult,
} from './recoveryCoordinatorTypes';
import type {
  CompleteExecutionExternalHandleReconciliationInput,
  ExecutionExternalHandleReconciliationClaimResult,
  ExecutionExternalHandleReconciliationStore,
} from './externalHandleReconciliationTypes';
import {
  canTransitionExecutionEffect,
  canTransitionExecutionExternalHandle,
  canTransitionExecutionRun,
} from './transitions';
import {
  assessExternalHandleMonitorReadiness,
  recordExternalHandleMonitorObservation,
} from './monitorRecords';
import type {
  ExecutionApprovalState,
  ExecutionExternalHandleRecord,
  ExecutionRunRecord,
} from './types';

const RECEIPT_DIGEST_FORMAT = 'kavi.execution-recovery-receipt.v1';
const DEFAULT_FENCE_LEASE_MS = 2 * 60 * 1_000;
const MINIMUM_FENCE_LEASE_MS = 1_000;
const MAXIMUM_FENCE_LEASE_MS = 10 * 60 * 1_000;

interface RecoveryClaimDispatchRow {
  dispatch_id: string;
  run_id: string;
  control_epoch: number;
  snapshot_digest: string;
  command_kind: string;
  command_digest: string;
  cancellation_state: string;
  execution_authority: string;
  authority_digest: string;
  dispatch_digest: string;
  fence_id: string;
  fence_digest: string;
  fence_expires_at: number;
  state: string;
  updated_at: number;
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

function sortedUniqueIds(values: readonly string[]): string[] | null {
  if (!Array.isArray(values) || values.length === 0 || !values.every(validId)) return null;
  const sorted = [...new Set(values)].sort();
  return sorted.length === values.length && JSON.stringify(sorted) === JSON.stringify(values)
    ? sorted
    : null;
}

function validHandlerInput(
  value: unknown,
): value is ExecutionRecoveryHandlerInput<'reconcile_external_handles'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(',') !== 'command,context' ||
    !input.command ||
    typeof input.command !== 'object' ||
    Array.isArray(input.command) ||
    !input.context ||
    typeof input.context !== 'object' ||
    Array.isArray(input.context)
  ) {
    return false;
  }
  const command = input.command as Record<string, unknown>;
  const context = input.context as Record<string, unknown>;
  const fence = context.fence as Record<string, unknown> | undefined;
  const generation = context.generation as Record<string, unknown> | undefined;
  return (
    Object.keys(command).sort().join(',') === 'controlEpoch,effectIds,handleIds,kind,runId' &&
    command.kind === 'reconcile_external_handles' &&
    validId(command.runId) &&
    validInteger(command.controlEpoch) &&
    Boolean(sortedUniqueIds(command.effectIds as string[])) &&
    Boolean(sortedUniqueIds(command.handleIds as string[])) &&
    Object.keys(context).sort().join(',') === 'fence,generation' &&
    Boolean(fence) &&
    Boolean(generation) &&
    Object.keys(fence!).sort().join(',') ===
      'authorityDigest,cancellationState,commandDigest,commandKind,controlEpoch,dispatchDigest,dispatchId,executionAuthority,fenceDigest,fenceId,runId,snapshotDigest,updatedAt' &&
    validId(fence!.runId) &&
    validInteger(fence!.controlEpoch) &&
    validInteger(fence!.updatedAt) &&
    validDigest(fence!.snapshotDigest) &&
    fence!.commandKind === 'reconcile_external_handles' &&
    validDigest(fence!.commandDigest) &&
    EXECUTION_RECOVERY_CANCELLATION_STATES.includes(fence!.cancellationState as never) &&
    EXECUTION_RECOVERY_AUTHORITY_STATES.includes(fence!.executionAuthority as never) &&
    validDigest(fence!.authorityDigest) &&
    validId(fence!.dispatchId) &&
    validDigest(fence!.dispatchDigest) &&
    validId(fence!.fenceId) &&
    validDigest(fence!.fenceDigest) &&
    Object.keys(generation!).sort().join(',') === 'controlEpoch,snapshotDigest,updatedAt' &&
    validInteger(generation!.controlEpoch) &&
    validInteger(generation!.updatedAt) &&
    validDigest(generation!.snapshotDigest) &&
    command.runId === fence!.runId &&
    command.controlEpoch === fence!.controlEpoch &&
    command.controlEpoch === generation!.controlEpoch &&
    fence!.updatedAt === generation!.updatedAt &&
    fence!.snapshotDigest === generation!.snapshotDigest
  );
}

function decodeDispatch(value: unknown): RecoveryClaimDispatchRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !==
      'authority_digest,cancellation_state,command_digest,command_kind,control_epoch,dispatch_digest,dispatch_id,execution_authority,fence_digest,fence_expires_at,fence_id,run_id,snapshot_digest,state,updated_at' ||
    !validId(row.dispatch_id) ||
    !validId(row.run_id) ||
    !validInteger(row.control_epoch) ||
    !validDigest(row.snapshot_digest) ||
    !DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS.includes(row.command_kind as never) ||
    !validDigest(row.command_digest) ||
    !EXECUTION_RECOVERY_CANCELLATION_STATES.includes(row.cancellation_state as never) ||
    !EXECUTION_RECOVERY_AUTHORITY_STATES.includes(row.execution_authority as never) ||
    !validDigest(row.authority_digest) ||
    !validDigest(row.dispatch_digest) ||
    !validId(row.fence_id) ||
    !validDigest(row.fence_digest) ||
    !validInteger(row.fence_expires_at) ||
    !EXECUTION_RECOVERY_DISPATCH_STATES.includes(row.state as never) ||
    !validInteger(row.updated_at)
  ) {
    return null;
  }
  return row as unknown as RecoveryClaimDispatchRow;
}

function deriveAuthority(
  approvalState: ExecutionApprovalState,
  permissionState: ExecutionApprovalState,
): ExecutionRecoveryAuthorityState {
  const states = [approvalState, permissionState];
  if (states.some((state) => state === 'denied' || state === 'expired')) return 'revoked';
  if (states.includes('pending')) return 'pending';
  if (states.includes('unknown')) return 'unavailable';
  return 'granted';
}

function readCancellationState(
  database: SQLite.SQLiteDatabase,
  runId: string,
): ExecutionRecoveryCancellationState | null {
  const row = database.getFirstSync<{ cancellation_state?: unknown }>(
    'SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?',
    runId,
  );
  return row && EXECUTION_RECOVERY_CANCELLATION_STATES.includes(row.cancellation_state as never)
    ? (row.cancellation_state as ExecutionRecoveryCancellationState)
    : null;
}

function readDispatch(
  database: SQLite.SQLiteDatabase,
  dispatchId: string,
): RecoveryClaimDispatchRow | null {
  return decodeDispatch(
    database.getFirstSync<unknown>(
      `SELECT dispatch_id, run_id, control_epoch, snapshot_digest, command_kind,
              command_digest, cancellation_state, execution_authority,
              authority_digest, dispatch_digest, fence_id, fence_digest,
              fence_expires_at, state, updated_at
       FROM execution_recovery_dispatches WHERE dispatch_id = ?`,
      dispatchId,
    ),
  );
}

function isStandaloneExternalObservationRun(run: ExecutionRunRecord): boolean {
  return (
    run.durabilityClass === 'external_durable_operation' &&
    run.executionSurface === 'external_api' &&
    run.requestedCapability === 'monitor' &&
    run.resumeStrategy === 'reconcile_first' &&
    run.nextRetryPolicy === 'monitor_only'
  );
}

export function createExecutionExternalHandleReconciliationStore(
  options: ExecutionRecoveryControlStoreOptions = {},
): ExecutionExternalHandleReconciliationStore {
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
  const checkedClock = (): number => {
    const value = clock();
    if (!validInteger(value)) throw new Error('execution_recovery_invalid_clock');
    return value;
  };
  const checkedReceiptId = (): string => {
    const value = createId('receipt');
    if (!validId(value)) throw new Error('execution_recovery_invalid_id');
    return value;
  };
  const checkedDigest = async (value: string): Promise<string> => {
    const result = await digest(value);
    if (!validDigest(result)) throw new Error('execution_recovery_invalid_digest');
    return result;
  };

  const claim = (
    input: ExecutionRecoveryHandlerInput<'reconcile_external_handles'>,
  ): ExecutionExternalHandleReconciliationClaimResult => {
    if (!validHandlerInput(input)) return { kind: 'rejected', reason: 'prerequisite_changed' };
    const database = getDatabase();
    return withImmediateTransaction(database, () => {
      const { command, context } = input;
      const row = readDispatch(database, context.fence.dispatchId);
      if (!row) return { kind: 'rejected', reason: 'prerequisite_changed' };
      if (row.state !== 'acquired') return { kind: 'rejected', reason: 'duplicate_dispatch' };
      if (
        row.run_id !== command.runId ||
        row.control_epoch !== command.controlEpoch ||
        row.snapshot_digest !== context.generation.snapshotDigest ||
        row.command_kind !== command.kind ||
        row.command_digest !== context.fence.commandDigest ||
        row.dispatch_digest !== context.fence.dispatchDigest ||
        row.fence_id !== context.fence.fenceId ||
        row.fence_digest !== context.fence.fenceDigest
      ) {
        return { kind: 'rejected', reason: 'prerequisite_changed' };
      }
      const run = readRun(database, command.runId);
      if (run.controlEpoch !== command.controlEpoch) {
        return { kind: 'rejected', reason: 'control_epoch_changed' };
      }
      if (run.updatedAt !== context.generation.updatedAt) {
        return { kind: 'rejected', reason: 'generation_changed' };
      }
      const cancellationState = readCancellationState(database, run.id);
      if (
        cancellationState !== row.cancellation_state ||
        deriveAuthority(run.approvalState, run.permissionState) !== row.execution_authority ||
        row.authority_digest !== context.fence.authorityDigest
      ) {
        return { kind: 'rejected', reason: 'authority_changed' };
      }
      const now = checkedClock();
      if (row.fence_expires_at <= now) return { kind: 'rejected', reason: 'duplicate_dispatch' };

      const handleIds = sortedUniqueIds(command.handleIds)!;
      const effectIds = sortedUniqueIds(command.effectIds)!;
      const handles = database
        .getAllSync<unknown>(
          'SELECT * FROM execution_external_handles WHERE run_id = ? ORDER BY id ASC',
          run.id,
        )
        .map(decodeExecutionExternalHandleRow)
        .filter((handle) => handleIds.includes(handle.id));
      if (
        JSON.stringify(handles.map((handle) => handle.id)) !== JSON.stringify(handleIds) ||
        JSON.stringify([...new Set(handles.map((handle) => handle.effectId))].sort()) !==
          JSON.stringify(effectIds)
      ) {
        return { kind: 'rejected', reason: 'prerequisite_changed' };
      }
      const monitorReadiness = assessExternalHandleMonitorReadiness(database, run.id, handles, now);
      if (monitorReadiness.kind === 'unavailable') {
        return { kind: 'rejected', reason: 'prerequisite_changed' };
      }
      if (monitorReadiness.kind === 'not_due') {
        return { kind: 'rejected', reason: 'monitor_not_due' };
      }
      const claimedAt = Math.max(now, row.updated_at);
      const result = database.runSync(
        `UPDATE execution_recovery_dispatches
         SET state = 'claimed', fence_expires_at = ?, updated_at = ?
         WHERE dispatch_id = ? AND state = 'acquired' AND fence_id = ? AND fence_digest = ?`,
        Math.max(row.fence_expires_at, claimedAt + fenceLeaseMs),
        claimedAt,
        row.dispatch_id,
        row.fence_id,
        row.fence_digest,
      );
      return result.changes === 1
        ? { kind: 'claimed', handles }
        : { kind: 'rejected', reason: 'duplicate_dispatch' };
    });
  };

  const complete = async (
    input: CompleteExecutionExternalHandleReconciliationInput,
  ): Promise<ExecutionRecoveryHandlerResult> => {
    const fenceId = input?.context?.fence?.fenceId;
    const fenceDigest = input?.context?.fence?.fenceDigest;
    const reject = (
      reason: ExecutionRecoveryHandlerRejectionReason,
    ): ExecutionRecoveryHandlerResult => ({
      kind: 'rejected',
      fenceId: validId(fenceId) ? fenceId : 'invalid-fence',
      fenceDigest: validDigest(fenceDigest) ? fenceDigest : '0'.repeat(64),
      reason,
    });
    if (!validHandlerInput({ command: input?.command, context: input?.context })) {
      return reject('prerequisite_changed');
    }
    const observations = Array.isArray(input.observations) ? input.observations : [];
    const observationIds = sortedUniqueIds(observations.map((entry) => entry.handleId));
    const knownStatuses = ['unknown', 'pending', 'running', 'succeeded', 'failed', 'cancelled'];
    if (
      !observationIds ||
      JSON.stringify(observationIds) !== JSON.stringify(input.command.handleIds) ||
      observations.some(
        (entry) =>
          !knownStatuses.includes(entry.expectedStatus) ||
          (entry.observedStatus !== null && !knownStatuses.includes(entry.observedStatus)),
      )
    ) {
      return reject('prerequisite_changed');
    }
    const disposition = input.disposition;
    if (
      !disposition ||
      (disposition.kind === 'pending' &&
        (!EXECUTION_RECOVERY_PENDING_REASONS.includes(disposition.reason) ||
          !Number.isSafeInteger(disposition.retryAfterMs) ||
          disposition.retryAfterMs < 1_000 ||
          disposition.retryAfterMs > 24 * 60 * 60 * 1_000)) ||
      (disposition.kind === 'blocked' &&
        !EXECUTION_RECOVERY_HANDLER_BLOCK_REASONS.includes(disposition.reason)) ||
      !['completed', 'pending', 'blocked'].includes(disposition.kind)
    ) {
      return reject('prerequisite_changed');
    }
    const observedStatuses = observations.map((entry) => entry.observedStatus);
    if (
      (disposition.kind === 'completed' &&
        !observedStatuses.every(
          (status) => status !== null && ['succeeded', 'failed', 'cancelled'].includes(status),
        )) ||
      (disposition.kind === 'pending' &&
        disposition.reason === 'remote_still_pending' &&
        !observedStatuses.some((status) => status === 'pending' || status === 'running'))
    ) {
      return reject('prerequisite_changed');
    }

    const database = getDatabase();
    const currentRun = readRun(database, input.command.runId);
    const attemptedAt = Math.max(checkedClock(), currentRun.updatedAt + 1);
    const retryAt = disposition.kind === 'pending' ? attemptedAt + disposition.retryAfterMs : null;
    if (
      !Number.isSafeInteger(attemptedAt) ||
      (retryAt !== null && !Number.isSafeInteger(retryAt))
    ) {
      return reject('prerequisite_changed');
    }
    const receiptId = checkedReceiptId();
    const canonicalObservations = [...observations]
      .sort((left, right) => left.handleId.localeCompare(right.handleId))
      .map((entry) => [entry.handleId, entry.expectedStatus, entry.observedStatus]);
    const receiptDigest = await checkedDigest(
      JSON.stringify([
        RECEIPT_DIGEST_FORMAT,
        input.context.fence.dispatchDigest,
        input.context.fence.fenceDigest,
        canonicalObservations,
        disposition.kind,
        disposition.kind === 'completed' ? null : disposition.reason,
        retryAt,
        attemptedAt,
      ]),
    );

    return withImmediateTransaction(database, () => {
      const { command, context } = input;
      const row = readDispatch(database, context.fence.dispatchId);
      if (!row || row.state !== 'claimed') return reject('duplicate_dispatch');
      if (
        row.run_id !== command.runId ||
        row.control_epoch !== command.controlEpoch ||
        row.snapshot_digest !== context.generation.snapshotDigest ||
        row.command_kind !== command.kind ||
        row.command_digest !== context.fence.commandDigest ||
        row.dispatch_digest !== context.fence.dispatchDigest ||
        row.fence_id !== context.fence.fenceId ||
        row.fence_digest !== context.fence.fenceDigest ||
        row.authority_digest !== context.fence.authorityDigest
      ) {
        return reject('prerequisite_changed');
      }
      const run = readRun(database, command.runId);
      if (run.controlEpoch !== command.controlEpoch) return reject('control_epoch_changed');
      if (run.updatedAt !== context.generation.updatedAt) return reject('generation_changed');
      const currentCancellation = readCancellationState(database, run.id);
      if (
        currentCancellation !== row.cancellation_state ||
        deriveAuthority(run.approvalState, run.permissionState) !== row.execution_authority
      ) {
        return reject('authority_changed');
      }

      const handles = database
        .getAllSync<unknown>(
          'SELECT * FROM execution_external_handles WHERE run_id = ? ORDER BY id ASC',
          run.id,
        )
        .map(decodeExecutionExternalHandleRow)
        .filter((handle) => command.handleIds.includes(handle.id));
      if (handles.length !== observations.length) return reject('prerequisite_changed');
      const byId = new Map(observations.map((entry) => [entry.handleId, entry]));
      for (const handle of handles) {
        const observation = byId.get(handle.id);
        if (
          !observation ||
          observation.expectedStatus !== handle.status ||
          (observation.observedStatus !== null &&
            observation.observedStatus !== handle.status &&
            !canTransitionExecutionExternalHandle(handle.status, observation.observedStatus))
        ) {
          return reject('prerequisite_changed');
        }
      }

      for (const handle of handles) {
        const observation = byId.get(handle.id)!;
        const result = database.runSync(
          `UPDATE execution_external_handles
           SET status = ?, updated_at = ?, last_attempted_at = ?, last_verified_at = ?
           WHERE run_id = ? AND id = ? AND status = ? AND last_attempted_at = ?`,
          observation.observedStatus ?? handle.status,
          attemptedAt,
          attemptedAt,
          observation.observedStatus === null ? handle.lastVerifiedAt : attemptedAt,
          run.id,
          handle.id,
          handle.status,
          handle.lastAttemptedAt,
        );
        if (result.changes !== 1) throw new Error('execution_recovery_concurrent_observation');
        recordExternalHandleMonitorObservation(database, {
          handle,
          observedStatus: observation.observedStatus,
          disposition: disposition.kind,
          retryAt,
          occurredAt: attemptedAt,
        });
      }

      if (observations.some((entry) => entry.observedStatus !== null)) {
        for (const effectId of command.effectIds) {
          let effect = readEffect(database, run.id, effectId);
          if (effect.status === 'started' || effect.status === 'ambiguous') {
            if (!canTransitionExecutionEffect(effect.status, 'applied')) {
              throw new Error('execution_recovery_invalid_effect_settlement');
            }
            const appliedResult = database.runSync(
              `UPDATE execution_effects
               SET status = 'applied', outcome_digest = ?, completed_at = ?, updated_at = ?
               WHERE run_id = ? AND id = ? AND status = ?`,
              receiptDigest,
              effect.completedAt ?? attemptedAt,
              attemptedAt,
              run.id,
              effect.id,
              effect.status,
            );
            if (appliedResult.changes !== 1) {
              throw new Error('execution_recovery_concurrent_effect_settlement');
            }
            effect = readEffect(database, run.id, effectId);
          }
          const handleStatuses = database
            .getAllSync<{ status: string }>(
              `SELECT status FROM execution_external_handles
               WHERE run_id = ? AND effect_id = ? ORDER BY id ASC`,
              run.id,
              effectId,
            )
            .map((entry) => entry.status);
          if (
            effect.status === 'applied' &&
            handleStatuses.length > 0 &&
            handleStatuses.every((status) => ['succeeded', 'failed', 'cancelled'].includes(status))
          ) {
            const verifiedResult = database.runSync(
              `UPDATE execution_effects
               SET status = 'verified', outcome_digest = ?, updated_at = ?
               WHERE run_id = ? AND id = ? AND status = 'applied'`,
              receiptDigest,
              attemptedAt,
              run.id,
              effect.id,
            );
            if (verifiedResult.changes !== 1) {
              throw new Error('execution_recovery_concurrent_effect_verification');
            }
          }
        }
      }

      let terminalStatus: 'succeeded' | 'failed' | 'cancelled' | null = null;
      if (disposition.kind === 'completed' && isStandaloneExternalObservationRun(run)) {
        const allHandleStatuses = database
          .getAllSync<{
            status: string;
          }>(
            `SELECT status FROM execution_external_handles WHERE run_id = ? ORDER BY id ASC`,
            run.id,
          )
          .map((entry) => entry.status);
        const allEffectStatuses = database
          .getAllSync<{
            status: string;
          }>(`SELECT status FROM execution_effects WHERE run_id = ? ORDER BY id ASC`, run.id)
          .map((entry) => entry.status);
        if (
          allHandleStatuses.length === 0 ||
          !allHandleStatuses.every((status) =>
            ['succeeded', 'failed', 'cancelled'].includes(status),
          ) ||
          allEffectStatuses.length === 0 ||
          !allEffectStatuses.every((status) => ['verified', 'failed', 'cancelled'].includes(status))
        ) {
          throw new Error('execution_recovery_standalone_terminal_incomplete');
        }
        terminalStatus = allHandleStatuses.includes('failed')
          ? 'failed'
          : allHandleStatuses.includes('cancelled')
            ? 'cancelled'
            : 'succeeded';
        if (!canTransitionExecutionRun(run.status, terminalStatus)) {
          throw new Error('execution_recovery_standalone_terminal_conflict');
        }
        const latest = database.getFirstSync<{ sequence: number }>(
          `SELECT sequence FROM execution_checkpoints
           WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
          run.id,
        );
        if (!latest || !Number.isSafeInteger(latest.sequence)) {
          throw new Error('execution_recovery_standalone_history_missing');
        }
        const terminalCheckpointId = `external-terminal-${receiptDigest.slice(0, 48)}`;
        insertCheckpoint(
          database,
          decodeExecutionCheckpointRow(
            checkpointRow({
              id: terminalCheckpointId,
              runId: run.id,
              sequence: latest.sequence + 1,
              taskId: run.taskId,
              goalId: run.goalId,
              phase: 'work',
              boundary: 'terminal',
              stateRefId: terminalCheckpointId,
              stateDigest: receiptDigest,
              resumeStrategy: run.resumeStrategy,
              approvalState: run.approvalState,
              permissionState: run.permissionState,
              controlEpoch: run.controlEpoch,
              createdAt: attemptedAt,
            }),
          ),
        );
      }

      const runResult = terminalStatus
        ? database.runSync(
            `UPDATE execution_runs SET status = ?, updated_at = ?, terminal_at = ?
             WHERE id = ? AND status = ? AND control_epoch = ? AND updated_at = ?`,
            terminalStatus,
            attemptedAt,
            attemptedAt,
            run.id,
            run.status,
            run.controlEpoch,
            run.updatedAt,
          )
        : database.runSync(
            `UPDATE execution_runs SET updated_at = ?
             WHERE id = ? AND control_epoch = ? AND updated_at = ?`,
            attemptedAt,
            run.id,
            run.controlEpoch,
            run.updatedAt,
          );
      if (runResult.changes !== 1) throw new Error('execution_recovery_concurrent_run');
      if (terminalStatus === 'cancelled') {
        const cancellationResult = database.runSync(
          `UPDATE execution_recovery_controls
           SET cancellation_state = 'cancelled', updated_at = ?
           WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
          attemptedAt,
          run.id,
        );
        if (cancellationResult.changes !== 1) {
          throw new Error('execution_recovery_concurrent_cancellation');
        }
      }
      const dispatchResult = database.runSync(
        `UPDATE execution_recovery_dispatches
         SET state = ?, receipt_id = ?, receipt_digest = ?, outcome_reason = ?,
             retry_at = ?, updated_at = ?
         WHERE dispatch_id = ? AND state = 'claimed' AND fence_id = ? AND fence_digest = ?`,
        disposition.kind,
        receiptId,
        receiptDigest,
        disposition.kind === 'completed' ? null : disposition.reason,
        retryAt,
        attemptedAt,
        row.dispatch_id,
        row.fence_id,
        row.fence_digest,
      );
      if (dispatchResult.changes !== 1) throw new Error('execution_recovery_concurrent_receipt');
      const base = {
        fenceId: row.fence_id,
        fenceDigest: row.fence_digest,
        receiptId,
        receiptDigest,
      };
      if (disposition.kind === 'pending') {
        return { kind: 'pending', ...base, reason: disposition.reason, retryAt: retryAt! };
      }
      if (disposition.kind === 'blocked') {
        return { kind: 'blocked', ...base, reason: disposition.reason };
      }
      return { kind: 'completed', ...base };
    });
  };

  return { claim, complete };
}
