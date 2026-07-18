import type * as SQLite from 'expo-sqlite';

import type { AgentRunMobileControllerHandoffRef } from '../../types/agentRun';
import type {
  MobileControllerCapability,
  MobileControllerPendingHandoff,
} from '../../engine/mobileController/contracts';
import {
  qualifyMobileControllerCapability,
  qualifyMobileControllerPendingHandoff,
} from '../../engine/mobileController/validation';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow, decodeExecutionExternalHandleRow } from './decoders';
import type { ExecutionExternalHandleLocator } from './externalLocators';
import { readStoredEffectReceipt } from './effectReceiptStore';
import {
  checkpointRow,
  handleRow,
  insertCheckpoint,
  readEffect,
  readHandle,
  readRun,
  withImmediateTransaction,
} from './mutationStore';
import { insertExternalHandleMonitor, readExternalHandleMonitor } from './monitorRecords';
import type {
  ExecutionCheckpointRecord,
  ExecutionExternalHandleRecord,
  ExecutionRunRecord,
} from './types';

const HANDOFF_ID_PREFIX = 'mch_';
const CLAIM_RUN_ID_PREFIX = 'effect-run-';

export interface PersistClaimedMobileControllerHandoffOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
}

export type PersistedMobileControllerHandoff = Readonly<{
  kind: 'persisted' | 'replayed';
  handoff: MobileControllerPendingHandoff;
  handoffRef: AgentRunMobileControllerHandoffRef;
  handle: ExecutionExternalHandleRecord;
  checkpoint: ExecutionCheckpointRecord;
  run: ExecutionRunRecord;
}>;

function latestCheckpoint(
  database: SQLite.SQLiteDatabase,
  runId: string,
): ExecutionCheckpointRecord {
  const row = database.getFirstSync<unknown>(
    `SELECT * FROM execution_checkpoints
     WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
    runId,
  );
  if (!row) throw new Error('mobile_controller_handoff_checkpoint_missing');
  return decodeExecutionCheckpointRow(row);
}

function persistedIds(handoffId: string): {
  handleId: string;
  monitorId: string;
  checkpointId: string;
} {
  const suffix = handoffId.slice(HANDOFF_ID_PREFIX.length);
  return {
    handleId: `mobile-handoff-${suffix}`,
    monitorId: `mobile-monitor-${suffix}`,
    checkpointId: `mobile-wait-${suffix}`,
  };
}

function expectedClaimToken(runId: string): string {
  const suffix = runId.slice(CLAIM_RUN_ID_PREFIX.length);
  if (!runId.startsWith(CLAIM_RUN_ID_PREFIX) || !/^[a-f0-9]{48}$/u.test(suffix)) {
    throw new Error('mobile_controller_handoff_claim_identity_invalid');
  }
  return `effect-claim-${suffix}`;
}

function locatorFor(handoff: MobileControllerPendingHandoff): ExecutionExternalHandleLocator {
  return {
    version: 1,
    kind: 'mobile_controller_handoff',
    handoffId: handoff.handoffId,
    controllerId: handoff.controllerId,
    controllerContractVersion: handoff.controllerContractVersion,
    capabilityDigest: handoff.capabilityDigest,
    actionDigest: handoff.actionDigest,
    beforeObservationId: handoff.beforeObservation.observationId,
    beforeObservationDigest: handoff.beforeObservation.digest,
    expiresAt: handoff.expiresAt,
  };
}

function handoffRefFor(
  handoff: MobileControllerPendingHandoff,
  externalHandleId: string,
): AgentRunMobileControllerHandoffRef {
  const identity = handoff.dispatchIdentity;
  return Object.freeze({
    version: 1,
    effectRunId: identity.runId,
    executionRunId: identity.executionRunId,
    effectId: identity.effectId,
    externalHandleId,
    toolCallId: identity.toolCallId,
    controlEpoch: identity.controlEpoch,
    handoffId: handoff.handoffId,
    controllerId: handoff.controllerId,
    controllerContractVersion: handoff.controllerContractVersion,
    capabilityDigest: handoff.capabilityDigest,
    actionDigest: handoff.actionDigest,
    beforeObservationId: handoff.beforeObservation.observationId,
    beforeObservationDigest: handoff.beforeObservation.digest,
    expiresAt: handoff.expiresAt,
  });
}

function assertClaimIdentity(
  database: SQLite.SQLiteDatabase,
  handoff: MobileControllerPendingHandoff,
): ExecutionRunRecord {
  const identity = handoff.dispatchIdentity;
  const run = readRun(database, identity.runId);
  const effect = readEffect(database, identity.runId, identity.effectId);
  const control = database.getFirstSync<{ cancellation_state: unknown }>(
    `SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?`,
    identity.runId,
  );
  if (
    run.taskId !== identity.executionRunId ||
    run.controlEpoch !== identity.controlEpoch ||
    effect.status !== 'started' ||
    effect.startedAt !== handoff.claimedAt ||
    effect.toolCallId !== identity.toolCallId ||
    effect.toolNameDigest !== identity.toolNameDigest ||
    effect.toolContractIdentityDigest !== identity.toolContractIdentityDigest ||
    effect.requestDigest !== identity.requestDigest ||
    effect.idempotencyKeyDigest !== identity.idempotencyKeyDigest ||
    effect.attempt !== identity.attempt ||
    control?.cancellation_state !== 'active' ||
    handoff.claimToken !== expectedClaimToken(identity.runId) ||
    handoff.handoffId !==
      `mch_${identity.runId.slice(CLAIM_RUN_ID_PREFIX.length, CLAIM_RUN_ID_PREFIX.length + 32)}` ||
    readStoredEffectReceipt(database, identity.runId, identity.effectId) !== null
  ) {
    throw new Error('mobile_controller_handoff_claim_conflict');
  }
  return run;
}

function assertExactStartedClaim(
  database: SQLite.SQLiteDatabase,
  handoff: MobileControllerPendingHandoff,
): { run: ExecutionRunRecord; latest: ExecutionCheckpointRecord } {
  const identity = handoff.dispatchIdentity;
  const run = assertClaimIdentity(database, handoff);
  const latest = latestCheckpoint(database, identity.runId);
  if (
    run.status !== 'running' ||
    latest.id !== identity.authorityCheckpointId ||
    latest.boundary !== 'before_effect'
  ) {
    throw new Error('mobile_controller_handoff_claim_conflict');
  }
  return { run, latest };
}

function buildHandle(
  handoff: MobileControllerPendingHandoff,
  handleId: string,
): ExecutionExternalHandleRecord {
  const identity = handoff.dispatchIdentity;
  return decodeExecutionExternalHandleRow(
    handleRow({
      id: handleId,
      runId: identity.runId,
      effectId: identity.effectId,
      locator: locatorFor(handoff),
      sourceToolNameDigest: identity.toolNameDigest,
      status: 'pending',
      createdAt: handoff.createdAt,
      updatedAt: handoff.createdAt,
      lastAttemptedAt: handoff.createdAt,
      lastVerifiedAt: handoff.createdAt,
    }),
  );
}

function replayPersistedHandoff(
  database: SQLite.SQLiteDatabase,
  handoff: MobileControllerPendingHandoff,
  ids: ReturnType<typeof persistedIds>,
): PersistedMobileControllerHandoff | null {
  const identity = handoff.dispatchIdentity;
  const run = assertClaimIdentity(database, handoff);
  if (run.status !== 'waiting' || run.controlEpoch !== identity.controlEpoch) return null;
  const handle = readHandle(database, identity.runId, ids.handleId);
  const checkpoint = latestCheckpoint(database, identity.runId);
  const monitor = readExternalHandleMonitor(database, identity.runId, ids.handleId);
  const expectedLocator = locatorFor(handoff);
  if (
    handle.effectId !== identity.effectId ||
    handle.sourceToolNameDigest !== identity.toolNameDigest ||
    handle.status !== 'pending' ||
    JSON.stringify(handle.locator) !== JSON.stringify(expectedLocator) ||
    handle.createdAt !== handoff.createdAt ||
    checkpoint.id !== ids.checkpointId ||
    checkpoint.boundary !== 'waiting_external' ||
    checkpoint.stateRefId !== handoff.handoffId ||
    checkpoint.stateDigest !== handoff.actionDigest.slice('sha256:'.length) ||
    monitor.id !== ids.monitorId ||
    monitor.state !== 'armed' ||
    readStoredEffectReceipt(database, identity.runId, identity.effectId) !== null
  ) {
    throw new Error('mobile_controller_handoff_replay_conflict');
  }
  return Object.freeze({
    kind: 'replayed',
    handoff,
    handoffRef: handoffRefFor(handoff, handle.id),
    handle,
    checkpoint,
    run,
  });
}

/**
 * Atomically parks one already-claimed mobile effect before the controller can
 * observe it. No action payload or raw observation is written to the journal.
 */
export function persistClaimedMobileControllerHandoff(
  input: { capability: unknown; handoff: unknown },
  options: PersistClaimedMobileControllerHandoffOptions = {},
): PersistedMobileControllerHandoff {
  const capability: MobileControllerCapability | null = qualifyMobileControllerCapability(
    input.capability,
  );
  const handoff = capability
    ? qualifyMobileControllerPendingHandoff(input.handoff, capability)
    : null;
  if (!capability || !handoff) {
    throw new Error('mobile_controller_handoff_invalid');
  }
  const ids = persistedIds(handoff.handoffId);
  const database = (options.getDatabase ?? getExecutionJournalDb)();
  return withImmediateTransaction(database, () => {
    const existingHandle = database.getFirstSync<{ id: string }>(
      `SELECT id FROM execution_external_handles WHERE run_id = ? AND id = ?`,
      handoff.dispatchIdentity.runId,
      ids.handleId,
    );
    if (existingHandle) {
      const replay = replayPersistedHandoff(database, handoff, ids);
      if (replay) return replay;
      throw new Error('mobile_controller_handoff_replay_conflict');
    }

    const { run, latest } = assertExactStartedClaim(database, handoff);
    if (
      handoff.createdAt < Math.max(run.updatedAt, handoff.claimedAt, latest.createdAt) ||
      handoff.createdAt >= handoff.expiresAt
    ) {
      throw new Error('mobile_controller_handoff_time_conflict');
    }
    const handle = buildHandle(handoff, ids.handleId);
    database.runSync(
      `INSERT INTO execution_external_handles (
         id, run_id, effect_id, handle_kind, locator_version, locator_json,
         source_tool_name_digest, status, created_at, updated_at,
         last_attempted_at, last_verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...Object.values(handleRow(handle)),
    );
    insertExternalHandleMonitor(database, { id: ids.monitorId, handle });

    const checkpoint = decodeExecutionCheckpointRow(
      checkpointRow({
        id: ids.checkpointId,
        runId: run.id,
        sequence: latest.sequence + 1,
        taskId: run.taskId,
        goalId: run.goalId,
        phase: 'work',
        boundary: 'waiting_external',
        stateRefId: handoff.handoffId,
        stateDigest: handoff.actionDigest.slice('sha256:'.length),
        resumeStrategy: run.resumeStrategy,
        approvalState: run.approvalState,
        permissionState: run.permissionState,
        controlEpoch: run.controlEpoch,
        createdAt: handoff.createdAt,
      }),
    );
    insertCheckpoint(database, checkpoint);
    const update = database.runSync(
      `UPDATE execution_runs
       SET status = 'waiting', updated_at = ?, terminal_at = NULL
       WHERE id = ? AND status = 'running' AND control_epoch = ? AND updated_at = ?`,
      handoff.createdAt,
      run.id,
      run.controlEpoch,
      run.updatedAt,
    );
    if (update.changes !== 1) {
      throw new Error('mobile_controller_handoff_run_conflict');
    }
    const parkedRun = readRun(database, run.id);
    return Object.freeze({
      kind: 'persisted',
      handoff,
      handoffRef: handoffRefFor(handoff, handle.id),
      handle,
      checkpoint,
      run: parkedRun,
    });
  });
}
