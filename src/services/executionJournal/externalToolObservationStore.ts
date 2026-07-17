import type * as SQLite from 'expo-sqlite';
import {
  qualifyExternalDurableHandle,
  type ExternalDurableHandle,
} from '../../engine/durability/taskDurability';
import { sha256HexUtf8Async } from '../../utils/sha256Async';
import { getExecutionJournalDb } from './database';
import {
  decodeExecutionCheckpointRow,
  decodeExecutionEffectRow,
  decodeExecutionExternalHandleRow,
  decodeExecutionRunRow,
} from './decoders';
import {
  checkpointRow,
  effectRow,
  handleRow,
  insertCheckpoint,
  insertRun,
  readEffect,
  readHandle,
  readRun,
  runRow,
  withImmediateTransaction,
} from './mutationStore';
import { advanceExternalHandleMonitor, insertExternalHandleMonitor } from './monitorRecords';
import {
  canTransitionExecutionEffect,
  canTransitionExecutionExternalHandle,
  canTransitionExecutionRun,
} from './transitions';
import type {
  ExecutionCheckpointRecord,
  ExecutionEffectRecord,
  ExecutionExternalHandleRecord,
  ExecutionExternalHandleStatus,
  ExecutionRunRecord,
  ExecutionRunStatus,
} from './types';

const DIGEST_FORMAT = 'kavi.external-tool-observation.v1';

export interface PersistExternalToolObservationInput {
  toolName: string;
  toolCallId: string;
  argumentsText: string;
  resultText: string;
  conversationId: string;
  parentAgentRunId?: string;
  handle: ExternalDurableHandle;
  observedStatus: ExecutionExternalHandleStatus;
  observedAt: number;
}

export type PersistExternalToolObservationResult = {
  kind: 'created' | 'advanced' | 'unchanged' | 'already_terminal';
  runId: string;
  handleId: string;
  status: ExecutionExternalHandleStatus;
  terminal: boolean;
};

export interface ExternalToolObservationStoreOptions {
  getDatabase?: () => SQLite.SQLiteDatabase;
  digest?: (value: string) => Promise<string>;
}

interface ObservationIdentity {
  locatorDigest: string;
  toolNameDigest: string;
  requestDigest: string;
  resultDigest: string;
  modelDigest: string;
  runCreatedDigest: string;
  beforeEffectDigest: string;
  currentStateDigest: string;
  runId: string;
  effectId: string;
  handleId: string;
  monitorId: string;
  runCreatedCheckpointId: string;
  beforeEffectCheckpointId: string;
  currentCheckpointId: string;
}

function terminalRunStatus(
  status: ExecutionExternalHandleStatus,
): Extract<ExecutionRunStatus, 'succeeded' | 'failed' | 'cancelled'> | null {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status;
  return null;
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

function locatorWithoutSource(handle: ExternalDurableHandle) {
  const { sourceToolName: _sourceToolName, ...locator } = handle;
  return locator;
}

function sameLocator(left: ExecutionExternalHandleRecord, right: ExternalDurableHandle): boolean {
  return JSON.stringify(left.locator) === JSON.stringify(locatorWithoutSource(right));
}

async function buildIdentity(
  input: PersistExternalToolObservationInput,
  digest: (value: string) => Promise<string>,
): Promise<ObservationIdentity> {
  const locator = locatorWithoutSource(input.handle);
  const checkedDigest = async (value: string): Promise<string> => {
    const result = (await digest(value)).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(result)) {
      throw new Error('execution_journal_external_observation_invalid_digest');
    }
    return result;
  };
  const [locatorDigest, toolNameDigest, requestDigest, resultDigest, modelDigest] =
    await Promise.all([
      checkedDigest(JSON.stringify([DIGEST_FORMAT, 'locator', locator])),
      checkedDigest(JSON.stringify([DIGEST_FORMAT, 'tool', input.toolName])),
      checkedDigest(input.argumentsText),
      checkedDigest(input.resultText),
      checkedDigest(JSON.stringify([DIGEST_FORMAT, 'external_reconciliation'])),
    ]);
  const [runCreatedDigest, beforeEffectDigest, currentStateDigest] = await Promise.all([
    checkedDigest(JSON.stringify([DIGEST_FORMAT, locatorDigest, 'run_created'])),
    checkedDigest(JSON.stringify([DIGEST_FORMAT, locatorDigest, 'before_effect'])),
    checkedDigest(
      JSON.stringify([
        DIGEST_FORMAT,
        locatorDigest,
        terminalRunStatus(input.observedStatus) ? 'terminal' : 'waiting_external',
        input.observedStatus,
        resultDigest,
      ]),
    ),
  ]);
  const suffix = locatorDigest.slice(0, 48);
  return {
    locatorDigest,
    toolNameDigest,
    requestDigest,
    resultDigest,
    modelDigest,
    runCreatedDigest,
    beforeEffectDigest,
    currentStateDigest,
    runId: `external-${suffix}`,
    effectId: `external-effect-${suffix}`,
    handleId: `external-handle-${suffix}`,
    monitorId: `external-monitor-${suffix}`,
    runCreatedCheckpointId: `external-created-${suffix}`,
    beforeEffectCheckpointId: `external-before-${suffix}`,
    currentCheckpointId: `external-current-${suffix}`,
  };
}

function buildInitialRecords(
  input: PersistExternalToolObservationInput,
  identity: ObservationIdentity,
): {
  run: ExecutionRunRecord;
  checkpoints: ExecutionCheckpointRecord[];
  effect: ExecutionEffectRecord;
  handle: ExecutionExternalHandleRecord;
  monitorId: string;
} {
  const terminalStatus = terminalRunStatus(input.observedStatus);
  const run = decodeExecutionRunRow(
    runRow({
      id: identity.runId,
      conversationId: input.conversationId,
      threadId: input.conversationId,
      taskId: input.parentAgentRunId ?? null,
      goalId: null,
      requestMessageId: input.toolCallId,
      durabilityClass: 'external_durable_operation',
      requestedCapability: 'monitor',
      executionSurface: 'external_api',
      status: terminalStatus ?? 'waiting',
      resumeStrategy: 'reconcile_first',
      approvalState: 'not_required',
      permissionState: 'granted',
      inputDigest: identity.requestDigest,
      modelConfigDigest: identity.modelDigest,
      retryCount: 0,
      nextRetryPolicy: 'monitor_only',
      controlEpoch: 0,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
      terminalAt: terminalStatus ? input.observedAt : null,
    }),
  );
  const checkpointBase = {
    runId: run.id,
    taskId: run.taskId,
    goalId: null,
    phase: 'work' as const,
    resumeStrategy: run.resumeStrategy,
    approvalState: run.approvalState,
    permissionState: run.permissionState,
    controlEpoch: 0,
    createdAt: input.observedAt,
  };
  const checkpoints = [
    decodeExecutionCheckpointRow(
      checkpointRow({
        ...checkpointBase,
        id: identity.runCreatedCheckpointId,
        sequence: 0,
        phase: 'system',
        boundary: 'run_created',
        stateRefId: identity.runCreatedCheckpointId,
        stateDigest: identity.runCreatedDigest,
      }),
    ),
    decodeExecutionCheckpointRow(
      checkpointRow({
        ...checkpointBase,
        id: identity.beforeEffectCheckpointId,
        sequence: 1,
        boundary: 'before_effect',
        stateRefId: identity.beforeEffectCheckpointId,
        stateDigest: identity.beforeEffectDigest,
      }),
    ),
    decodeExecutionCheckpointRow(
      checkpointRow({
        ...checkpointBase,
        id: identity.currentCheckpointId,
        sequence: 2,
        boundary: terminalStatus ? 'terminal' : 'waiting_external',
        stateRefId: identity.currentCheckpointId,
        stateDigest: identity.currentStateDigest,
      }),
    ),
  ];
  const effect = decodeExecutionEffectRow(
    effectRow({
      id: identity.effectId,
      runId: run.id,
      checkpointId: identity.beforeEffectCheckpointId,
      toolCallId: input.toolCallId,
      toolNameDigest: identity.toolNameDigest,
      toolContractIdentityDigest: null,
      effectClass: 'external_run',
      idempotencyClass: 'declared_idempotent',
      idempotencyKeyDigest: identity.locatorDigest,
      requestDigest: identity.requestDigest,
      modelAuthorityValidUntil: null,
      outcomeDigest: terminalStatus ? identity.resultDigest : null,
      status: terminalStatus ? 'verified' : 'started',
      retryPolicy: 'reconcile_before_retry',
      attempt: 1,
      createdAt: input.observedAt,
      startedAt: input.observedAt,
      completedAt: terminalStatus ? input.observedAt : null,
      updatedAt: input.observedAt,
    }),
  );
  const handle = decodeExecutionExternalHandleRow(
    handleRow({
      id: identity.handleId,
      runId: run.id,
      effectId: effect.id,
      locator: locatorWithoutSource(input.handle),
      sourceToolNameDigest: identity.toolNameDigest,
      status: input.observedStatus,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
      lastAttemptedAt: input.observedAt,
      lastVerifiedAt: input.observedStatus === 'unknown' ? null : input.observedAt,
    }),
  );
  return { run, checkpoints, effect, handle, monitorId: identity.monitorId };
}

function insertEffect(database: SQLite.SQLiteDatabase, effect: ExecutionEffectRecord): void {
  database.runSync(
    `INSERT INTO execution_effects (
       id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
       tool_contract_identity_digest, effect_class,
       idempotency_class, idempotency_key_digest, request_digest,
       model_authority_valid_until, outcome_digest,
       status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(effectRow(effect)),
  );
}

function insertHandle(
  database: SQLite.SQLiteDatabase,
  handle: ExecutionExternalHandleRecord,
): void {
  database.runSync(
    `INSERT INTO execution_external_handles (
       id, run_id, effect_id, handle_kind, locator_version, expo_project_id,
       github_repository, workflow_run_id, credential_ref, source_tool_name_digest,
       status, created_at, updated_at, last_attempted_at, last_verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(handleRow(handle)),
  );
}

function insertInitialObservation(
  database: SQLite.SQLiteDatabase,
  records: ReturnType<typeof buildInitialRecords>,
): void {
  insertRun(database, records.run);
  database.runSync(
    `INSERT INTO execution_recovery_controls (run_id, cancellation_state, updated_at)
     VALUES (?, ?, ?)`,
    records.run.id,
    records.run.status === 'cancelled' ? 'cancelled' : 'active',
    records.run.updatedAt,
  );
  for (const checkpoint of records.checkpoints) insertCheckpoint(database, checkpoint);
  insertEffect(database, records.effect);
  insertHandle(database, records.handle);
  insertExternalHandleMonitor(database, {
    id: records.monitorId,
    handle: records.handle,
  });
}

function settleEffect(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  effectId: string,
  outcomeDigest: string,
  occurredAt: number,
): void {
  let effect = readEffect(database, run.id, effectId);
  if (effect.status === 'started' || effect.status === 'ambiguous') {
    if (!canTransitionExecutionEffect(effect.status, 'applied')) {
      throw new Error('execution_journal_external_observation_effect_conflict');
    }
    database.runSync(
      `UPDATE execution_effects
       SET status = 'applied', outcome_digest = ?, completed_at = ?, updated_at = ?
       WHERE run_id = ? AND id = ? AND status = ?`,
      outcomeDigest,
      effect.completedAt ?? occurredAt,
      occurredAt,
      run.id,
      effect.id,
      effect.status,
    );
    effect = readEffect(database, run.id, effectId);
  }
  if (effect.status === 'applied') {
    if (!canTransitionExecutionEffect('applied', 'verified')) {
      throw new Error('execution_journal_external_observation_effect_conflict');
    }
    const result = database.runSync(
      `UPDATE execution_effects SET status = 'verified', outcome_digest = ?, updated_at = ?
       WHERE run_id = ? AND id = ? AND status = 'applied'`,
      outcomeDigest,
      occurredAt,
      run.id,
      effect.id,
    );
    if (result.changes !== 1) {
      throw new Error('execution_journal_external_observation_effect_conflict');
    }
  } else if (effect.status !== 'verified') {
    throw new Error('execution_journal_external_observation_effect_conflict');
  }
}

function appendTerminalCheckpoint(
  database: SQLite.SQLiteDatabase,
  run: ExecutionRunRecord,
  identity: ObservationIdentity,
  occurredAt: number,
): void {
  const latest = database.getFirstSync<{ sequence: number }>(
    `SELECT sequence FROM execution_checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
    run.id,
  );
  if (!latest || !Number.isSafeInteger(latest.sequence)) {
    throw new Error('execution_journal_external_observation_history_missing');
  }
  insertCheckpoint(
    database,
    decodeExecutionCheckpointRow(
      checkpointRow({
        id: `external-terminal-${identity.locatorDigest.slice(0, 48)}`,
        runId: run.id,
        sequence: latest.sequence + 1,
        taskId: run.taskId,
        goalId: run.goalId,
        phase: 'work',
        boundary: 'terminal',
        stateRefId: `external-terminal-${identity.locatorDigest.slice(0, 48)}`,
        stateDigest: identity.currentStateDigest,
        resumeStrategy: run.resumeStrategy,
        approvalState: run.approvalState,
        permissionState: run.permissionState,
        controlEpoch: run.controlEpoch,
        createdAt: occurredAt,
      }),
    ),
  );
}

function advanceExistingObservation(
  database: SQLite.SQLiteDatabase,
  input: PersistExternalToolObservationInput,
  identity: ObservationIdentity,
): PersistExternalToolObservationResult {
  const run = readRun(database, identity.runId);
  const handle = readHandle(database, run.id, identity.handleId);
  if (
    run.durabilityClass !== 'external_durable_operation' ||
    handle.effectId !== identity.effectId ||
    !sameLocator(handle, input.handle)
  ) {
    throw new Error('execution_journal_external_observation_identity_conflict');
  }
  if (run.conversationId !== input.conversationId || run.threadId !== input.conversationId) {
    throw new Error('execution_journal_external_observation_ownership_conflict');
  }
  const currentTerminal = terminalRunStatus(handle.status);
  const nextTerminal = terminalRunStatus(input.observedStatus);
  if (currentTerminal) {
    if (nextTerminal && nextTerminal !== currentTerminal) {
      throw new Error('execution_journal_external_observation_terminal_conflict');
    }
    return {
      kind: 'already_terminal',
      runId: run.id,
      handleId: handle.id,
      status: handle.status,
      terminal: true,
    };
  }
  if (
    handle.status === input.observedStatus ||
    input.observedStatus === 'unknown' ||
    !canTransitionExecutionExternalHandle(handle.status, input.observedStatus)
  ) {
    return {
      kind: 'unchanged',
      runId: run.id,
      handleId: handle.id,
      status: handle.status,
      terminal: false,
    };
  }

  const occurredAt = Math.max(input.observedAt, run.updatedAt + 1);
  if (!validTimestamp(occurredAt)) {
    throw new Error('execution_journal_external_observation_clock_exhausted');
  }
  const handleResult = database.runSync(
    `UPDATE execution_external_handles
     SET status = ?, updated_at = ?, last_attempted_at = ?, last_verified_at = ?
     WHERE run_id = ? AND id = ? AND status = ? AND updated_at = ?`,
    input.observedStatus,
    occurredAt,
    occurredAt,
    occurredAt,
    run.id,
    handle.id,
    handle.status,
    handle.updatedAt,
  );
  if (handleResult.changes !== 1) {
    throw new Error('execution_journal_external_observation_concurrent_handle');
  }
  advanceExternalHandleMonitor(database, {
    runId: run.id,
    externalHandleId: handle.id,
    observedStatus: input.observedStatus,
    outcome: nextTerminal ? 'acted' : 'pending',
    nextLegalCheckAt: nextTerminal ? null : occurredAt,
    occurredAt,
  });

  if (nextTerminal) {
    settleEffect(database, run, identity.effectId, identity.resultDigest, occurredAt);
    appendTerminalCheckpoint(database, run, identity, occurredAt);
    if (!canTransitionExecutionRun(run.status, nextTerminal)) {
      throw new Error('execution_journal_external_observation_run_conflict');
    }
    const runResult = database.runSync(
      `UPDATE execution_runs SET status = ?, updated_at = ?, terminal_at = ?
       WHERE id = ? AND status = ? AND control_epoch = ? AND updated_at = ?`,
      nextTerminal,
      occurredAt,
      occurredAt,
      run.id,
      run.status,
      run.controlEpoch,
      run.updatedAt,
    );
    if (runResult.changes !== 1) {
      throw new Error('execution_journal_external_observation_concurrent_run');
    }
    if (nextTerminal === 'cancelled') {
      database.runSync(
        `UPDATE execution_recovery_controls SET cancellation_state = 'cancelled', updated_at = ?
         WHERE run_id = ? AND cancellation_state IN ('active', 'cancel_requested')`,
        occurredAt,
        run.id,
      );
    }
  } else {
    const runResult = database.runSync(
      `UPDATE execution_runs SET updated_at = ?
       WHERE id = ? AND status = ? AND control_epoch = ? AND updated_at = ?`,
      occurredAt,
      run.id,
      run.status,
      run.controlEpoch,
      run.updatedAt,
    );
    if (runResult.changes !== 1) {
      throw new Error('execution_journal_external_observation_concurrent_run');
    }
  }

  return {
    kind: 'advanced',
    runId: run.id,
    handleId: handle.id,
    status: input.observedStatus,
    terminal: Boolean(nextTerminal),
  };
}

/** Atomically materialize or advance one exact remotely durable workflow observation. */
export async function persistExternalToolObservation(
  input: PersistExternalToolObservationInput,
  options: ExternalToolObservationStoreOptions = {},
): Promise<PersistExternalToolObservationResult> {
  if (
    !input ||
    !validId(input.toolName) ||
    !validId(input.toolCallId) ||
    !validId(input.conversationId) ||
    (input.parentAgentRunId !== undefined && !validId(input.parentAgentRunId)) ||
    !validTimestamp(input.observedAt) ||
    !qualifyExternalDurableHandle(input.handle) ||
    input.handle.sourceToolName !== input.toolName
  ) {
    throw new Error('execution_journal_external_observation_invalid');
  }
  const digest = options.digest ?? sha256HexUtf8Async;
  const identity = await buildIdentity(input, digest);
  const database = (options.getDatabase ?? getExecutionJournalDb)();
  return withImmediateTransaction(database, () => {
    const existing = database.getFirstSync<{ id: string }>(
      'SELECT id FROM execution_runs WHERE id = ?',
      identity.runId,
    );
    if (existing) return advanceExistingObservation(database, input, identity);
    const records = buildInitialRecords(input, identity);
    insertInitialObservation(database, records);
    return {
      kind: 'created',
      runId: records.run.id,
      handleId: records.handle.id,
      status: records.handle.status,
      terminal: Boolean(terminalRunStatus(records.handle.status)),
    };
  });
}
