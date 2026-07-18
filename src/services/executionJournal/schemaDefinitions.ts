import {
  EXECUTION_APPROVAL_STATES,
  EXECUTION_CAPABILITIES,
  EXECUTION_CHECKPOINT_BOUNDARIES,
  EXECUTION_CHECKPOINT_PHASES,
  EXECUTION_DURABILITY_CLASSES,
  EXECUTION_EXTERNAL_HANDLE_KINDS,
  EXECUTION_EXTERNAL_HANDLE_STATUSES,
  EXECUTION_MONITOR_ACTIONS,
  EXECUTION_MONITOR_CONDITIONS,
  EXECUTION_MONITOR_STATES,
  EXECUTION_RESUME_STRATEGIES,
  EXECUTION_RETRY_POLICIES,
  EXECUTION_RUN_STATUSES,
  EXECUTION_SURFACES,
  RETENTION_DELETABLE_RUN_STATUSES,
} from './types';
import {
  DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS,
  EXECUTION_RECOVERY_ATTENTION_REASONS,
  EXECUTION_RECOVERY_AUTHORITY_STATES,
  EXECUTION_RECOVERY_CANCELLATION_STATES,
  EXECUTION_RECOVERY_DISPATCH_STATES,
  EXECUTION_RECOVERY_RECEIPT_REASONS,
} from './recoveryCoordinatorTypes';
import {
  CREATE_EXECUTION_EFFECTS,
  CREATE_EXECUTION_EFFECTS_V7,
  CREATE_EXECUTION_EFFECTS_V8,
} from './executionEffectSchema';
import {
  CREATE_EXECUTION_EFFECT_RECEIPTS,
  CREATE_EXECUTION_EFFECT_RECEIPT_UPDATE_GUARD,
} from './effectReceiptSchema';

function sqlEnum(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

const ID_CHECK = (column: string) =>
  `length(${column}) BETWEEN 1 AND 200 AND ${column} = trim(${column})`;
const DIGEST_CHECK = (column: string) =>
  `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

const CREATE_EXECUTION_RUNS = `
  CREATE TABLE execution_runs (
    id TEXT PRIMARY KEY CHECK (${ID_CHECK('id')}),
    conversation_id TEXT NOT NULL CHECK (${ID_CHECK('conversation_id')}),
    thread_id TEXT NOT NULL CHECK (${ID_CHECK('thread_id')}),
    task_id TEXT CHECK (task_id IS NULL OR (${ID_CHECK('task_id')})),
    goal_id TEXT CHECK (goal_id IS NULL OR (${ID_CHECK('goal_id')})),
    request_message_id TEXT NOT NULL CHECK (${ID_CHECK('request_message_id')}),
    durability_class TEXT NOT NULL CHECK (durability_class IN (${sqlEnum(EXECUTION_DURABILITY_CLASSES)})),
    requested_capability TEXT NOT NULL CHECK (requested_capability IN (${sqlEnum(EXECUTION_CAPABILITIES)})),
    execution_surface TEXT NOT NULL CHECK (execution_surface IN (${sqlEnum(EXECUTION_SURFACES)})),
    status TEXT NOT NULL CHECK (status IN (${sqlEnum(EXECUTION_RUN_STATUSES)})),
    resume_strategy TEXT NOT NULL CHECK (resume_strategy IN (${sqlEnum(EXECUTION_RESUME_STRATEGIES)})),
    approval_state TEXT NOT NULL CHECK (approval_state IN (${sqlEnum(EXECUTION_APPROVAL_STATES)})),
    permission_state TEXT NOT NULL CHECK (permission_state IN (${sqlEnum(EXECUTION_APPROVAL_STATES)})),
    input_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('input_digest')}),
    model_config_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('model_config_digest')}),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_retry_policy TEXT NOT NULL CHECK (next_retry_policy IN (${sqlEnum(EXECUTION_RETRY_POLICIES)})),
    control_epoch INTEGER NOT NULL DEFAULT 0 CHECK (control_epoch >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    terminal_at INTEGER,
    CHECK (
      (status IN (${sqlEnum(RETENTION_DELETABLE_RUN_STATUSES)})
        AND terminal_at IS NOT NULL
        AND terminal_at >= created_at
        AND terminal_at <= updated_at)
      OR
      (status NOT IN (${sqlEnum(RETENTION_DELETABLE_RUN_STATUSES)}) AND terminal_at IS NULL)
    )
  ) STRICT
`;

const CREATE_EXECUTION_CHECKPOINTS = `
  CREATE TABLE execution_checkpoints (
    id TEXT PRIMARY KEY CHECK (${ID_CHECK('id')}),
    run_id TEXT NOT NULL CHECK (${ID_CHECK('run_id')}),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    task_id TEXT CHECK (task_id IS NULL OR (${ID_CHECK('task_id')})),
    goal_id TEXT CHECK (goal_id IS NULL OR (${ID_CHECK('goal_id')})),
    phase TEXT NOT NULL CHECK (phase IN (${sqlEnum(EXECUTION_CHECKPOINT_PHASES)})),
    boundary TEXT NOT NULL CHECK (boundary IN (${sqlEnum(EXECUTION_CHECKPOINT_BOUNDARIES)})),
    state_ref_id TEXT NOT NULL CHECK (${ID_CHECK('state_ref_id')}),
    state_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('state_digest')}),
    resume_strategy TEXT NOT NULL CHECK (resume_strategy IN (${sqlEnum(EXECUTION_RESUME_STRATEGIES)})),
    approval_state TEXT NOT NULL CHECK (approval_state IN (${sqlEnum(EXECUTION_APPROVAL_STATES)})),
    permission_state TEXT NOT NULL CHECK (permission_state IN (${sqlEnum(EXECUTION_APPROVAL_STATES)})),
    control_epoch INTEGER NOT NULL CHECK (control_epoch >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    UNIQUE (run_id, sequence),
    UNIQUE (run_id, id),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
  ) STRICT
`;

const V10_EXECUTION_EXTERNAL_HANDLE_KINDS = ['expo_workflow_run', 'github_workflow_run'] as const;

export const CREATE_EXECUTION_EXTERNAL_HANDLES_V10 = `
  CREATE TABLE execution_external_handles (
    id TEXT PRIMARY KEY CHECK (${ID_CHECK('id')}),
    run_id TEXT NOT NULL CHECK (${ID_CHECK('run_id')}),
    effect_id TEXT NOT NULL CHECK (${ID_CHECK('effect_id')}),
    handle_kind TEXT NOT NULL CHECK (handle_kind IN (${sqlEnum(V10_EXECUTION_EXTERNAL_HANDLE_KINDS)})),
    locator_version INTEGER NOT NULL CHECK (locator_version = 1),
    expo_project_id TEXT CHECK (expo_project_id IS NULL OR (${ID_CHECK('expo_project_id')})),
    github_repository TEXT CHECK (github_repository IS NULL OR (${ID_CHECK('github_repository')})),
    workflow_run_id TEXT NOT NULL CHECK (${ID_CHECK('workflow_run_id')}),
    credential_ref TEXT NOT NULL CHECK (${ID_CHECK('credential_ref')}),
    source_tool_name_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('source_tool_name_digest')}),
    status TEXT NOT NULL CHECK (status IN (${sqlEnum(EXECUTION_EXTERNAL_HANDLE_STATUSES)})),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    last_attempted_at INTEGER NOT NULL CHECK (
      last_attempted_at >= created_at AND last_attempted_at <= updated_at
    ),
    last_verified_at INTEGER CHECK (
      last_verified_at IS NULL
      OR (last_verified_at >= created_at AND last_verified_at <= updated_at)
    ),
    CHECK (
      (handle_kind = 'expo_workflow_run'
        AND expo_project_id IS NOT NULL
        AND github_repository IS NULL)
      OR
      (handle_kind = 'github_workflow_run'
        AND expo_project_id IS NULL
        AND github_repository IS NOT NULL
        AND github_repository = lower(github_repository))
    ),
    UNIQUE (run_id, id),
    FOREIGN KEY (run_id, effect_id)
      REFERENCES execution_effects(run_id, id) ON DELETE CASCADE
  ) STRICT
`;

export const CREATE_EXECUTION_EXTERNAL_HANDLES = `
  CREATE TABLE execution_external_handles (
    id TEXT PRIMARY KEY CHECK (${ID_CHECK('id')}),
    run_id TEXT NOT NULL CHECK (${ID_CHECK('run_id')}),
    effect_id TEXT NOT NULL CHECK (${ID_CHECK('effect_id')}),
    handle_kind TEXT NOT NULL CHECK (handle_kind IN (${sqlEnum(EXECUTION_EXTERNAL_HANDLE_KINDS)})),
    locator_version INTEGER NOT NULL CHECK (locator_version = 1),
    locator_json TEXT NOT NULL CHECK (length(locator_json) BETWEEN 2 AND 8192),
    source_tool_name_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('source_tool_name_digest')}),
    status TEXT NOT NULL CHECK (status IN (${sqlEnum(EXECUTION_EXTERNAL_HANDLE_STATUSES)})),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    last_attempted_at INTEGER NOT NULL CHECK (
      last_attempted_at >= created_at AND last_attempted_at <= updated_at
    ),
    last_verified_at INTEGER CHECK (
      last_verified_at IS NULL
      OR (last_verified_at >= created_at AND last_verified_at <= updated_at)
    ),
    UNIQUE (run_id, id),
    FOREIGN KEY (run_id, effect_id)
      REFERENCES execution_effects(run_id, id) ON DELETE CASCADE
  ) STRICT
`;

const CREATE_EXECUTION_MONITORS = `
  CREATE TABLE execution_monitors (
    id TEXT PRIMARY KEY CHECK (${ID_CHECK('id')}),
    run_id TEXT NOT NULL CHECK (${ID_CHECK('run_id')}),
    external_handle_id TEXT NOT NULL CHECK (${ID_CHECK('external_handle_id')}),
    baseline_status TEXT NOT NULL CHECK (
      baseline_status IN (${sqlEnum(EXECUTION_EXTERNAL_HANDLE_STATUSES)})
    ),
    condition_kind TEXT NOT NULL CHECK (
      condition_kind IN (${sqlEnum(EXECUTION_MONITOR_CONDITIONS)})
    ),
    action_kind TEXT NOT NULL CHECK (
      action_kind IN (${sqlEnum(EXECUTION_MONITOR_ACTIONS)})
    ),
    state TEXT NOT NULL CHECK (state IN (${sqlEnum(EXECUTION_MONITOR_STATES)})),
    next_legal_check_at INTEGER CHECK (
      next_legal_check_at IS NULL OR next_legal_check_at >= updated_at
    ),
    last_observed_status TEXT NOT NULL CHECK (
      last_observed_status IN (${sqlEnum(EXECUTION_EXTERNAL_HANDLE_STATUSES)})
    ),
    observation_count INTEGER NOT NULL CHECK (observation_count >= 1),
    last_observed_at INTEGER NOT NULL CHECK (
      last_observed_at >= created_at AND last_observed_at <= updated_at
    ),
    condition_met_at INTEGER CHECK (
      condition_met_at IS NULL
      OR (condition_met_at >= last_observed_at AND condition_met_at <= updated_at)
    ),
    acted_at INTEGER CHECK (
      acted_at IS NULL
      OR (condition_met_at IS NOT NULL AND acted_at >= condition_met_at AND acted_at <= updated_at)
    ),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
      (state = 'armed'
        AND next_legal_check_at IS NOT NULL
        AND condition_met_at IS NULL
        AND acted_at IS NULL)
      OR
      (state = 'acted'
        AND next_legal_check_at IS NULL
        AND condition_met_at IS NOT NULL
        AND acted_at IS NOT NULL
        AND last_observed_status IN ('succeeded', 'failed', 'cancelled'))
      OR
      (state = 'blocked'
        AND next_legal_check_at IS NULL
        AND condition_met_at IS NULL
        AND acted_at IS NULL)
    ),
    UNIQUE (run_id, external_handle_id),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, external_handle_id)
      REFERENCES execution_external_handles(run_id, id) ON DELETE CASCADE
  ) STRICT
`;

const CREATE_EXECUTION_RECOVERY_CONTROLS = `
  CREATE TABLE execution_recovery_controls (
    run_id TEXT PRIMARY KEY CHECK (${ID_CHECK('run_id')}),
    cancellation_state TEXT NOT NULL CHECK (
      cancellation_state IN (${sqlEnum(EXECUTION_RECOVERY_CANCELLATION_STATES)})
    ),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
  ) STRICT
`;

const CREATE_EXECUTION_RECOVERY_ATTENTION = `
  CREATE TABLE execution_recovery_attention (
    run_id TEXT PRIMARY KEY CHECK (${ID_CHECK('run_id')}),
    control_epoch INTEGER NOT NULL CHECK (control_epoch >= 0),
    source_generation_updated_at INTEGER NOT NULL CHECK (source_generation_updated_at >= 0),
    reason TEXT NOT NULL CHECK (
      reason IN (${sqlEnum(EXECUTION_RECOVERY_ATTENTION_REASONS)})
    ),
    created_at INTEGER NOT NULL CHECK (created_at > source_generation_updated_at),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
  ) STRICT
`;

const CREATE_EXECUTION_RECOVERY_DISPATCHES = `
  CREATE TABLE execution_recovery_dispatches (
    dispatch_id TEXT PRIMARY KEY CHECK (${ID_CHECK('dispatch_id')}),
    run_id TEXT NOT NULL CHECK (${ID_CHECK('run_id')}),
    control_epoch INTEGER NOT NULL CHECK (control_epoch >= 0),
    snapshot_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('snapshot_digest')}),
    command_kind TEXT NOT NULL CHECK (
      command_kind IN (${sqlEnum(DISPATCHABLE_EXECUTION_RECOVERY_COMMAND_KINDS)})
    ),
    command_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('command_digest')}),
    cancellation_state TEXT NOT NULL CHECK (
      cancellation_state IN (${sqlEnum(EXECUTION_RECOVERY_CANCELLATION_STATES)})
    ),
    execution_authority TEXT NOT NULL CHECK (
      execution_authority IN (${sqlEnum(EXECUTION_RECOVERY_AUTHORITY_STATES)})
    ),
    authority_digest TEXT NOT NULL CHECK (${DIGEST_CHECK('authority_digest')}),
    dispatch_digest TEXT NOT NULL UNIQUE CHECK (${DIGEST_CHECK('dispatch_digest')}),
    fence_id TEXT NOT NULL UNIQUE CHECK (${ID_CHECK('fence_id')}),
    fence_digest TEXT NOT NULL UNIQUE CHECK (${DIGEST_CHECK('fence_digest')}),
    fence_expires_at INTEGER NOT NULL CHECK (fence_expires_at >= 0),
    state TEXT NOT NULL CHECK (state IN (${sqlEnum(EXECUTION_RECOVERY_DISPATCH_STATES)})),
    receipt_id TEXT UNIQUE CHECK (receipt_id IS NULL OR (${ID_CHECK('receipt_id')})),
    receipt_digest TEXT CHECK (receipt_digest IS NULL OR (${DIGEST_CHECK('receipt_digest')})),
    outcome_reason TEXT CHECK (
      outcome_reason IS NULL OR outcome_reason IN (${sqlEnum(EXECUTION_RECOVERY_RECEIPT_REASONS)})
    ),
    retry_at INTEGER CHECK (retry_at IS NULL OR retry_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (fence_expires_at >= created_at),
    CHECK (
      (state IN ('acquired', 'claimed')
        AND receipt_id IS NULL
        AND receipt_digest IS NULL
        AND outcome_reason IS NULL
        AND retry_at IS NULL)
      OR
      (state = 'completed'
        AND receipt_id IS NOT NULL
        AND receipt_digest IS NOT NULL
        AND outcome_reason IS NULL
        AND retry_at IS NULL)
      OR
      (state = 'pending'
        AND receipt_id IS NOT NULL
        AND receipt_digest IS NOT NULL
        AND outcome_reason IS NOT NULL
        AND retry_at IS NOT NULL
        AND retry_at > updated_at)
      OR
      (state = 'blocked'
        AND receipt_id IS NOT NULL
        AND receipt_digest IS NOT NULL
        AND outcome_reason IS NOT NULL
        AND retry_at IS NULL)
    ),
    UNIQUE (run_id, control_epoch, snapshot_digest, command_digest),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE
  ) STRICT
`;

export const SCHEMA_OBJECT_SQL = new Map<string, string>([
  ['execution_runs', CREATE_EXECUTION_RUNS],
  ['execution_checkpoints', CREATE_EXECUTION_CHECKPOINTS],
  ['execution_effects', CREATE_EXECUTION_EFFECTS],
  ['execution_effect_receipts', CREATE_EXECUTION_EFFECT_RECEIPTS],
  ['execution_external_handles', CREATE_EXECUTION_EXTERNAL_HANDLES],
  ['execution_monitors', CREATE_EXECUTION_MONITORS],
  ['execution_recovery_controls', CREATE_EXECUTION_RECOVERY_CONTROLS],
  ['execution_recovery_attention', CREATE_EXECUTION_RECOVERY_ATTENTION],
  ['execution_recovery_dispatches', CREATE_EXECUTION_RECOVERY_DISPATCHES],
  [
    'trg_execution_runs_protect_unresolved_delete',
    `CREATE TRIGGER trg_execution_runs_protect_unresolved_delete
       BEFORE DELETE ON execution_runs
       WHEN OLD.status NOT IN (${sqlEnum(RETENTION_DELETABLE_RUN_STATUSES)})
       BEGIN
         SELECT RAISE(ABORT, 'execution_journal_protected_run');
       END`,
  ],
  [
    'trg_execution_recovery_dispatches_protect_receipt',
    `CREATE TRIGGER trg_execution_recovery_dispatches_protect_receipt
       BEFORE UPDATE ON execution_recovery_dispatches
       WHEN OLD.state IN ('completed', 'pending', 'blocked')
       BEGIN
         SELECT RAISE(ABORT, 'execution_recovery_receipt_immutable');
       END`,
  ],
  ['trg_execution_effect_receipts_immutable', CREATE_EXECUTION_EFFECT_RECEIPT_UPDATE_GUARD],
  [
    'idx_execution_runs_status_updated',
    `CREATE INDEX idx_execution_runs_status_updated
       ON execution_runs(status, updated_at, id)`,
  ],
  [
    'idx_execution_runs_owner_durability',
    `CREATE INDEX idx_execution_runs_owner_durability
       ON execution_runs(conversation_id, task_id, durability_class, id)`,
  ],
  [
    'idx_execution_checkpoints_run_sequence',
    `CREATE INDEX idx_execution_checkpoints_run_sequence
       ON execution_checkpoints(run_id, sequence)`,
  ],
  [
    'idx_execution_effects_run_status',
    `CREATE INDEX idx_execution_effects_run_status
       ON execution_effects(run_id, status, updated_at)`,
  ],
  [
    'idx_execution_effects_status_run',
    `CREATE INDEX idx_execution_effects_status_run
       ON execution_effects(status, run_id)`,
  ],
  [
    'ux_execution_effects_idempotency_key',
    `CREATE UNIQUE INDEX ux_execution_effects_idempotency_key
       ON execution_effects(run_id, idempotency_key_digest)
       WHERE idempotency_key_digest IS NOT NULL`,
  ],
  [
    'ux_execution_external_handles_locator',
    `CREATE UNIQUE INDEX ux_execution_external_handles_locator
       ON execution_external_handles(run_id, handle_kind, locator_json)`,
  ],
  [
    'ux_execution_external_handles_unresolved_mobile_run',
    `CREATE UNIQUE INDEX ux_execution_external_handles_unresolved_mobile_run
       ON execution_external_handles(run_id)
       WHERE handle_kind = 'mobile_controller_handoff'
         AND status IN ('unknown', 'pending', 'running')`,
  ],
  [
    'idx_execution_external_handles_status_run',
    `CREATE INDEX idx_execution_external_handles_status_run
       ON execution_external_handles(status, run_id)`,
  ],
  [
    'idx_execution_recovery_dispatches_run_state',
    `CREATE INDEX idx_execution_recovery_dispatches_run_state
       ON execution_recovery_dispatches(run_id, state, updated_at, dispatch_id)`,
  ],
  [
    'idx_execution_external_handles_run_status',
    `CREATE INDEX idx_execution_external_handles_run_status
       ON execution_external_handles(run_id, status, updated_at)`,
  ],
  [
    'idx_execution_monitors_state_next_check',
    `CREATE INDEX idx_execution_monitors_state_next_check
       ON execution_monitors(state, next_legal_check_at, run_id, id)`,
  ],
]);

export const V10_SCHEMA_OBJECT_SQL = new Map(SCHEMA_OBJECT_SQL);
V10_SCHEMA_OBJECT_SQL.set('execution_external_handles', CREATE_EXECUTION_EXTERNAL_HANDLES_V10);
V10_SCHEMA_OBJECT_SQL.delete('ux_execution_external_handles_locator');
V10_SCHEMA_OBJECT_SQL.delete('ux_execution_external_handles_unresolved_mobile_run');
V10_SCHEMA_OBJECT_SQL.set(
  'ux_execution_external_handles_expo_locator',
  `CREATE UNIQUE INDEX ux_execution_external_handles_expo_locator
     ON execution_external_handles(run_id, expo_project_id, workflow_run_id)
     WHERE handle_kind = 'expo_workflow_run'`,
);
V10_SCHEMA_OBJECT_SQL.set(
  'ux_execution_external_handles_github_locator',
  `CREATE UNIQUE INDEX ux_execution_external_handles_github_locator
     ON execution_external_handles(run_id, github_repository, workflow_run_id)
     WHERE handle_kind = 'github_workflow_run'`,
);

export const V9_SCHEMA_OBJECT_SQL = new Map(V10_SCHEMA_OBJECT_SQL);
V9_SCHEMA_OBJECT_SQL.delete('execution_effect_receipts');
V9_SCHEMA_OBJECT_SQL.delete('trg_execution_effect_receipts_immutable');

export const V7_SCHEMA_OBJECT_SQL = new Map(V9_SCHEMA_OBJECT_SQL);
V7_SCHEMA_OBJECT_SQL.set('execution_effects', CREATE_EXECUTION_EFFECTS_V7);

export const V8_SCHEMA_OBJECT_SQL = new Map(V9_SCHEMA_OBJECT_SQL);
V8_SCHEMA_OBJECT_SQL.set('execution_effects', CREATE_EXECUTION_EFFECTS_V8);

export const V9_TABLE_NAMES = [
  'execution_runs',
  'execution_checkpoints',
  'execution_effects',
  'execution_external_handles',
  'execution_monitors',
  'execution_recovery_controls',
  'execution_recovery_attention',
  'execution_recovery_dispatches',
] as const;

export const TABLE_NAMES = [...V9_TABLE_NAMES, 'execution_effect_receipts'] as const;

export const V9_TRIGGER_NAMES = [
  'trg_execution_runs_protect_unresolved_delete',
  'trg_execution_recovery_dispatches_protect_receipt',
] as const;

export const TRIGGER_NAMES = [
  ...V9_TRIGGER_NAMES,
  'trg_execution_effect_receipts_immutable',
] as const;
