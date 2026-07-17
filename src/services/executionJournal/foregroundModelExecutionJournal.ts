import type * as SQLite from 'expo-sqlite';
import type { ModelProjectionOwner } from '../../types/conversation';
import { generateId } from '../../utils/id';
import { sha256HexUtf8Async } from '../../utils/sha256Async';
import { createForegroundModelGenerationChangedError } from '../runtimeError';
import { getExecutionJournalDb } from './database';
import { decodeExecutionCheckpointRow, decodeExecutionRunRow } from './decoders';
import {
  assertMonotonicTime,
  checkpointRow,
  insertCheckpoint,
  insertRun,
  readRun,
  runRow,
  withImmediateTransaction,
} from './mutationStore';
import { canTransitionExecutionRun } from './transitions';
import type { ExecutionCheckpointRecord, ExecutionRunRecord } from './types';
import {
  FOREGROUND_MODEL_ACTIVE_RUN_STATUSES,
  type ActivateForegroundModelExecutionInput,
  type BeginForegroundModelExecutionInput,
  type CompleteForegroundModelExecutionInput,
  type ForegroundModelExecutionLease,
} from './foregroundModelExecutionTypes';
import { maintainForegroundModelExecutionRetention } from './foregroundModelExecutionRetention';
import {
  markForegroundModelExecutionOwnedByCurrentProcess,
  relinquishForegroundModelExecutionProcessOwnership,
} from './foregroundModelExecutionProcessOwnership';

const FOREGROUND_MODEL_JOURNAL_FORMAT = 'kavi.foreground-model-execution.v1';
export function modelProjectionOwnerForForegroundLease(
  lease: ForegroundModelExecutionLease,
): ModelProjectionOwner {
  if (!validLease(lease)) {
    throw new Error('foreground_model_journal_invalid_lease');
  }
  return {
    surface: 'foreground',
    runId: lease.runId,
    requestMessageId: lease.requestMessageId,
    assistantMessageId: lease.assistantMessageId,
    controlEpoch: lease.controlEpoch,
  };
}

interface ForegroundModelJournalOptions {
  clock?: () => number;
  digest?: (value: string) => Promise<string>;
  generateId?: () => string;
  getDatabase?: () => SQLite.SQLiteDatabase;
  maintainRetention?: (input: { now: number }) => number;
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

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function canonicalValue(label: string, value: unknown): string {
  const canonical = JSON.stringify([FOREGROUND_MODEL_JOURNAL_FORMAT, label, value]);
  if (typeof canonical !== 'string') {
    throw new Error('foreground_model_journal_state_not_serializable');
  }
  return canonical;
}

async function digestValue(
  label: string,
  value: unknown,
  digest: (value: string) => Promise<string>,
): Promise<string> {
  const result = (await digest(canonicalValue(label, value))).toLowerCase();
  if (!validDigest(result)) {
    throw new Error('foreground_model_journal_invalid_digest');
  }
  return result;
}

function generatedId(prefix: string, createId: () => string): string {
  const id = `${prefix}-${createId()}`;
  if (!validId(id)) {
    throw new Error('foreground_model_journal_invalid_generated_id');
  }
  return id;
}

function validateBeginInput(input: BeginForegroundModelExecutionInput): void {
  if (
    !input ||
    !validId(input.runId) ||
    !validId(input.conversationId) ||
    !validId(input.requestMessageId) ||
    !validId(input.assistantMessageId) ||
    (input.taskId !== undefined && !validId(input.taskId))
  ) {
    throw new Error('foreground_model_journal_invalid_input');
  }
}

function validLease(lease: ForegroundModelExecutionLease): boolean {
  return (
    Boolean(lease) &&
    validId(lease.runId) &&
    validId(lease.conversationId) &&
    validId(lease.requestMessageId) &&
    validId(lease.assistantMessageId) &&
    (lease.taskId === null || validId(lease.taskId)) &&
    validTimestamp(lease.createdAt) &&
    FOREGROUND_MODEL_ACTIVE_RUN_STATUSES.includes(
      lease.expectedStatus as (typeof FOREGROUND_MODEL_ACTIVE_RUN_STATUSES)[number],
    ) &&
    Number.isSafeInteger(lease.controlEpoch) &&
    lease.controlEpoch >= 0 &&
    validTimestamp(lease.updatedAt) &&
    validId(lease.checkpointId) &&
    validDigest(lease.checkpointStateDigest)
  );
}

function toLease(
  run: ExecutionRunRecord,
  checkpoint: ExecutionCheckpointRecord,
): ForegroundModelExecutionLease {
  return {
    runId: run.id,
    conversationId: run.conversationId,
    requestMessageId: run.requestMessageId,
    assistantMessageId: checkpoint.stateRefId,
    taskId: run.taskId,
    createdAt: run.createdAt,
    expectedStatus: run.status,
    controlEpoch: run.controlEpoch,
    updatedAt: run.updatedAt,
    checkpointId: checkpoint.id,
    checkpointStateDigest: checkpoint.stateDigest,
  };
}

/** Create a process-bound generation before its assistant projection may be persisted. */
export async function createForegroundModelExecution(
  input: BeginForegroundModelExecutionInput,
  options: ForegroundModelJournalOptions = {},
): Promise<ForegroundModelExecutionLease> {
  validateBeginInput(input);
  const clock = options.clock ?? Date.now;
  const createdAt = clock();
  if (!validTimestamp(createdAt)) {
    throw new Error('foreground_model_journal_invalid_clock');
  }
  const createId = options.generateId ?? generateId;
  const digest = options.digest ?? sha256HexUtf8Async;
  const [inputDigest, modelConfigDigest, createdStateDigest] = await Promise.all([
    digestValue('request', input.requestState, digest),
    digestValue('model', input.modelState, digest),
    digestValue(
      'run_created',
      [input.conversationId, input.requestMessageId, input.assistantMessageId],
      digest,
    ),
  ]);
  const runId = input.runId;
  const initialCheckpointId = generatedId('foreground-created', createId);
  const run: ExecutionRunRecord = {
    id: runId,
    conversationId: input.conversationId,
    threadId: input.conversationId,
    taskId: input.taskId ?? null,
    goalId: null,
    requestMessageId: input.requestMessageId,
    durabilityClass: 'foreground_interactive',
    requestedCapability: 'compute',
    executionSurface: 'model',
    status: 'queued',
    resumeStrategy: 'not_resumable',
    approvalState: 'not_required',
    permissionState: 'granted',
    inputDigest,
    modelConfigDigest,
    retryCount: 0,
    nextRetryPolicy: 'none',
    controlEpoch: 0,
    createdAt,
    updatedAt: createdAt,
    terminalAt: null,
  };
  const initialCheckpoint = decodeExecutionCheckpointRow(
    checkpointRow({
      id: initialCheckpointId,
      runId,
      sequence: 0,
      taskId: run.taskId,
      goalId: null,
      phase: 'system',
      boundary: 'run_created',
      stateRefId: input.assistantMessageId,
      stateDigest: createdStateDigest,
      resumeStrategy: 'not_resumable',
      approvalState: 'not_required',
      permissionState: 'granted',
      controlEpoch: 0,
      createdAt,
    }),
  );
  const database = (options.getDatabase ?? getExecutionJournalDb)();
  const created = withImmediateTransaction(database, () => {
    insertRun(database, decodeExecutionRunRow(runRow(run)));
    database.runSync(
      `INSERT INTO execution_recovery_controls (run_id, cancellation_state, updated_at)
       VALUES (?, 'active', ?)`,
      run.id,
      createdAt,
    );
    insertCheckpoint(database, initialCheckpoint);
    return toLease(readRun(database, run.id), initialCheckpoint);
  });
  markForegroundModelExecutionOwnedByCurrentProcess(created.runId);
  return created;
}

/** Arm one exact claimed generation after its projection owner has been durably flushed. */
export async function activateForegroundModelExecution(
  input: ActivateForegroundModelExecutionInput,
  options: ForegroundModelJournalOptions = {},
): Promise<ForegroundModelExecutionLease> {
  if (!input || !validLease(input.lease) || input.lease.expectedStatus !== 'queued') {
    throw new Error('foreground_model_journal_invalid_activation');
  }
  const clock = options.clock ?? Date.now;
  const requestedAt = clock();
  if (!validTimestamp(requestedAt)) {
    throw new Error('foreground_model_journal_invalid_clock');
  }
  const createId = options.generateId ?? generateId;
  const checkpointId = generatedId('foreground-before-model', createId);
  const digest = options.digest ?? sha256HexUtf8Async;
  const stateDigest = await digestValue(
    'before_model',
    [
      input.lease.conversationId,
      input.lease.requestMessageId,
      input.lease.assistantMessageId,
      input.lease.runId,
    ],
    digest,
  );
  const database = (options.getDatabase ?? getExecutionJournalDb)();

  return withImmediateTransaction(database, () => {
    const run = readRun(database, input.lease.runId);
    assertLease(run, input.lease);
    const latestRaw = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC, id ASC LIMIT 1`,
      run.id,
    );
    if (!latestRaw) throw new Error('foreground_model_journal_history_missing');
    const latest = decodeExecutionCheckpointRow(latestRaw);
    if (
      latest.id !== input.lease.checkpointId ||
      latest.stateDigest !== input.lease.checkpointStateDigest ||
      latest.stateRefId !== input.lease.assistantMessageId ||
      latest.controlEpoch !== run.controlEpoch ||
      latest.boundary !== 'run_created'
    ) {
      throw createForegroundModelGenerationChangedError();
    }
    assertEmptyEffectState(database, run.id);
    if (!canTransitionExecutionRun(run.status, 'running')) {
      throw new Error('foreground_model_journal_activation_transition_invalid');
    }
    const occurredAt = Math.max(requestedAt, run.updatedAt, latest.createdAt);
    const checkpoint = decodeExecutionCheckpointRow(
      checkpointRow({
        id: checkpointId,
        runId: run.id,
        sequence: latest.sequence + 1,
        taskId: run.taskId,
        goalId: run.goalId,
        phase: 'work',
        boundary: 'before_model',
        stateRefId: input.lease.assistantMessageId,
        stateDigest,
        resumeStrategy: 'not_resumable',
        approvalState: run.approvalState,
        permissionState: run.permissionState,
        controlEpoch: run.controlEpoch,
        createdAt: occurredAt,
      }),
    );
    insertCheckpoint(database, checkpoint);
    const transition = database.runSync(
      `UPDATE execution_runs SET status = 'running', updated_at = ?
       WHERE id = ? AND status = 'queued' AND control_epoch = ? AND updated_at = ?`,
      occurredAt,
      run.id,
      run.controlEpoch,
      run.updatedAt,
    );
    if (transition.changes !== 1) {
      throw createForegroundModelGenerationChangedError();
    }
    return toLease(readRun(database, run.id), checkpoint);
  });
}

function assertEmptyEffectState(database: SQLite.SQLiteDatabase, runId: string): void {
  const counts = database.getFirstSync<{
    effect_count: number;
    handle_count: number;
    monitor_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM execution_effects WHERE run_id = ?) AS effect_count,
       (SELECT COUNT(*) FROM execution_external_handles WHERE run_id = ?) AS handle_count,
       (SELECT COUNT(*) FROM execution_monitors WHERE run_id = ?) AS monitor_count`,
    runId,
    runId,
    runId,
  );
  if (counts?.effect_count !== 0 || counts.handle_count !== 0 || counts.monitor_count !== 0) {
    throw new Error('foreground_model_journal_effect_state_present');
  }
}

function assertLease(run: ExecutionRunRecord, lease: ForegroundModelExecutionLease): void {
  if (
    run.id !== lease.runId ||
    run.conversationId !== lease.conversationId ||
    run.threadId !== lease.conversationId ||
    run.requestMessageId !== lease.requestMessageId ||
    run.taskId !== lease.taskId ||
    run.createdAt !== lease.createdAt ||
    run.durabilityClass !== 'foreground_interactive' ||
    run.executionSurface !== 'model' ||
    run.resumeStrategy !== 'not_resumable'
  ) {
    throw new Error('foreground_model_journal_ownership_changed');
  }
  if (
    run.status !== lease.expectedStatus ||
    run.controlEpoch !== lease.controlEpoch ||
    run.updatedAt !== lease.updatedAt
  ) {
    throw createForegroundModelGenerationChangedError();
  }
}

/** Close one exact non-resumable generation after its chat projection is durably persisted. */
export async function completeForegroundModelExecution(
  input: CompleteForegroundModelExecutionInput,
  options: ForegroundModelJournalOptions = {},
): Promise<ExecutionRunRecord> {
  if (
    !input ||
    !validLease(input.lease) ||
    !validId(input.projectionMessageId) ||
    !['succeeded', 'failed', 'cancelled'].includes(input.status)
  ) {
    throw new Error('foreground_model_journal_invalid_completion');
  }
  const clock = options.clock ?? Date.now;
  const requestedAt = clock();
  if (!validTimestamp(requestedAt)) {
    throw new Error('foreground_model_journal_invalid_clock');
  }
  const createId = options.generateId ?? generateId;
  const terminalCheckpointId = generatedId('foreground-terminal', createId);
  const digest = options.digest ?? sha256HexUtf8Async;
  const terminalStateDigest = await digestValue(
    'terminal_projection',
    input.projectionState,
    digest,
  );
  const database = (options.getDatabase ?? getExecutionJournalDb)();

  const completed = withImmediateTransaction(database, () => {
    const run = readRun(database, input.lease.runId);
    assertLease(run, input.lease);
    if (!canTransitionExecutionRun(run.status, input.status)) {
      throw new Error('foreground_model_journal_terminal_transition_invalid');
    }
    const latestRaw = database.getFirstSync<unknown>(
      `SELECT * FROM execution_checkpoints
       WHERE run_id = ? ORDER BY sequence DESC, id ASC LIMIT 1`,
      run.id,
    );
    if (!latestRaw) {
      throw new Error('foreground_model_journal_history_missing');
    }
    const latest = decodeExecutionCheckpointRow(latestRaw);
    if (
      latest.id !== input.lease.checkpointId ||
      latest.stateDigest !== input.lease.checkpointStateDigest ||
      latest.stateRefId !== input.lease.assistantMessageId ||
      latest.controlEpoch !== run.controlEpoch ||
      latest.resumeStrategy !== 'not_resumable' ||
      !['run_created', 'before_model'].includes(latest.boundary)
    ) {
      throw createForegroundModelGenerationChangedError();
    }
    assertEmptyEffectState(database, run.id);
    const occurredAt = Math.max(requestedAt, run.updatedAt);
    assertMonotonicTime(occurredAt, Math.max(run.updatedAt, latest.createdAt));
    if (!Number.isSafeInteger(run.controlEpoch + 1)) {
      throw new Error('foreground_model_journal_control_epoch_exhausted');
    }
    const terminalCheckpoint = decodeExecutionCheckpointRow({
      id: terminalCheckpointId,
      run_id: run.id,
      sequence: latest.sequence + 1,
      task_id: run.taskId,
      goal_id: run.goalId,
      phase: 'deliver',
      boundary: 'terminal',
      state_ref_id: input.projectionMessageId,
      state_digest: terminalStateDigest,
      resume_strategy: 'not_resumable',
      approval_state: run.approvalState,
      permission_state: run.permissionState,
      control_epoch: run.controlEpoch + 1,
      created_at: occurredAt,
    });
    insertCheckpoint(database, terminalCheckpoint);
    const next = decodeExecutionRunRow(
      runRow({
        ...run,
        status: input.status,
        controlEpoch: run.controlEpoch + 1,
        updatedAt: occurredAt,
        terminalAt: occurredAt,
      }),
    );
    const result = database.runSync(
      `UPDATE execution_runs
       SET status = ?, control_epoch = ?, updated_at = ?, terminal_at = ?
       WHERE id = ? AND status = ? AND control_epoch = ? AND updated_at = ?`,
      next.status,
      next.controlEpoch,
      next.updatedAt,
      next.terminalAt,
      run.id,
      run.status,
      run.controlEpoch,
      run.updatedAt,
    );
    if (result.changes !== 1) {
      throw createForegroundModelGenerationChangedError();
    }
    if (next.status === 'cancelled') {
      const controlResult = database.runSync(
        `UPDATE execution_recovery_controls
         SET cancellation_state = 'cancelled', updated_at = ?
         WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
        occurredAt,
        run.id,
      );
      if (controlResult.changes !== 1) {
        throw new Error('foreground_model_journal_recovery_control_conflict');
      }
    }
    return readRun(database, run.id);
  });
  relinquishForegroundModelExecutionProcessOwnership(completed.id);
  try {
    (options.maintainRetention ?? maintainForegroundModelExecutionRetention)({
      now: completed.terminalAt ?? requestedAt,
    });
  } catch (error) {
    console.warn('[execution-journal] foreground model retention failed:', error);
  }
  return completed;
}
