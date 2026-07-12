import type * as SQLite from 'expo-sqlite';
import { decodeExecutionCheckpointRow, decodeExecutionRunRow } from './decoders';
import type { EffectDispatchIdentity, EffectDispatchSnapshot } from './effectDispatchPolicy';
import {
  effectRow,
  insertCheckpoint,
  insertRun,
  readCheckpoint,
  readEffect,
  readRun,
  runRow,
  withImmediateTransaction,
} from './mutationStore';
import type {
  ExecutionApprovalState,
  ExecutionCapability,
  ExecutionCheckpointRecord,
  ExecutionEffectClass,
  ExecutionEffectRecord,
  ExecutionIdempotencyClass,
  ExecutionRetryPolicy,
  ExecutionRunRecord,
  ExecutionSurface,
} from './types';

type GrantedAuthorityState = Extract<ExecutionApprovalState, 'granted' | 'not_required'>;

export interface ToolEffectDispatchJournalPlan {
  identity: EffectDispatchIdentity;
  conversationId: string;
  inputDigest: string;
  dispatchTargetDigest: string;
  effectClass: ExecutionEffectClass;
  idempotencyClass: ExecutionIdempotencyClass;
  retryPolicy: ExecutionRetryPolicy;
  requestedCapability: ExecutionCapability;
  executionSurface: ExecutionSurface;
  approvalState: GrantedAuthorityState;
  permissionState: GrantedAuthorityState;
  preparedAt: number;
  initialStateDigest: string;
  planningStateDigest: string;
  authorityStateDigest: string;
}

function latestCheckpoint(
  database: SQLite.SQLiteDatabase,
  runId: string,
): ExecutionCheckpointRecord {
  const row = database.getFirstSync<unknown>(
    `SELECT * FROM execution_checkpoints
     WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
    runId,
  );
  if (!row) {
    throw new Error('effect_dispatch_checkpoint_missing');
  }
  return decodeExecutionCheckpointRow(row);
}

export function readToolEffectDispatchSnapshot(
  database: SQLite.SQLiteDatabase,
  identity: EffectDispatchIdentity,
): EffectDispatchSnapshot {
  const run = readRun(database, identity.runId);
  const effect = readEffect(database, identity.runId, identity.effectId);
  const planningCheckpoint = readCheckpoint(database, identity.runId, effect.checkpointId ?? '');
  const authorityCheckpoint = readCheckpoint(
    database,
    identity.runId,
    identity.authorityCheckpointId,
  );
  const latest = latestCheckpoint(database, identity.runId);
  if (
    run.inputDigest !== identity.requestDigest ||
    run.taskId !== identity.executionRunId ||
    run.modelConfigDigest !== identity.dispatchTargetDigest ||
    effect.toolCallId !== identity.toolCallId ||
    effect.toolNameDigest !== identity.toolNameDigest ||
    effect.toolContractIdentityDigest !== identity.toolContractIdentityDigest ||
    effect.requestDigest !== identity.requestDigest ||
    effect.idempotencyKeyDigest !== identity.idempotencyKeyDigest ||
    effect.attempt !== identity.attempt ||
    authorityCheckpoint.id !== identity.authorityCheckpointId
  ) {
    throw new Error('effect_dispatch_identity_conflict');
  }
  return {
    run,
    effect,
    planningCheckpoint,
    authorityCheckpoint,
    latestCheckpointId: latest.id,
    authorizationExpiresAt: null,
  };
}

function assertPlanMatchesExisting(
  database: SQLite.SQLiteDatabase,
  plan: ToolEffectDispatchJournalPlan,
  snapshot: EffectDispatchSnapshot,
): void {
  const { run, effect, planningCheckpoint, authorityCheckpoint } = snapshot;
  const initialCheckpointRow = database.getFirstSync<unknown>(
    `SELECT * FROM execution_checkpoints
     WHERE run_id = ? AND sequence = 0`,
    run.id,
  );
  if (!initialCheckpointRow) {
    throw new Error('effect_dispatch_initial_checkpoint_missing');
  }
  const initialCheckpoint = decodeExecutionCheckpointRow(initialCheckpointRow);
  if (
    run.conversationId !== plan.conversationId ||
    run.threadId !== plan.conversationId ||
    run.taskId !== plan.identity.executionRunId ||
    run.requestMessageId !== plan.identity.toolCallId ||
    run.durabilityClass !== 'external_durable_operation' ||
    run.requestedCapability !== plan.requestedCapability ||
    run.executionSurface !== plan.executionSurface ||
    run.resumeStrategy !== 'reconcile_first' ||
    run.approvalState !== plan.approvalState ||
    run.permissionState !== plan.permissionState ||
    run.nextRetryPolicy !== plan.retryPolicy ||
    effect.effectClass !== plan.effectClass ||
    effect.idempotencyClass !== plan.idempotencyClass ||
    effect.retryPolicy !== plan.retryPolicy ||
    initialCheckpoint.id !== `effect-created-${plan.identity.effectId.slice('effect-'.length)}` ||
    initialCheckpoint.sequence !== 0 ||
    initialCheckpoint.boundary !== 'run_created' ||
    initialCheckpoint.stateDigest !== plan.initialStateDigest ||
    planningCheckpoint.id !== `effect-plan-${plan.identity.effectId.slice('effect-'.length)}` ||
    planningCheckpoint.sequence !== 1 ||
    planningCheckpoint.boundary !== 'before_effect' ||
    planningCheckpoint.stateRefId !== planningCheckpoint.id ||
    planningCheckpoint.stateDigest !== plan.planningStateDigest ||
    authorityCheckpoint.id !== plan.identity.authorityCheckpointId ||
    authorityCheckpoint.sequence !== 2 ||
    authorityCheckpoint.boundary !== 'before_effect' ||
    authorityCheckpoint.stateRefId !== authorityCheckpoint.id ||
    authorityCheckpoint.stateDigest !== plan.authorityStateDigest
  ) {
    throw new Error('effect_dispatch_identity_conflict');
  }
}

function insertPlannedJournal(
  database: SQLite.SQLiteDatabase,
  plan: ToolEffectDispatchJournalPlan,
): void {
  const { identity, preparedAt } = plan;
  const initialCheckpointId = `effect-created-${identity.effectId.slice('effect-'.length)}`;
  const planningCheckpointId = `effect-plan-${identity.effectId.slice('effect-'.length)}`;
  const initialRun: ExecutionRunRecord = {
    id: identity.runId,
    conversationId: plan.conversationId,
    threadId: plan.conversationId,
    taskId: identity.executionRunId,
    goalId: null,
    requestMessageId: identity.toolCallId,
    durabilityClass: 'external_durable_operation',
    requestedCapability: plan.requestedCapability,
    executionSurface: plan.executionSurface,
    status: 'queued',
    resumeStrategy: 'reconcile_first',
    approvalState: plan.approvalState,
    permissionState: plan.permissionState,
    inputDigest: plan.inputDigest,
    modelConfigDigest: plan.dispatchTargetDigest,
    retryCount: 0,
    nextRetryPolicy: plan.retryPolicy,
    controlEpoch: identity.controlEpoch,
    createdAt: preparedAt,
    updatedAt: preparedAt,
    terminalAt: null,
  };
  const initialCheckpoint: ExecutionCheckpointRecord = {
    id: initialCheckpointId,
    runId: identity.runId,
    sequence: 0,
    taskId: identity.executionRunId,
    goalId: null,
    phase: 'system',
    boundary: 'run_created',
    stateRefId: initialCheckpointId,
    stateDigest: plan.initialStateDigest,
    resumeStrategy: 'reconcile_first',
    approvalState: plan.approvalState,
    permissionState: plan.permissionState,
    controlEpoch: identity.controlEpoch,
    createdAt: preparedAt,
  };
  const planningCheckpoint: ExecutionCheckpointRecord = {
    ...initialCheckpoint,
    id: planningCheckpointId,
    sequence: 1,
    phase: 'work',
    boundary: 'before_effect',
    stateRefId: planningCheckpointId,
    stateDigest: plan.planningStateDigest,
  };
  const authorityCheckpoint: ExecutionCheckpointRecord = {
    ...planningCheckpoint,
    id: identity.authorityCheckpointId,
    sequence: 2,
    stateRefId: identity.authorityCheckpointId,
    stateDigest: plan.authorityStateDigest,
  };
  const effect: ExecutionEffectRecord = {
    id: identity.effectId,
    runId: identity.runId,
    checkpointId: planningCheckpoint.id,
    toolCallId: identity.toolCallId,
    toolNameDigest: identity.toolNameDigest,
    toolContractIdentityDigest: identity.toolContractIdentityDigest,
    effectClass: plan.effectClass,
    idempotencyClass: plan.idempotencyClass,
    idempotencyKeyDigest: identity.idempotencyKeyDigest,
    requestDigest: identity.requestDigest,
    outcomeDigest: null,
    status: 'planned',
    retryPolicy: plan.retryPolicy,
    attempt: identity.attempt,
    createdAt: preparedAt,
    startedAt: null,
    completedAt: null,
    updatedAt: preparedAt,
  };

  insertRun(database, initialRun);
  database.runSync(
    `INSERT INTO execution_recovery_controls (run_id, cancellation_state, updated_at)
     VALUES (?, 'active', ?)`,
    identity.runId,
    preparedAt,
  );
  insertCheckpoint(database, initialCheckpoint);
  insertCheckpoint(database, planningCheckpoint);
  database.runSync(
    `INSERT INTO execution_effects (
       id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
       tool_contract_identity_digest, effect_class,
       idempotency_class, idempotency_key_digest, request_digest, outcome_digest,
       status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(effectRow(effect)),
  );
  insertCheckpoint(database, authorityCheckpoint);
  const running = decodeExecutionRunRow(
    runRow({ ...initialRun, status: 'running', updatedAt: preparedAt }),
  );
  const update = database.runSync(
    `UPDATE execution_runs
     SET status = ?, updated_at = ?
     WHERE id = ? AND status = 'queued' AND control_epoch = ?`,
    running.status,
    running.updatedAt,
    running.id,
    running.controlEpoch,
  );
  if (update.changes !== 1) {
    throw new Error('effect_dispatch_run_prepare_conflict');
  }
}

export function prepareToolEffectDispatchState(
  database: SQLite.SQLiteDatabase,
  plan: ToolEffectDispatchJournalPlan,
): EffectDispatchSnapshot {
  return withImmediateTransaction(database, () => {
    const row = database.getFirstSync<unknown>(
      'SELECT * FROM execution_runs WHERE id = ?',
      plan.identity.runId,
    );
    if (!row) {
      insertPlannedJournal(database, plan);
    }
    const snapshot = readToolEffectDispatchSnapshot(database, plan.identity);
    assertPlanMatchesExisting(database, plan, snapshot);
    return snapshot;
  });
}

export function appendToolEffectDispatchTerminalCheckpoint(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  effectId: string,
  stateDigest: string,
  createdAt: number,
): void {
  const latest = latestCheckpoint(database, run.id);
  insertCheckpoint(database, {
    id: `effect-terminal-${effectId.slice('effect-'.length)}`,
    runId: run.id,
    sequence: latest.sequence + 1,
    taskId: run.taskId,
    goalId: run.goalId,
    phase: 'deliver',
    boundary: 'terminal',
    stateRefId: `effect-terminal-${effectId.slice('effect-'.length)}`,
    stateDigest,
    resumeStrategy: run.resumeStrategy,
    approvalState: run.approvalState,
    permissionState: run.permissionState,
    controlEpoch: run.controlEpoch,
    createdAt,
  });
}
