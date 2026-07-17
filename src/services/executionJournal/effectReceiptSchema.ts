function idCheck(column: string): string {
  return `length(${column}) BETWEEN 1 AND 200 AND ${column} = trim(${column})`;
}

function digestCheck(column: string): string {
  return `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}

/**
 * Content-free effect evidence. The raw tool result remains in the encrypted
 * conversation projection; this row is sufficient to prove what settled and
 * to suppress the same durable dispatch after restart.
 */
export const CREATE_EXECUTION_EFFECT_RECEIPTS = `
  CREATE TABLE execution_effect_receipts (
    receipt_id TEXT PRIMARY KEY CHECK (${idCheck('receipt_id')}),
    run_id TEXT NOT NULL CHECK (${idCheck('run_id')}),
    effect_id TEXT NOT NULL CHECK (${idCheck('effect_id')}),
    receipt_digest TEXT NOT NULL CHECK (${digestCheck('receipt_digest')}),
    receipt_json TEXT NOT NULL CHECK (
      length(receipt_json) BETWEEN 2 AND 32768 AND json_valid(receipt_json)
    ),
    recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
    persisted_at INTEGER NOT NULL CHECK (persisted_at >= recorded_at),
    UNIQUE (run_id, effect_id),
    FOREIGN KEY (run_id, effect_id)
      REFERENCES execution_effects(run_id, id) ON DELETE CASCADE
  ) STRICT
`;

export const CREATE_EXECUTION_EFFECT_RECEIPT_UPDATE_GUARD = `CREATE TRIGGER trg_execution_effect_receipts_immutable
       BEFORE UPDATE ON execution_effect_receipts
       BEGIN
         SELECT RAISE(ABORT, 'execution_effect_receipt_immutable');
       END`;
