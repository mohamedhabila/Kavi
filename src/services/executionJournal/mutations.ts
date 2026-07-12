import type * as SQLite from 'expo-sqlite';
import { getExecutionJournalDb } from './database';
import {
  decodeExecutionCheckpointRow,
  decodeExecutionEffectRow,
  decodeExecutionExternalHandleRow,
  decodeExecutionRunRow,
} from './decoders';
import {
  assertMonotonicTime,
  assertWritableRun,
  checkpointRow,
  effectRow,
  handleRow,
  insertCheckpoint,
  insertRun,
  readCheckpoint,
  readEffect,
  readHandle,
  readRun,
  runRow,
  touchRun,
  withImmediateTransaction,
} from './mutationStore';
import {
  canTransitionExecutionEffect,
  canTransitionExecutionExternalHandle,
  canTransitionExecutionRun,
} from './transitions';
import {
  RETENTION_DELETABLE_RUN_STATUSES,
  type ExecutionCheckpointRecord,
  type ExecutionEffectClass,
  type ExecutionEffectRecord,
  type ExecutionEffectStatus,
  type ExecutionExternalHandleRecord,
  type ExecutionExternalHandleStatus,
  type ExecutionIdempotencyClass,
  type ExecutionRetryPolicy,
  type ExecutionRunRecord,
  type ExecutionRunStatus,
} from './types';
import type { ExecutionExternalHandleLocator } from './externalLocators';
import { advanceExternalHandleMonitor, insertExternalHandleMonitor } from './monitorRecords';

const TERMINAL_RUN_STATUSES = new Set<string>(RETENTION_DELETABLE_RUN_STATUSES);
const EFFECT_PLANNING_AUTHORITY_STATES = new Set(['not_required', 'granted']);

export interface CreateExecutionRunInput {
  run: ExecutionRunRecord;
  initialCheckpoint: ExecutionCheckpointRecord;
}

export type AppendExecutionCheckpointInput = Omit<
  ExecutionCheckpointRecord,
  'sequence' | 'controlEpoch'
> & {
  expectedControlEpoch: number;
};

export interface PlanExecutionEffectInput {
  id: string;
  runId: string;
  checkpointId: string;
  expectedControlEpoch: number;
  toolCallId: string;
  toolNameDigest: string;
  effectClass: ExecutionEffectClass;
  idempotencyClass: ExecutionIdempotencyClass;
  idempotencyKeyDigest: string | null;
  requestDigest: string;
  retryPolicy: ExecutionRetryPolicy;
  attempt: number;
  createdAt: number;
}

export interface TransitionExecutionRunInput {
  runId: string;
  expectedStatus: ExecutionRunStatus;
  nextStatus: ExecutionRunStatus;
  expectedControlEpoch: number;
  nextControlEpoch: number;
  occurredAt: number;
}

export interface TransitionExecutionEffectInput {
  runId: string;
  effectId: string;
  expectedStatus: ExecutionEffectStatus;
  nextStatus: ExecutionEffectStatus;
  expectedControlEpoch: number;
  occurredAt: number;
  outcomeDigest?: string;
  executionAuthorityCheckpointId?: string;
}

export interface RegisterExecutionExternalHandleInput {
  id: string;
  monitorId: string;
  runId: string;
  effectId: string;
  expectedControlEpoch: number;
  locator: ExecutionExternalHandleLocator;
  sourceToolNameDigest: string;
  status: ExecutionExternalHandleStatus;
  createdAt: number;
}

export interface TransitionExecutionExternalHandleInput {
  runId: string;
  handleId: string;
  expectedStatus: ExecutionExternalHandleStatus;
  nextStatus: ExecutionExternalHandleStatus;
  expectedControlEpoch: number;
  occurredAt: number;
}

function assertNoUnresolvedWork(database: SQLite.SQLiteDatabase, runId: string): void {
  const row = database.getFirstSync<{ unresolved: number }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM execution_effects
         WHERE run_id = ? AND status IN ('planned', 'started', 'applied', 'ambiguous')
       )
       OR EXISTS (
         SELECT 1 FROM execution_external_handles
         WHERE run_id = ? AND status IN ('unknown', 'pending', 'running')
       )
     ) AS unresolved`,
    runId,
    runId,
  );
  if (row?.unresolved !== 0) {
    throw new Error('execution_journal_unresolved_work_prevents_terminal');
  }
}

function assertEffectPlanningPolicy(
  effect: ExecutionEffectRecord,
  checkpoint: ExecutionCheckpointRecord,
): void {
  if (
    !EFFECT_PLANNING_AUTHORITY_STATES.has(checkpoint.approvalState) ||
    !EFFECT_PLANNING_AUTHORITY_STATES.has(checkpoint.permissionState)
  ) {
    throw new Error('execution_journal_effect_planning_authority_not_granted');
  }
  if ((effect.effectClass === 'none') !== (effect.idempotencyClass === 'effect_free')) {
    throw new Error('execution_journal_inconsistent_effect_policy');
  }
  if (effect.retryPolicy === 'replay_safe' && effect.idempotencyClass !== 'effect_free') {
    throw new Error('execution_journal_unsafe_replay_policy');
  }
  if (
    ['destructive', 'unknown'].includes(effect.effectClass) &&
    !['none', 'manual'].includes(effect.retryPolicy)
  ) {
    throw new Error('execution_journal_unsafe_effect_retry_policy');
  }
}

function assertExecutionAuthorityCheckpoint(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  effect: ExecutionEffectRecord,
  checkpointId: string | undefined,
  occurredAt: number,
): void {
  if (!checkpointId) {
    throw new Error('execution_journal_execution_authority_revalidation_required');
  }
  if (!effect.checkpointId) {
    throw new Error('execution_journal_execution_authority_revalidation_required');
  }
  const planningCheckpoint = readCheckpoint(database, run.id, effect.checkpointId);
  const checkpoint = readCheckpoint(database, run.id, checkpointId);
  const latestRow = database.getFirstSync<unknown>(
    `SELECT * FROM execution_checkpoints
     WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
    run.id,
  );
  const latest = latestRow ? decodeExecutionCheckpointRow(latestRow) : null;
  if (
    latest?.id !== checkpoint.id ||
    checkpoint.boundary !== 'before_effect' ||
    checkpoint.controlEpoch !== run.controlEpoch ||
    checkpoint.sequence <= planningCheckpoint.sequence ||
    checkpoint.createdAt < effect.createdAt ||
    checkpoint.createdAt > occurredAt
  ) {
    throw new Error('execution_journal_execution_authority_revalidation_required');
  }
  if (
    !EFFECT_PLANNING_AUTHORITY_STATES.has(checkpoint.approvalState) ||
    !EFFECT_PLANNING_AUTHORITY_STATES.has(checkpoint.permissionState)
  ) {
    throw new Error('execution_journal_execution_authority_not_granted');
  }
}

export function createExecutionRun(input: CreateExecutionRunInput): {
  run: ExecutionRunRecord;
  initialCheckpoint: ExecutionCheckpointRecord;
} {
  const run = decodeExecutionRunRow(runRow(input.run));
  const initialCheckpoint = decodeExecutionCheckpointRow(checkpointRow(input.initialCheckpoint));
  if (
    run.status !== 'queued' ||
    run.controlEpoch !== 0 ||
    run.retryCount !== 0 ||
    run.createdAt !== run.updatedAt ||
    initialCheckpoint.runId !== run.id ||
    initialCheckpoint.sequence !== 0 ||
    initialCheckpoint.phase !== 'system' ||
    initialCheckpoint.boundary !== 'run_created' ||
    initialCheckpoint.controlEpoch !== 0 ||
    initialCheckpoint.createdAt !== run.createdAt ||
    initialCheckpoint.taskId !== run.taskId ||
    initialCheckpoint.goalId !== run.goalId ||
    initialCheckpoint.resumeStrategy !== run.resumeStrategy ||
    initialCheckpoint.approvalState !== run.approvalState ||
    initialCheckpoint.permissionState !== run.permissionState
  ) {
    throw new Error('execution_journal_invalid_initial_state');
  }

  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    insertRun(database, run);
    database.runSync(
      `INSERT INTO execution_recovery_controls (run_id, cancellation_state, updated_at)
       VALUES (?, 'active', ?)`,
      run.id,
      run.createdAt,
    );
    insertCheckpoint(database, initialCheckpoint);
    return {
      run: readRun(database, run.id),
      initialCheckpoint: readCheckpoint(database, run.id, initialCheckpoint.id),
    };
  });
}

export function appendExecutionCheckpoint(
  input: AppendExecutionCheckpointInput,
): ExecutionCheckpointRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    const previousRow = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      run.id,
    );
    const previous = previousRow ? decodeExecutionCheckpointRow(previousRow) : null;
    const sequence = previous ? previous.sequence + 1 : 0;
    if (!Number.isSafeInteger(sequence)) {
      throw new Error('execution_journal_checkpoint_sequence_exhausted');
    }
    const checkpoint = decodeExecutionCheckpointRow(
      checkpointRow({ ...input, sequence, controlEpoch: run.controlEpoch }),
    );
    assertMonotonicTime(checkpoint.createdAt, Math.max(run.updatedAt, previous?.createdAt ?? 0));
    insertCheckpoint(database, checkpoint);
    touchRun(database, run, checkpoint.createdAt, checkpoint);
    return readCheckpoint(database, run.id, checkpoint.id);
  });
}

export function transitionExecutionRun(input: TransitionExecutionRunInput): ExecutionRunRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    if (run.status !== input.expectedStatus) {
      throw new Error('execution_journal_run_status_conflict');
    }
    if (!canTransitionExecutionRun(run.status, input.nextStatus)) {
      throw new Error(`execution_journal_illegal_run_transition:${run.status}:${input.nextStatus}`);
    }
    if (
      input.nextControlEpoch !== run.controlEpoch &&
      input.nextControlEpoch !== run.controlEpoch + 1
    ) {
      throw new Error('execution_journal_invalid_next_control_epoch');
    }
    assertMonotonicTime(input.occurredAt, run.updatedAt);
    const terminalAt = TERMINAL_RUN_STATUSES.has(input.nextStatus) ? input.occurredAt : null;
    if (terminalAt !== null) {
      assertNoUnresolvedWork(database, run.id);
    }
    const next = decodeExecutionRunRow(
      runRow({
        ...run,
        status: input.nextStatus,
        controlEpoch: input.nextControlEpoch,
        updatedAt: input.occurredAt,
        terminalAt,
      }),
    );
    const result = database.runSync(
      `UPDATE execution_runs
       SET status = ?, control_epoch = ?, updated_at = ?, terminal_at = ?
       WHERE id = ? AND status = ? AND control_epoch = ?`,
      next.status,
      next.controlEpoch,
      next.updatedAt,
      next.terminalAt,
      run.id,
      run.status,
      run.controlEpoch,
    );
    if (result.changes !== 1) {
      throw new Error('execution_journal_concurrent_run_mutation');
    }
    if (next.status === 'cancelled') {
      const controlResult = database.runSync(
        `UPDATE execution_recovery_controls
         SET cancellation_state = 'cancelled', updated_at = ?
         WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
        next.updatedAt,
        run.id,
      );
      if (controlResult.changes !== 1) {
        throw new Error('execution_journal_recovery_control_conflict');
      }
    }
    return readRun(database, run.id);
  });
}

export function planExecutionEffect(input: PlanExecutionEffectInput): ExecutionEffectRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    if (run.status !== 'running') {
      throw new Error('execution_journal_run_not_executing');
    }
    const checkpoint = readCheckpoint(database, run.id, input.checkpointId);
    const latestRow = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      run.id,
    );
    const latest = latestRow ? decodeExecutionCheckpointRow(latestRow) : null;
    if (
      checkpoint.controlEpoch !== run.controlEpoch ||
      checkpoint.boundary !== 'before_effect' ||
      latest?.id !== checkpoint.id
    ) {
      throw new Error('execution_journal_unsafe_effect_checkpoint');
    }
    const effect = decodeExecutionEffectRow(
      effectRow({
        id: input.id,
        runId: run.id,
        checkpointId: checkpoint.id,
        toolCallId: input.toolCallId,
        toolNameDigest: input.toolNameDigest,
        toolContractIdentityDigest: null,
        effectClass: input.effectClass,
        idempotencyClass: input.idempotencyClass,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        requestDigest: input.requestDigest,
        outcomeDigest: null,
        status: 'planned',
        retryPolicy: input.retryPolicy,
        attempt: input.attempt,
        createdAt: input.createdAt,
        startedAt: null,
        completedAt: null,
        updatedAt: input.createdAt,
      }),
    );
    assertEffectPlanningPolicy(effect, checkpoint);
    assertMonotonicTime(effect.createdAt, Math.max(run.updatedAt, checkpoint.createdAt));
    database.runSync(
      `INSERT INTO execution_effects (
         id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
         tool_contract_identity_digest, effect_class,
         idempotency_class, idempotency_key_digest, request_digest, outcome_digest,
         status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...Object.values(effectRow(effect)),
    );
    touchRun(database, run, effect.createdAt);
    return readEffect(database, run.id, effect.id);
  });
}

export function transitionExecutionEffect(
  input: TransitionExecutionEffectInput,
): ExecutionEffectRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    const effect = readEffect(database, run.id, input.effectId);
    if (effect.status !== input.expectedStatus) {
      throw new Error('execution_journal_effect_status_conflict');
    }
    if (!canTransitionExecutionEffect(effect.status, input.nextStatus)) {
      throw new Error(
        `execution_journal_illegal_effect_transition:${effect.status}:${input.nextStatus}`,
      );
    }
    if (input.nextStatus === 'started') {
      assertExecutionAuthorityCheckpoint(
        database,
        run,
        effect,
        input.executionAuthorityCheckpointId,
        input.occurredAt,
      );
    }
    assertMonotonicTime(input.occurredAt, Math.max(run.updatedAt, effect.updatedAt));
    const startedAt = input.nextStatus === 'started' ? input.occurredAt : effect.startedAt;
    const completes = ['applied', 'verified', 'failed', 'cancelled'].includes(input.nextStatus);
    const completedAt = completes ? (effect.completedAt ?? input.occurredAt) : effect.completedAt;
    const outcomeDigest = input.outcomeDigest ?? effect.outcomeDigest;
    if (['applied', 'verified', 'failed'].includes(input.nextStatus) && !outcomeDigest) {
      throw new Error('execution_journal_effect_outcome_digest_required');
    }
    if (input.nextStatus === 'started' && outcomeDigest) {
      throw new Error('execution_journal_effect_outcome_before_completion');
    }
    const next = decodeExecutionEffectRow(
      effectRow({
        ...effect,
        status: input.nextStatus,
        outcomeDigest,
        startedAt,
        completedAt,
        updatedAt: input.occurredAt,
      }),
    );
    const result = database.runSync(
      `UPDATE execution_effects
       SET status = ?, outcome_digest = ?, started_at = ?, completed_at = ?, updated_at = ?
       WHERE run_id = ? AND id = ? AND status = ?`,
      next.status,
      next.outcomeDigest,
      next.startedAt,
      next.completedAt,
      next.updatedAt,
      run.id,
      effect.id,
      effect.status,
    );
    if (result.changes !== 1) {
      throw new Error('execution_journal_concurrent_effect_mutation');
    }
    if (next.status === 'ambiguous' && run.status !== 'ambiguous') {
      if (!canTransitionExecutionRun(run.status, 'ambiguous')) {
        throw new Error(`execution_journal_cannot_mark_run_ambiguous:${run.status}`);
      }
      const runResult = database.runSync(
        `UPDATE execution_runs SET status = 'ambiguous', updated_at = ?
         WHERE id = ? AND status = ? AND control_epoch = ?`,
        next.updatedAt,
        run.id,
        run.status,
        run.controlEpoch,
      );
      if (runResult.changes !== 1) {
        throw new Error('execution_journal_concurrent_run_mutation');
      }
    } else {
      touchRun(database, run, next.updatedAt);
    }
    return readEffect(database, run.id, effect.id);
  });
}

export function registerExecutionExternalHandle(
  input: RegisterExecutionExternalHandleInput,
): ExecutionExternalHandleRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    const effect = readEffect(database, run.id, input.effectId);
    if (effect.startedAt === null) {
      throw new Error('execution_journal_external_handle_before_effect_start');
    }
    if (input.sourceToolNameDigest !== effect.toolNameDigest) {
      throw new Error('execution_journal_external_handle_tool_mismatch');
    }
    assertMonotonicTime(input.createdAt, Math.max(run.updatedAt, effect.startedAt));
    const handle = decodeExecutionExternalHandleRow(
      handleRow({
        id: input.id,
        runId: run.id,
        effectId: effect.id,
        locator: input.locator,
        sourceToolNameDigest: input.sourceToolNameDigest,
        status: input.status,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        lastAttemptedAt: input.createdAt,
        lastVerifiedAt: input.createdAt,
      }),
    );
    database.runSync(
      `INSERT INTO execution_external_handles (
         id, run_id, effect_id, handle_kind, locator_version, expo_project_id,
         github_repository, workflow_run_id, credential_ref,
         source_tool_name_digest, status, created_at, updated_at,
         last_attempted_at, last_verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...Object.values(handleRow(handle)),
    );
    insertExternalHandleMonitor(database, { id: input.monitorId, handle });
    touchRun(database, run, handle.createdAt);
    return readHandle(database, run.id, handle.id);
  });
}

export function transitionExecutionExternalHandle(
  input: TransitionExecutionExternalHandleInput,
): ExecutionExternalHandleRecord {
  const database = getExecutionJournalDb();
  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.runId);
    assertWritableRun(run, input.expectedControlEpoch);
    const handle = readHandle(database, run.id, input.handleId);
    if (handle.status !== input.expectedStatus) {
      throw new Error('execution_journal_external_handle_status_conflict');
    }
    if (!canTransitionExecutionExternalHandle(handle.status, input.nextStatus)) {
      throw new Error(
        `execution_journal_illegal_external_handle_transition:${handle.status}:${input.nextStatus}`,
      );
    }
    assertMonotonicTime(input.occurredAt, Math.max(run.updatedAt, handle.updatedAt));
    const next = decodeExecutionExternalHandleRow(
      handleRow({
        ...handle,
        status: input.nextStatus,
        updatedAt: input.occurredAt,
        lastAttemptedAt: input.occurredAt,
        lastVerifiedAt: input.occurredAt,
      }),
    );
    const result = database.runSync(
      `UPDATE execution_external_handles
       SET status = ?, updated_at = ?, last_attempted_at = ?, last_verified_at = ?
       WHERE run_id = ? AND id = ? AND status = ?`,
      next.status,
      next.updatedAt,
      next.lastAttemptedAt,
      next.lastVerifiedAt,
      run.id,
      handle.id,
      handle.status,
    );
    if (result.changes !== 1) {
      throw new Error('execution_journal_concurrent_external_handle_mutation');
    }
    advanceExternalHandleMonitor(database, {
      runId: run.id,
      externalHandleId: handle.id,
      observedStatus: next.status,
      outcome: ['succeeded', 'failed', 'cancelled'].includes(next.status) ? 'acted' : 'pending',
      nextLegalCheckAt: ['succeeded', 'failed', 'cancelled'].includes(next.status)
        ? null
        : input.occurredAt,
      occurredAt: input.occurredAt,
    });
    touchRun(database, run, next.updatedAt);
    return readHandle(database, run.id, handle.id);
  });
}
