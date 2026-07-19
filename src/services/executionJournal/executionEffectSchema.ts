import {
  EXECUTION_EFFECT_CLASSES,
  EXECUTION_EFFECT_STATUSES,
  EXECUTION_IDEMPOTENCY_CLASSES,
  EXECUTION_RETRY_POLICIES,
} from './types';

function sqlEnum(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

const EXECUTION_EFFECT_STATUSES_V11 = EXECUTION_EFFECT_STATUSES.filter(
  (status) => status !== 'returned',
);

const idCheck = (column: string): string =>
  `length(${column}) BETWEEN 1 AND 200 AND ${column} = trim(${column})`;
const digestCheck = (column: string): string =>
  `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const CREATE_EXECUTION_EFFECTS = `
  CREATE TABLE execution_effects (
    id TEXT PRIMARY KEY CHECK (${idCheck('id')}),
    run_id TEXT NOT NULL CHECK (${idCheck('run_id')}),
    checkpoint_id TEXT,
    tool_call_id TEXT NOT NULL CHECK (${idCheck('tool_call_id')}),
    tool_name_digest TEXT NOT NULL CHECK (${digestCheck('tool_name_digest')}),
    tool_contract_identity_digest TEXT CHECK (
      tool_contract_identity_digest IS NULL OR (${digestCheck('tool_contract_identity_digest')})
    ),
    effect_class TEXT NOT NULL CHECK (effect_class IN (${sqlEnum(EXECUTION_EFFECT_CLASSES)})),
    idempotency_class TEXT NOT NULL CHECK (idempotency_class IN (${sqlEnum(EXECUTION_IDEMPOTENCY_CLASSES)})),
    idempotency_key_digest TEXT CHECK (idempotency_key_digest IS NULL OR (${digestCheck('idempotency_key_digest')})),
    request_digest TEXT NOT NULL CHECK (${digestCheck('request_digest')}),
    model_authority_valid_until INTEGER CHECK (
      model_authority_valid_until IS NULL OR model_authority_valid_until >= 0
    ),
    outcome_digest TEXT CHECK (outcome_digest IS NULL OR (${digestCheck('outcome_digest')})),
    status TEXT NOT NULL CHECK (status IN (${sqlEnum(EXECUTION_EFFECT_STATUSES)})),
    retry_policy TEXT NOT NULL CHECK (retry_policy IN (${sqlEnum(EXECUTION_RETRY_POLICIES)})),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    started_at INTEGER CHECK (
      started_at IS NULL OR (started_at >= created_at AND started_at <= updated_at)
    ),
    completed_at INTEGER CHECK (
      completed_at IS NULL
      OR (started_at IS NOT NULL AND completed_at >= started_at AND completed_at <= updated_at)
    ),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
      (status = 'planned' AND started_at IS NULL AND completed_at IS NULL)
      OR (status = 'started' AND started_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'ambiguous' AND started_at IS NOT NULL)
      OR (status IN ('returned', 'applied', 'verified', 'failed', 'cancelled')
        AND started_at IS NOT NULL AND completed_at IS NOT NULL)
    ),
    UNIQUE (run_id, tool_call_id, attempt),
    UNIQUE (run_id, id),
    FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, checkpoint_id)
      REFERENCES execution_checkpoints(run_id, id) ON DELETE CASCADE
  ) STRICT
`;

export const CREATE_EXECUTION_EFFECTS_V11 = CREATE_EXECUTION_EFFECTS.replace(
  `status IN (${sqlEnum(EXECUTION_EFFECT_STATUSES)})`,
  `status IN (${sqlEnum(EXECUTION_EFFECT_STATUSES_V11)})`,
).replace(
  `status IN ('returned', 'applied', 'verified', 'failed', 'cancelled')`,
  `status IN ('applied', 'verified', 'failed', 'cancelled')`,
);

export const CREATE_EXECUTION_EFFECTS_V8 = CREATE_EXECUTION_EFFECTS_V11.replace(
  `    model_authority_valid_until INTEGER CHECK (
      model_authority_valid_until IS NULL OR model_authority_valid_until >= 0
    ),
`,
  '',
);

export const CREATE_EXECUTION_EFFECTS_V7 = CREATE_EXECUTION_EFFECTS_V8.replace(
  `    tool_contract_identity_digest TEXT CHECK (
      tool_contract_identity_digest IS NULL OR (${digestCheck('tool_contract_identity_digest')})
    ),
`,
  '',
);
