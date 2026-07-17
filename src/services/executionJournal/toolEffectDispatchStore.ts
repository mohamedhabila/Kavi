import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb, quarantineExecutionJournalDb } from './database';
import type {
  AtomicEffectDispatchClaimResult,
  AtomicEffectDispatchSettlementResult,
  EffectDispatchAmbiguityCandidate,
  EffectDispatchClaimEvidence,
  EffectDispatchPorts,
  EffectDispatchReadState,
  EffectDispatchSettlementCandidate,
} from './effectDispatchCoordinator';
import type {
  AtomicEffectDispatchClaimCandidate,
  EffectDispatchIdentity,
  EffectDispatchSnapshot,
} from './effectDispatchPolicy';
import { readEffect, readRun, withImmediateTransaction } from './mutationStore';
import {
  appendToolEffectDispatchTerminalCheckpoint,
  prepareToolEffectDispatchState,
  readToolEffectDispatchSnapshot,
  type ToolEffectDispatchJournalPlan,
} from './toolEffectDispatchJournalState';
import type { ExecutionEffectRecord, ExecutionRunRecord } from './types';
import { getSchemaReadyMemoryDb } from '../memory/access/schemaGuard';
import type { DurableModelEffectAuthority } from '../../engine/authority/modelTurnMemoryPolicyBinding';
import {
  insertEffectReceipt,
  readStoredEffectReceipt,
  readVerifiedStoredEffectReceipt,
} from './effectReceiptStore';

export type { ToolEffectDispatchJournalPlan };

export interface ToolEffectDispatchAuthority {
  permissionGranted(): boolean;
  approvalGranted(): boolean;
  controlGranted(): boolean;
}

export interface ToolEffectDispatchStoreOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
  getMemoryDatabase?: () => SQLite.SQLiteDatabase;
  quarantineDatabase?: (database: SQLite.SQLiteDatabase) => void;
  now?: () => number;
}

export interface PreparedToolEffectDispatchJournal {
  identity: EffectDispatchIdentity;
  ports: EffectDispatchPorts;
}

const MEMORY_EFFECT_AUTHORITY_SCHEMA = 'memory_effect_authority';

function attachMemoryEffectAuthorityDatabase(
  database: SQLite.SQLiteDatabase,
  memoryDatabase: SQLite.SQLiteDatabase,
): void {
  if (
    typeof memoryDatabase.databasePath !== 'string' ||
    memoryDatabase.databasePath.length === 0 ||
    memoryDatabase.databasePath === database.databasePath
  ) {
    throw new Error('effect_dispatch_memory_database_path_invalid');
  }
  const alreadyAttached = database
    .getAllSync<{ name: string }>('PRAGMA database_list')
    .some((entry) => entry.name === MEMORY_EFFECT_AUTHORITY_SCHEMA);
  if (alreadyAttached) {
    throw new Error('effect_dispatch_memory_database_already_attached');
  }
  database.runSync(
    `ATTACH DATABASE ? AS ${MEMORY_EFFECT_AUTHORITY_SCHEMA}`,
    memoryDatabase.databasePath,
  );
}

function detachMemoryEffectAuthorityDatabase(database: SQLite.SQLiteDatabase): void {
  database.execSync(`DETACH DATABASE ${MEMORY_EFFECT_AUTHORITY_SCHEMA}`);
}

type ImmediateTransactionAttempt<T> =
  | Readonly<{ kind: 'completed'; result: T }>
  | Readonly<{ kind: 'not_committed'; error: unknown }>
  | Readonly<{ kind: 'outcome_unknown'; error: unknown }>;

/**
 * Distinguish a transaction that definitely did not commit from an uncertain
 * COMMIT/ROLLBACK outcome. Only the former may be followed by journal-only
 * cancellation on a clean, detached connection.
 */
function attemptImmediateTransaction<T>(
  database: SQLite.SQLiteDatabase,
  work: () => T,
): ImmediateTransactionAttempt<T> {
  try {
    database.execSync('BEGIN IMMEDIATE');
  } catch (error) {
    return { kind: 'not_committed', error };
  }

  let result: T;
  try {
    result = work();
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
      return { kind: 'not_committed', error };
    } catch {
      return { kind: 'outcome_unknown', error };
    }
  }

  try {
    database.execSync('COMMIT');
    return { kind: 'completed', result };
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
      return { kind: 'not_committed', error };
    } catch {
      return { kind: 'outcome_unknown', error };
    }
  }
}

function lockAndValidateMemoryEffectAuthority(
  database: SQLite.SQLiteDatabase,
  authority: Extract<DurableModelEffectAuthority, { kind: 'memory_epoch' }>,
  observedAt: number,
): 'current' | 'changed' | 'expired' {
  const lock = database.runSync(
    `UPDATE ${MEMORY_EFFECT_AUTHORITY_SCHEMA}.memory_vault_identity
        SET created_at = created_at
      WHERE singleton = 1`,
  );
  if (lock.changes !== 1) return 'changed';
  const vault = database.getFirstSync<{
    owner_id: unknown;
    restrictive_authority_revision: unknown;
    memory_policy_enabled: unknown;
    memory_policy_revision: unknown;
  }>(
    `SELECT owner_id, restrictive_authority_revision, memory_policy_enabled, memory_policy_revision
      FROM ${MEMORY_EFFECT_AUTHORITY_SCHEMA}.memory_vault_identity
      WHERE singleton = 1`,
  );
  if (!vault) return 'changed';
  if (
    vault.owner_id !== authority.memoryOwnerId ||
    vault.restrictive_authority_revision !== authority.restrictiveRevision ||
    vault.memory_policy_enabled !== 1 ||
    vault.memory_policy_revision !== authority.memoryPolicyRevision
  ) {
    return 'changed';
  }
  if (authority.validUntil !== null && observedAt >= authority.validUntil) return 'expired';
  if (authority.verifiedProcedureRestrictiveRevision === null) return 'current';
  const procedure = database.getFirstSync<{ restrictive_authority_revision: unknown }>(
    `SELECT restrictive_authority_revision
       FROM ${MEMORY_EFFECT_AUTHORITY_SCHEMA}.memory_verified_procedure_state
      WHERE memory_owner_id = ?`,
    authority.memoryOwnerId,
  );
  return procedure?.restrictive_authority_revision ===
    authority.verifiedProcedureRestrictiveRevision
    ? 'current'
    : 'changed';
}

function claimTokenFor(identity: EffectDispatchIdentity): string {
  return `effect-claim-${identity.runId.slice('effect-run-'.length)}`;
}

function existingClaim(
  identity: EffectDispatchIdentity,
  effect: ExecutionEffectRecord,
): EffectDispatchClaimEvidence | null {
  if (effect.status === 'planned' || effect.startedAt === null) {
    return null;
  }
  return {
    claimToken: claimTokenFor(identity),
    identity,
    claimedAt: effect.startedAt,
  };
}

function candidateMatchesSnapshot(
  candidate: AtomicEffectDispatchClaimCandidate,
  snapshot: EffectDispatchSnapshot,
): boolean {
  return (
    candidate.expectedRunStatus === snapshot.run.status &&
    candidate.expectedEffectStatus === snapshot.effect.status &&
    candidate.expectedControlEpoch === snapshot.run.controlEpoch &&
    candidate.expectedApprovalState === snapshot.authorityCheckpoint.approvalState &&
    candidate.expectedPermissionState === snapshot.authorityCheckpoint.permissionState &&
    candidate.expectedRunUpdatedAt === snapshot.run.updatedAt &&
    candidate.expectedEffectUpdatedAt === snapshot.effect.updatedAt &&
    candidate.expectedPlanningCheckpointId === snapshot.planningCheckpoint.id &&
    candidate.expectedLatestCheckpointId === snapshot.authorityCheckpoint.id &&
    candidate.expectedAuthoritySequence === snapshot.authorityCheckpoint.sequence &&
    candidate.authorizationExpiresAt === snapshot.authorizationExpiresAt
  );
}

function cancelUnclaimedDispatch(
  database: SQLite.SQLiteDatabase,
  identity: EffectDispatchIdentity,
  observedAt: number,
): void {
  const run = readRun(database, identity.runId);
  const effect = readEffect(database, identity.runId, identity.effectId);
  if (effect.status !== 'planned' || run.status !== 'running') {
    return;
  }
  const cancelledAt = Math.max(observedAt, run.updatedAt, effect.updatedAt);
  // Preserve the closed transition contract while keeping the rejection
  // atomic: no observer can see this claim-only started state, and no executor
  // is called because claimAndStart returns rejected.
  const startUpdate = database.runSync(
    `UPDATE execution_effects
     SET status = 'started', started_at = ?, updated_at = ?
     WHERE run_id = ? AND id = ? AND status = 'planned'`,
    cancelledAt,
    cancelledAt,
    run.id,
    effect.id,
  );
  if (startUpdate.changes !== 1) {
    throw new Error('effect_dispatch_rejection_effect_conflict');
  }
  const cancelUpdate = database.runSync(
    `UPDATE execution_effects
     SET status = 'cancelled', completed_at = ?, updated_at = ?
     WHERE run_id = ? AND id = ? AND status = 'started' AND started_at = ?`,
    cancelledAt,
    cancelledAt,
    run.id,
    effect.id,
    cancelledAt,
  );
  if (cancelUpdate.changes !== 1) {
    throw new Error('effect_dispatch_rejection_effect_conflict');
  }
  appendToolEffectDispatchTerminalCheckpoint(
    database,
    run,
    effect.id,
    effect.requestDigest,
    cancelledAt,
  );
  const runUpdate = database.runSync(
    `UPDATE execution_runs
     SET status = 'cancelled', updated_at = ?, terminal_at = ?
     WHERE id = ? AND status = 'running' AND control_epoch = ?`,
    cancelledAt,
    cancelledAt,
    run.id,
    run.controlEpoch,
  );
  if (runUpdate.changes !== 1) {
    throw new Error('effect_dispatch_rejection_run_conflict');
  }
  const control = database.runSync(
    `UPDATE execution_recovery_controls
     SET cancellation_state = 'cancelled', updated_at = ?
     WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
    cancelledAt,
    run.id,
  );
  if (control.changes !== 1) {
    const current = database.getFirstSync<{ cancellation_state: string }>(
      `SELECT cancellation_state FROM execution_recovery_controls WHERE run_id = ?`,
      run.id,
    );
    if (current?.cancellation_state !== 'cancelled') {
      throw new Error('effect_dispatch_rejection_control_conflict');
    }
  }
}

function runTerminalStatusFor(
  effectStatus: EffectDispatchSettlementCandidate['nextEffectStatus'],
): 'succeeded' | 'failed' | 'cancelled' | 'ambiguous' {
  if (effectStatus === 'verified') return 'succeeded';
  if (effectStatus === 'failed') return 'failed';
  if (effectStatus === 'cancelled') return 'cancelled';
  return 'ambiguous';
}

function updateRunAfterSettlement(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  effectId: string,
  effectStatus: EffectDispatchSettlementCandidate['nextEffectStatus'],
  outcomeDigest: string,
  observedAt: number,
): void {
  const status = runTerminalStatusFor(effectStatus);
  const terminalAt = status === 'ambiguous' ? null : observedAt;
  if (terminalAt !== null) {
    appendToolEffectDispatchTerminalCheckpoint(database, run, effectId, outcomeDigest, observedAt);
  }
  const update = database.runSync(
    `UPDATE execution_runs
     SET status = ?, updated_at = ?, terminal_at = ?
     WHERE id = ? AND status = ? AND control_epoch = ?`,
    status,
    observedAt,
    terminalAt,
    run.id,
    run.status,
    run.controlEpoch,
  );
  if (update.changes !== 1) {
    throw new Error('effect_dispatch_run_settlement_conflict');
  }
  if (status === 'cancelled') {
    const control = database.runSync(
      `UPDATE execution_recovery_controls
       SET cancellation_state = 'cancelled', updated_at = ?
       WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
      observedAt,
      run.id,
    );
    if (control.changes !== 1) {
      throw new Error('effect_dispatch_control_settlement_conflict');
    }
  }
}

function settleStartedEffect(
  database: SQLite.SQLiteDatabase,
  effect: ExecutionEffectRecord,
  candidate: EffectDispatchSettlementCandidate,
  observedAt: number,
): void {
  const complete = (expectedStatus: 'started' | 'applied', nextStatus: string): void => {
    const update = database.runSync(
      `UPDATE execution_effects
       SET status = ?, outcome_digest = ?, completed_at = ?, updated_at = ?
       WHERE run_id = ? AND id = ? AND status = ? AND started_at = ?`,
      nextStatus,
      candidate.outcomeDigest,
      observedAt,
      observedAt,
      effect.runId,
      effect.id,
      expectedStatus,
      candidate.claim.claimedAt,
    );
    if (update.changes !== 1) {
      throw new Error('effect_dispatch_settlement_conflict');
    }
  };

  if (candidate.nextEffectStatus === 'verified') {
    complete('started', 'applied');
    complete('applied', 'verified');
    return;
  }
  complete('started', candidate.nextEffectStatus);
}

function makePorts(input: {
  identity: EffectDispatchIdentity;
  modelEffectAuthority: DurableModelEffectAuthority;
  authority: ToolEffectDispatchAuthority;
  dispatch(claim: EffectDispatchClaimEvidence): Promise<unknown>;
  getDatabase: () => SQLite.SQLiteDatabase;
  getMemoryDatabase: () => SQLite.SQLiteDatabase;
  quarantineDatabase: (database: SQLite.SQLiteDatabase) => void;
  now: () => number;
}): EffectDispatchPorts {
  const claimToken = claimTokenFor(input.identity);
  const readState = async (): Promise<EffectDispatchReadState | null> => {
    const database = input.getDatabase();
    const snapshot = readToolEffectDispatchSnapshot(database, input.identity);
    const claim = existingClaim(input.identity, snapshot.effect);
    const storedReceipt = claim
      ? await readVerifiedStoredEffectReceipt(
          database,
          input.identity.runId,
          input.identity.effectId,
        )
      : null;
    return {
      snapshot,
      existingClaim: claim ? { claim, receipt: storedReceipt?.receipt ?? null } : null,
    };
  };
  const rejectAndCancel = (
    reason: Extract<AtomicEffectDispatchClaimResult, { kind: 'rejected' }>['reason'],
  ): AtomicEffectDispatchClaimResult => {
    const database = input.getDatabase();
    return withImmediateTransaction(database, () => {
      cancelUnclaimedDispatch(database, input.identity, input.now());
      return { kind: 'rejected', reason };
    });
  };
  const claimWithinTransaction = (
    database: SQLite.SQLiteDatabase,
    candidate: AtomicEffectDispatchClaimCandidate,
  ): AtomicEffectDispatchClaimResult => {
    const observedAt = input.now();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      cancelUnclaimedDispatch(database, input.identity, 0);
      return { kind: 'rejected', reason: 'model_authority_unavailable' };
    }
    if (input.modelEffectAuthority.kind === 'memory_epoch') {
      let validation: ReturnType<typeof lockAndValidateMemoryEffectAuthority>;
      try {
        validation = lockAndValidateMemoryEffectAuthority(
          database,
          input.modelEffectAuthority,
          observedAt,
        );
      } catch {
        cancelUnclaimedDispatch(database, input.identity, observedAt);
        return { kind: 'rejected', reason: 'model_authority_unavailable' };
      }
      if (validation !== 'current') {
        cancelUnclaimedDispatch(database, input.identity, observedAt);
        return {
          kind: 'rejected',
          reason: validation === 'expired' ? 'model_authority_expired' : 'model_authority_changed',
        };
      }
    }
    const snapshot = readToolEffectDispatchSnapshot(database, input.identity);
    const existing = existingClaim(input.identity, snapshot.effect);
    if (existing) {
      return {
        kind: 'existing',
        claim: existing,
        receipt:
          readStoredEffectReceipt(database, input.identity.runId, input.identity.effectId)
            ?.receipt ?? null,
      };
    }
    if (!candidateMatchesSnapshot(candidate, snapshot)) {
      return { kind: 'rejected', reason: 'generation_changed' };
    }
    const recoveryControl = database.getFirstSync<{
      cancellation_state: string;
    }>(
      `SELECT cancellation_state FROM execution_recovery_controls
       WHERE run_id = ?`,
      input.identity.runId,
    );
    if (!input.authority.approvalGranted()) {
      cancelUnclaimedDispatch(database, input.identity, observedAt);
      return { kind: 'rejected', reason: 'approval_not_granted' };
    }
    if (recoveryControl?.cancellation_state !== 'active' || !input.authority.controlGranted()) {
      cancelUnclaimedDispatch(database, input.identity, observedAt);
      return { kind: 'rejected', reason: 'control_epoch_changed' };
    }
    if (!input.authority.permissionGranted()) {
      cancelUnclaimedDispatch(database, input.identity, observedAt);
      return { kind: 'rejected', reason: 'permission_not_granted' };
    }
    const claimedAt = Math.max(
      candidate.evaluatedAt,
      snapshot.run.updatedAt,
      snapshot.effect.updatedAt,
      observedAt,
    );
    if (
      input.modelEffectAuthority.kind === 'memory_epoch' &&
      input.modelEffectAuthority.validUntil !== null &&
      claimedAt >= input.modelEffectAuthority.validUntil
    ) {
      cancelUnclaimedDispatch(database, input.identity, claimedAt);
      return { kind: 'rejected', reason: 'model_authority_expired' };
    }
    const effectUpdate = database.runSync(
      `UPDATE execution_effects
       SET status = 'started', started_at = ?, updated_at = ?
       WHERE run_id = ? AND id = ? AND status = 'planned' AND updated_at = ?`,
      claimedAt,
      claimedAt,
      input.identity.runId,
      input.identity.effectId,
      candidate.expectedEffectUpdatedAt,
    );
    if (effectUpdate.changes !== 1) {
      const refreshed = readEffect(database, input.identity.runId, input.identity.effectId);
      const refreshedClaim = existingClaim(input.identity, refreshed);
      return refreshedClaim
        ? {
            kind: 'existing',
            claim: refreshedClaim,
            receipt:
              readStoredEffectReceipt(database, input.identity.runId, input.identity.effectId)
                ?.receipt ?? null,
          }
        : { kind: 'rejected', reason: 'effect_not_planned' };
    }
    const runUpdate = database.runSync(
      `UPDATE execution_runs SET updated_at = ?
       WHERE id = ? AND status = 'running' AND control_epoch = ? AND updated_at = ?`,
      claimedAt,
      input.identity.runId,
      candidate.expectedControlEpoch,
      candidate.expectedRunUpdatedAt,
    );
    if (runUpdate.changes !== 1) {
      throw new Error('effect_dispatch_run_claim_conflict');
    }
    return {
      kind: 'claimed',
      claim: { claimToken, identity: input.identity, claimedAt },
    };
  };

  return {
    now: input.now,
    readState,
    claimAndStart: async (
      candidate: AtomicEffectDispatchClaimCandidate,
    ): Promise<AtomicEffectDispatchClaimResult> => {
      if (!input.authority.approvalGranted()) {
        return rejectAndCancel('approval_not_granted');
      }
      if (!input.authority.permissionGranted()) {
        return rejectAndCancel('permission_not_granted');
      }
      if (!input.authority.controlGranted()) {
        return rejectAndCancel('control_epoch_changed');
      }
      const database = input.getDatabase();
      if (input.modelEffectAuthority.kind === 'policy_independent') {
        return withImmediateTransaction(database, () =>
          claimWithinTransaction(database, candidate),
        );
      }
      let memoryDatabase: SQLite.SQLiteDatabase;
      try {
        memoryDatabase = input.getMemoryDatabase();
      } catch {
        return rejectAndCancel('model_authority_unavailable');
      }
      try {
        attachMemoryEffectAuthorityDatabase(database, memoryDatabase);
      } catch {
        input.quarantineDatabase(database);
        return rejectAndCancel('model_authority_unavailable');
      }

      const attempt = attemptImmediateTransaction(database, () =>
        claimWithinTransaction(database, candidate),
      );
      try {
        detachMemoryEffectAuthorityDatabase(database);
      } catch (error) {
        input.quarantineDatabase(database);
        throw error;
      }
      if (attempt.kind === 'completed') return attempt.result;
      if (attempt.kind === 'outcome_unknown') {
        input.quarantineDatabase(database);
        throw attempt.error;
      }
      return rejectAndCancel('journal_unavailable');
    },
    dispatch: input.dispatch,
    settle: async (
      candidate: EffectDispatchSettlementCandidate,
    ): Promise<AtomicEffectDispatchSettlementResult> => {
      const database = input.getDatabase();
      return withImmediateTransaction(database, () => {
        const run = readRun(database, input.identity.runId);
        const effect = readEffect(database, input.identity.runId, input.identity.effectId);
        if (
          candidate.claim.claimToken !== claimToken ||
          candidate.claim.identity.runId !== input.identity.runId ||
          effect.startedAt !== candidate.claim.claimedAt
        ) {
          return { kind: 'rejected', reason: 'claim_stale' };
        }
        if (effect.status !== 'started') {
          const storedReceipt = readStoredEffectReceipt(
            database,
            input.identity.runId,
            input.identity.effectId,
          );
          return effect.outcomeDigest === candidate.outcomeDigest &&
            storedReceipt?.receiptDigest === candidate.receiptDigest &&
            storedReceipt.receiptJson === candidate.receiptJson
            ? { kind: 'replayed' }
            : { kind: 'rejected', reason: 'receipt_conflict' };
        }
        const observedAt = Math.max(candidate.observedAt, run.updatedAt, effect.updatedAt);
        const receiptWrite = insertEffectReceipt(database, {
          runId: input.identity.runId,
          effectId: input.identity.effectId,
          receipt: candidate.receipt,
          receiptDigest: candidate.receiptDigest,
          receiptJson: candidate.receiptJson,
          persistedAt: observedAt,
        });
        if (receiptWrite !== 'recorded') {
          return { kind: 'rejected', reason: 'receipt_conflict' };
        }
        settleStartedEffect(database, effect, candidate, observedAt);
        updateRunAfterSettlement(
          database,
          run,
          effect.id,
          candidate.nextEffectStatus,
          candidate.outcomeDigest,
          observedAt,
        );
        return { kind: 'recorded' };
      });
    },
    markAmbiguous: async (candidate: EffectDispatchAmbiguityCandidate): Promise<void> => {
      const database = input.getDatabase();
      withImmediateTransaction(database, () => {
        const run = readRun(database, input.identity.runId);
        const effect = readEffect(database, input.identity.runId, input.identity.effectId);
        if (
          candidate.claim.claimToken !== claimToken ||
          effect.startedAt !== candidate.claim.claimedAt ||
          !['started', 'applied'].includes(effect.status)
        ) {
          return;
        }
        const observedAt = Math.max(candidate.observedAt, run.updatedAt, effect.updatedAt);
        const effectUpdate = database.runSync(
          `UPDATE execution_effects
           SET status = 'ambiguous', updated_at = ?
           WHERE run_id = ? AND id = ? AND status = ? AND started_at = ?`,
          observedAt,
          effect.runId,
          effect.id,
          effect.status,
          candidate.claim.claimedAt,
        );
        if (effectUpdate.changes !== 1) {
          throw new Error('effect_dispatch_ambiguity_conflict');
        }
        if (!['succeeded', 'failed', 'cancelled'].includes(run.status)) {
          const runUpdate = database.runSync(
            `UPDATE execution_runs
             SET status = 'ambiguous', updated_at = ?, terminal_at = NULL
             WHERE id = ? AND status = ? AND control_epoch = ?`,
            observedAt,
            run.id,
            run.status,
            run.controlEpoch,
          );
          if (runUpdate.changes !== 1) {
            throw new Error('effect_dispatch_run_ambiguity_conflict');
          }
        }
      });
    },
  };
}

export function prepareToolEffectDispatchJournal(
  plan: ToolEffectDispatchJournalPlan,
  authority: ToolEffectDispatchAuthority,
  dispatch: (claim: EffectDispatchClaimEvidence) => Promise<unknown>,
  options: ToolEffectDispatchStoreOptions = {},
): PreparedToolEffectDispatchJournal {
  const getDatabase = options.getDatabase ?? getExecutionJournalDb;
  const getMemoryDatabase = options.getMemoryDatabase ?? getSchemaReadyMemoryDb;
  const quarantineDatabase = options.quarantineDatabase ?? quarantineExecutionJournalDb;
  const now = options.now ?? Date.now;
  const database = getDatabase();
  prepareToolEffectDispatchState(database, plan);
  return {
    identity: plan.identity,
    ports: makePorts({
      identity: plan.identity,
      modelEffectAuthority: plan.modelEffectAuthority,
      authority,
      dispatch,
      getDatabase,
      getMemoryDatabase,
      quarantineDatabase,
      now,
    }),
  };
}
