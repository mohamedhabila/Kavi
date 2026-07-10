import type * as SQLite from 'expo-sqlite';
import {
  decodeExecutionCheckpointRow,
  decodeExecutionEffectRow,
  decodeExecutionExternalHandleRow,
  decodeExecutionMonitorRow,
  decodeExecutionRunRow,
} from './decoders';
import {
  MAX_EXECUTION_CHECKPOINTS_PER_RUN,
  RETENTION_DELETABLE_RUN_STATUSES,
  type ExecutionCheckpointRecord,
  type ExecutionEffectRecord,
  type ExecutionExternalHandleRecord,
  type ExecutionMonitorRecord,
  type ExecutionRunRecord,
} from './types';

const TERMINAL_RUN_STATUSES = new Set<string>(RETENTION_DELETABLE_RUN_STATUSES);

export function runRow(record: ExecutionRunRecord): Record<string, SQLite.SQLiteBindValue> {
  return {
    id: record.id,
    conversation_id: record.conversationId,
    thread_id: record.threadId,
    task_id: record.taskId,
    goal_id: record.goalId,
    request_message_id: record.requestMessageId,
    durability_class: record.durabilityClass,
    requested_capability: record.requestedCapability,
    execution_surface: record.executionSurface,
    status: record.status,
    resume_strategy: record.resumeStrategy,
    approval_state: record.approvalState,
    permission_state: record.permissionState,
    input_digest: record.inputDigest,
    model_config_digest: record.modelConfigDigest,
    retry_count: record.retryCount,
    next_retry_policy: record.nextRetryPolicy,
    control_epoch: record.controlEpoch,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    terminal_at: record.terminalAt,
  };
}

export function checkpointRow(
  record: ExecutionCheckpointRecord,
): Record<string, SQLite.SQLiteBindValue> {
  return {
    id: record.id,
    run_id: record.runId,
    sequence: record.sequence,
    task_id: record.taskId,
    goal_id: record.goalId,
    phase: record.phase,
    boundary: record.boundary,
    state_ref_id: record.stateRefId,
    state_digest: record.stateDigest,
    resume_strategy: record.resumeStrategy,
    approval_state: record.approvalState,
    permission_state: record.permissionState,
    control_epoch: record.controlEpoch,
    created_at: record.createdAt,
  };
}

export function effectRow(record: ExecutionEffectRecord): Record<string, SQLite.SQLiteBindValue> {
  return {
    id: record.id,
    run_id: record.runId,
    checkpoint_id: record.checkpointId,
    tool_call_id: record.toolCallId,
    tool_name_digest: record.toolNameDigest,
    effect_class: record.effectClass,
    idempotency_class: record.idempotencyClass,
    idempotency_key_digest: record.idempotencyKeyDigest,
    request_digest: record.requestDigest,
    outcome_digest: record.outcomeDigest,
    status: record.status,
    retry_policy: record.retryPolicy,
    attempt: record.attempt,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    updated_at: record.updatedAt,
  };
}

export function handleRow(
  record: ExecutionExternalHandleRecord,
): Record<string, SQLite.SQLiteBindValue> {
  const expoProjectId =
    record.locator.kind === 'expo_workflow_run' ? record.locator.projectId : null;
  const githubRepository =
    record.locator.kind === 'github_workflow_run' ? record.locator.repository : null;
  return {
    id: record.id,
    run_id: record.runId,
    effect_id: record.effectId,
    handle_kind: record.locator.kind,
    locator_version: record.locator.version,
    expo_project_id: expoProjectId,
    github_repository: githubRepository,
    workflow_run_id: record.locator.workflowRunId,
    credential_ref: record.locator.credentialRef,
    source_tool_name_digest: record.sourceToolNameDigest,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_attempted_at: record.lastAttemptedAt,
    last_verified_at: record.lastVerifiedAt,
  };
}

export function monitorRow(record: ExecutionMonitorRecord): Record<string, SQLite.SQLiteBindValue> {
  return {
    id: record.id,
    run_id: record.runId,
    external_handle_id: record.externalHandleId,
    baseline_status: record.baselineStatus,
    condition_kind: record.condition,
    action_kind: record.action,
    state: record.state,
    next_legal_check_at: record.nextLegalCheckAt,
    last_observed_status: record.lastObservedStatus,
    observation_count: record.observationCount,
    last_observed_at: record.lastObservedAt,
    condition_met_at: record.conditionMetAt,
    acted_at: record.actedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function withImmediateTransaction<T>(database: SQLite.SQLiteDatabase, work: () => T): T {
  database.execSync('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.execSync('COMMIT');
    return result;
  } catch (error) {
    try {
      database.execSync('ROLLBACK');
    } catch {
      // Preserve the original mutation error.
    }
    throw error;
  }
}

export function readRun(database: SQLite.SQLiteDatabase, runId: string): ExecutionRunRecord {
  const row = database.getFirstSync<unknown>('SELECT * FROM execution_runs WHERE id = ?', runId);
  if (!row) {
    throw new Error('execution_journal_run_not_found');
  }
  return decodeExecutionRunRow(row);
}

export function readCheckpoint(
  database: SQLite.SQLiteDatabase,
  runId: string,
  checkpointId: string,
): ExecutionCheckpointRecord {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_checkpoints WHERE run_id = ? AND id = ?',
    runId,
    checkpointId,
  );
  if (!row) {
    throw new Error('execution_journal_checkpoint_not_found');
  }
  return decodeExecutionCheckpointRow(row);
}

export function readEffect(
  database: SQLite.SQLiteDatabase,
  runId: string,
  effectId: string,
): ExecutionEffectRecord {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_effects WHERE run_id = ? AND id = ?',
    runId,
    effectId,
  );
  if (!row) {
    throw new Error('execution_journal_effect_not_found');
  }
  return decodeExecutionEffectRow(row);
}

export function readHandle(
  database: SQLite.SQLiteDatabase,
  runId: string,
  handleId: string,
): ExecutionExternalHandleRecord {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_external_handles WHERE run_id = ? AND id = ?',
    runId,
    handleId,
  );
  if (!row) {
    throw new Error('execution_journal_external_handle_not_found');
  }
  return decodeExecutionExternalHandleRow(row);
}

export function readMonitor(
  database: SQLite.SQLiteDatabase,
  runId: string,
  monitorId: string,
): ExecutionMonitorRecord {
  const row = database.getFirstSync<unknown>(
    'SELECT * FROM execution_monitors WHERE run_id = ? AND id = ?',
    runId,
    monitorId,
  );
  if (!row) {
    throw new Error('execution_journal_monitor_not_found');
  }
  return decodeExecutionMonitorRow(row);
}

export function assertWritableRun(run: ExecutionRunRecord, expectedControlEpoch: number): void {
  if (!Number.isSafeInteger(expectedControlEpoch) || expectedControlEpoch < 0) {
    throw new Error('execution_journal_invalid_control_epoch');
  }
  if (run.controlEpoch !== expectedControlEpoch) {
    throw new Error('execution_journal_stale_control_epoch');
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new Error('execution_journal_terminal_run');
  }
}

export function assertMonotonicTime(occurredAt: number, previousAt: number): void {
  if (!Number.isSafeInteger(occurredAt) || occurredAt < previousAt) {
    throw new Error('execution_journal_non_monotonic_time');
  }
}

export function touchRun(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  occurredAt: number,
  checkpoint?: ExecutionCheckpointRecord,
): void {
  const result = checkpoint
    ? database.runSync(
        `UPDATE execution_runs
         SET resume_strategy = ?, approval_state = ?, permission_state = ?, updated_at = ?
         WHERE id = ? AND status = ? AND control_epoch = ?`,
        checkpoint.resumeStrategy,
        checkpoint.approvalState,
        checkpoint.permissionState,
        occurredAt,
        run.id,
        run.status,
        run.controlEpoch,
      )
    : database.runSync(
        `UPDATE execution_runs SET updated_at = ?
         WHERE id = ? AND status = ? AND control_epoch = ?`,
        occurredAt,
        run.id,
        run.status,
        run.controlEpoch,
      );
  if (result.changes !== 1) {
    throw new Error('execution_journal_concurrent_run_mutation');
  }
}

export function insertRun(database: SQLite.SQLiteDatabase, run: ExecutionRunRecord): void {
  database.runSync(
    `INSERT INTO execution_runs (
       id, conversation_id, thread_id, task_id, goal_id, request_message_id,
       durability_class, requested_capability, execution_surface, status,
       resume_strategy, approval_state, permission_state, input_digest,
       model_config_digest, retry_count, next_retry_policy, control_epoch,
       created_at, updated_at, terminal_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(runRow(run)),
  );
}

export function insertCheckpoint(
  database: SQLite.SQLiteDatabase,
  checkpoint: ExecutionCheckpointRecord,
): void {
  const countRow = database.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM execution_checkpoints WHERE run_id = ?',
    checkpoint.runId,
  );
  const checkpointCount = countRow?.count;
  if (
    typeof checkpointCount !== 'number' ||
    !Number.isSafeInteger(checkpointCount) ||
    checkpointCount < 0
  ) {
    throw new Error('execution_journal_checkpoint_count_invalid');
  }
  if (checkpointCount >= MAX_EXECUTION_CHECKPOINTS_PER_RUN) {
    throw new Error('execution_journal_checkpoint_limit_exceeded');
  }
  database.runSync(
    `INSERT INTO execution_checkpoints (
       id, run_id, sequence, task_id, goal_id, phase, boundary, state_ref_id,
       state_digest, resume_strategy, approval_state, permission_state,
       control_epoch, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(checkpointRow(checkpoint)),
  );
}

export function insertMonitor(
  database: SQLite.SQLiteDatabase,
  monitor: ExecutionMonitorRecord,
): void {
  database.runSync(
    `INSERT INTO execution_monitors (
       id, run_id, external_handle_id, baseline_status, condition_kind,
       action_kind, state, next_legal_check_at, last_observed_status,
       observation_count, last_observed_at, condition_met_at, acted_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(monitorRow(monitor)),
  );
}
