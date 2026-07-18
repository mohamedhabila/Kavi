import type * as SQLite from 'expo-sqlite';

export const DIGEST_A = 'a'.repeat(64);
export const DIGEST_B = 'b'.repeat(64);
export const DIGEST_C = 'c'.repeat(64);
export const DIGEST_D = 'd'.repeat(64);

type RawRow = Record<string, string | number | null>;

export function insertSchemaRun(
  database: SQLite.SQLiteDatabase,
  overrides: Partial<RawRow> = {},
): RawRow {
  const row: RawRow = {
    id: 'run-1',
    conversation_id: 'conversation-1',
    thread_id: 'thread-1',
    task_id: null,
    goal_id: null,
    request_message_id: 'message-1',
    durability_class: 'foreground_interactive',
    requested_capability: 'read',
    execution_surface: 'builtin_tool',
    status: 'running',
    resume_strategy: 'not_resumable',
    approval_state: 'not_required',
    permission_state: 'not_required',
    input_digest: DIGEST_A,
    model_config_digest: DIGEST_B,
    retry_count: 0,
    next_retry_policy: 'none',
    control_epoch: 0,
    created_at: 10,
    updated_at: 10,
    terminal_at: null,
    ...overrides,
  };
  database.runSync(
    `INSERT INTO execution_runs (
       id, conversation_id, thread_id, task_id, goal_id, request_message_id,
       durability_class, requested_capability, execution_surface, status,
       resume_strategy, approval_state, permission_state, input_digest,
       model_config_digest, retry_count, next_retry_policy, control_epoch,
       created_at, updated_at, terminal_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(row),
  );
  return row;
}

export function insertSchemaCheckpoint(
  database: SQLite.SQLiteDatabase,
  overrides: Partial<RawRow> = {},
): RawRow {
  const row: RawRow = {
    id: 'checkpoint-1',
    run_id: 'run-1',
    sequence: 0,
    task_id: null,
    goal_id: null,
    phase: 'system',
    boundary: 'run_created',
    state_ref_id: 'state-1',
    state_digest: DIGEST_C,
    resume_strategy: 'not_resumable',
    approval_state: 'not_required',
    permission_state: 'not_required',
    control_epoch: 0,
    created_at: 10,
    ...overrides,
  };
  database.runSync(
    `INSERT INTO execution_checkpoints (
       id, run_id, sequence, task_id, goal_id, phase, boundary, state_ref_id,
       state_digest, resume_strategy, approval_state, permission_state,
       control_epoch, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(row),
  );
  return row;
}

export function insertSchemaEffect(
  database: SQLite.SQLiteDatabase,
  overrides: Partial<RawRow> = {},
): RawRow {
  const row: RawRow = {
    id: 'effect-1',
    run_id: 'run-1',
    checkpoint_id: 'checkpoint-1',
    tool_call_id: 'tool-call-1',
    tool_name_digest: DIGEST_A,
    tool_contract_identity_digest: null,
    effect_class: 'none',
    idempotency_class: 'effect_free',
    idempotency_key_digest: null,
    request_digest: DIGEST_B,
    outcome_digest: null,
    status: 'planned',
    retry_policy: 'none',
    attempt: 1,
    created_at: 10,
    started_at: null,
    completed_at: null,
    updated_at: 10,
    ...overrides,
  };
  database.runSync(
    `INSERT INTO execution_effects (
       id, run_id, checkpoint_id, tool_call_id, tool_name_digest,
       tool_contract_identity_digest, effect_class,
       idempotency_class, idempotency_key_digest, request_digest, outcome_digest,
       status, retry_policy, attempt, created_at, started_at, completed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(row),
  );
  return row;
}

export function insertSchemaHandle(
  database: SQLite.SQLiteDatabase,
  overrides: Partial<RawRow> = {},
): RawRow {
  const row: RawRow = {
    id: 'handle-1',
    run_id: 'run-1',
    effect_id: 'effect-1',
    handle_kind: 'expo_workflow_run',
    locator_version: 1,
    locator_json: JSON.stringify({
      version: 1,
      kind: 'expo_workflow_run',
      projectId: 'project-1',
      workflowRunId: 'workflow-run-1',
      credentialRef: 'EXPO_TOKEN',
    }),
    source_tool_name_digest: DIGEST_D,
    status: 'pending',
    created_at: 10,
    updated_at: 10,
    last_attempted_at: 10,
    last_verified_at: null,
    ...overrides,
  };
  database.runSync(
    `INSERT INTO execution_external_handles (
       id, run_id, effect_id, handle_kind, locator_version, locator_json,
       source_tool_name_digest, status, created_at, updated_at,
       last_attempted_at, last_verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(row),
  );
  return row;
}

export function insertSchemaMonitor(
  database: SQLite.SQLiteDatabase,
  overrides: Partial<RawRow> = {},
): RawRow {
  const row: RawRow = {
    id: 'monitor-1',
    run_id: 'run-1',
    external_handle_id: 'handle-1',
    baseline_status: 'pending',
    condition_kind: 'external_handle_terminal',
    action_kind: 'reconcile_external_handle',
    state: 'armed',
    next_legal_check_at: 10,
    last_observed_status: 'pending',
    observation_count: 1,
    last_observed_at: 10,
    condition_met_at: null,
    acted_at: null,
    created_at: 10,
    updated_at: 10,
    ...overrides,
  };
  database.runSync(
    `INSERT INTO execution_monitors (
       id, run_id, external_handle_id, baseline_status, condition_kind,
       action_kind, state, next_legal_check_at, last_observed_status,
       observation_count, last_observed_at, condition_met_at, acted_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...Object.values(row),
  );
  return row;
}

export function seedCompleteSchemaRun(database: SQLite.SQLiteDatabase): void {
  insertSchemaRun(database);
  insertSchemaCheckpoint(database);
  insertSchemaEffect(database);
  insertSchemaHandle(database);
  insertSchemaMonitor(database);
}
