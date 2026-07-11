import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
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

export type { ToolEffectDispatchJournalPlan };

export interface ToolEffectDispatchAuthority {
  permissionGranted(): boolean;
  approvalGranted(): boolean;
  controlGranted(): boolean;
}

export interface ToolEffectDispatchStoreOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
  now?: () => number;
}

export interface PreparedToolEffectDispatchJournal {
  identity: EffectDispatchIdentity;
  ports: EffectDispatchPorts;
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
    candidate.authorizationExpiresAt === null
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
    appendToolEffectDispatchTerminalCheckpoint(
      database,
      run,
      effectId,
      outcomeDigest,
      observedAt,
    );
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
  authority: ToolEffectDispatchAuthority;
  dispatch(claim: EffectDispatchClaimEvidence): Promise<unknown>;
  getDatabase: () => SQLite.SQLiteDatabase;
  now: () => number;
}): EffectDispatchPorts {
  const claimToken = claimTokenFor(input.identity);
  const readState = async (): Promise<EffectDispatchReadState | null> => {
    const database = input.getDatabase();
    const snapshot = readToolEffectDispatchSnapshot(database, input.identity);
    const claim = existingClaim(input.identity, snapshot.effect);
    return {
      snapshot,
      existingClaim: claim ? { claim, receipt: null } : null,
    };
  };
  const rejectAndCancel = (
    reason: Extract<
      AtomicEffectDispatchClaimResult,
      { kind: 'rejected' }
    >['reason'],
  ): AtomicEffectDispatchClaimResult => {
    const database = input.getDatabase();
    return withImmediateTransaction(database, () => {
      cancelUnclaimedDispatch(database, input.identity, input.now());
      return { kind: 'rejected', reason };
    });
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
      return withImmediateTransaction(database, () => {
        const snapshot = readToolEffectDispatchSnapshot(database, input.identity);
        const existing = existingClaim(input.identity, snapshot.effect);
        if (existing) {
          return { kind: 'existing', claim: existing, receipt: null };
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
          cancelUnclaimedDispatch(database, input.identity, input.now());
          return { kind: 'rejected', reason: 'approval_not_granted' };
        }
        if (recoveryControl?.cancellation_state !== 'active' || !input.authority.controlGranted()) {
          cancelUnclaimedDispatch(database, input.identity, input.now());
          return { kind: 'rejected', reason: 'control_epoch_changed' };
        }
        if (!input.authority.permissionGranted()) {
          cancelUnclaimedDispatch(database, input.identity, input.now());
          return { kind: 'rejected', reason: 'permission_not_granted' };
        }
        const claimedAt = Math.max(
          candidate.evaluatedAt,
          snapshot.run.updatedAt,
          snapshot.effect.updatedAt,
          input.now(),
        );
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
            ? { kind: 'existing', claim: refreshedClaim, receipt: null }
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
      });
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
          return effect.outcomeDigest === candidate.outcomeDigest
            ? { kind: 'replayed' }
            : { kind: 'rejected', reason: 'receipt_conflict' };
        }
        const observedAt = Math.max(candidate.observedAt, run.updatedAt, effect.updatedAt);
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
  const now = options.now ?? Date.now;
  const database = getDatabase();
  prepareToolEffectDispatchState(database, plan);
  return {
    identity: plan.identity,
    ports: makePorts({ identity: plan.identity, authority, dispatch, getDatabase, now }),
  };
}
