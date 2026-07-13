import type { getMemoryDb } from './database';
import type { FactRow } from './facts/types';
import type { MemoryFactLegacyQuarantineReason } from './factContributionAdmissionSchema';

type MemoryDb = ReturnType<typeof getMemoryDb>;
type SqlValue = string | number | null;

const MAX_STAGED_BINDINGS = 800;
const REJECTION_STAGE = 'temp_memory_fact_legacy_rejections';
const RETRIEVAL_STAGE = 'temp_memory_fact_legacy_retrieval_rewrites';
const REFLECTION_STAGE = 'temp_memory_fact_legacy_reflection_rewrites';
const RECEIPT_STAGE = 'temp_memory_fact_legacy_receipt_rewrites';
const RECEIPT_FACT_ID_COLUMNS = [
  'deterministic_fact_ids_json',
  'provider_fact_ids_json',
  'invalidated_fact_ids_json',
  'bridged_evidence_fact_ids_json',
  'agent_run_memory_fact_ids_json',
] as const;

interface RetrievalEventRow {
  id: string;
  selected_fact_ids_json: string;
}

interface ReflectionRow {
  id: string;
  source_fact_ids_json: string;
}

interface ReceiptRow {
  job_id: string;
  attempt_number: number;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  invalidated_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
}

export interface LegacyFactQuarantineEntry {
  row: FactRow;
  reason: MemoryFactLegacyQuarantineReason;
}

function stageRows(
  db: MemoryDb,
  table: string,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<SqlValue>>,
): void {
  const batchSize = Math.max(1, Math.floor(MAX_STAGED_BINDINGS / columns.length));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    db.runSync(`INSERT INTO ${table}(${columns.join(', ')}) VALUES ${values}`, ...batch.flat());
  }
}

function ensureEmptyWorkingStages(db: MemoryDb): void {
  db.execSync(`
    CREATE TEMP TABLE IF NOT EXISTS ${REJECTION_STAGE} (
      fact_id TEXT PRIMARY KEY,
      reason TEXT NOT NULL
    );
    CREATE TEMP TABLE IF NOT EXISTS ${RETRIEVAL_STAGE} (
      event_id TEXT PRIMARY KEY,
      selected_fact_ids_json TEXT NOT NULL,
      selected_fact_count INTEGER NOT NULL
    );
    CREATE TEMP TABLE IF NOT EXISTS ${REFLECTION_STAGE} (
      reflection_id TEXT PRIMARY KEY
    );
    CREATE TEMP TABLE IF NOT EXISTS ${RECEIPT_STAGE} (
      job_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      deterministic_fact_ids_json TEXT NOT NULL,
      provider_fact_ids_json TEXT NOT NULL,
      invalidated_fact_ids_json TEXT NOT NULL,
      bridged_evidence_fact_ids_json TEXT NOT NULL,
      agent_run_memory_fact_ids_json TEXT NOT NULL,
      PRIMARY KEY(job_id, attempt_number)
    );
    DELETE FROM ${REJECTION_STAGE};
    DELETE FROM ${RETRIEVAL_STAGE};
    DELETE FROM ${REFLECTION_STAGE};
    DELETE FROM ${RECEIPT_STAGE};
  `);
}

function clearWorkingStages(db: MemoryDb): void {
  db.execSync(`
    DELETE FROM ${REJECTION_STAGE};
    DELETE FROM ${RETRIEVAL_STAGE};
    DELETE FROM ${REFLECTION_STAGE};
    DELETE FROM ${RECEIPT_STAGE};
  `);
}

function withoutFactIds(
  raw: string,
  factIds: ReadonlySet<string>,
): { references: boolean; json: string; remainingCount: number } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
      return { references: true, json: '[]', remainingCount: 0 };
    }
    const filtered = parsed.filter((value) => !factIds.has(value));
    return {
      references: filtered.length !== parsed.length,
      json: JSON.stringify(filtered),
      remainingCount: filtered.length,
    };
  } catch {
    return { references: true, json: '[]', remainingCount: 0 };
  }
}

function persistQuarantinedFacts(
  db: MemoryDb,
  entries: ReadonlyArray<LegacyFactQuarantineEntry>,
  quarantinedAt: number,
): void {
  stageRows(
    db,
    REJECTION_STAGE,
    ['fact_id', 'reason'],
    entries.map(({ row, reason }) => [row.id, reason]),
  );
  db.runSync(
    `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
     SELECT fact_id, reason, ? FROM ${REJECTION_STAGE}`,
    quarantinedAt,
  );
  for (const table of ['memory_fact_terms', 'memory_fact_evidence', 'memory_fact_observations']) {
    db.runSync(`DELETE FROM ${table} WHERE fact_id IN (SELECT fact_id FROM ${REJECTION_STAGE})`);
  }
  db.runSync(
    `DELETE FROM memory_facts
      WHERE id IN (SELECT fact_id FROM ${REJECTION_STAGE})`,
  );
}

function scrubRetrievalEvents(db: MemoryDb, factIds: ReadonlySet<string>): void {
  const rewrites: SqlValue[][] = [];
  for (const row of db.getAllSync<RetrievalEventRow>(
    'SELECT id, selected_fact_ids_json FROM memory_retrieval_events',
  )) {
    const filtered = withoutFactIds(row.selected_fact_ids_json, factIds);
    if (!filtered.references) continue;
    rewrites.push([row.id, filtered.json, filtered.remainingCount]);
  }
  stageRows(
    db,
    RETRIEVAL_STAGE,
    ['event_id', 'selected_fact_ids_json', 'selected_fact_count'],
    rewrites,
  );
  db.runSync(
    `DELETE FROM memory_retrieval_outcomes
      WHERE retrieval_event_id IN (SELECT event_id FROM ${RETRIEVAL_STAGE})`,
  );
  db.runSync(
    `UPDATE memory_retrieval_events
        SET selected_fact_ids_json = (
              SELECT rewrite.selected_fact_ids_json FROM ${RETRIEVAL_STAGE} AS rewrite
               WHERE rewrite.event_id = memory_retrieval_events.id
            ),
            selected_fact_count = (
              SELECT rewrite.selected_fact_count FROM ${RETRIEVAL_STAGE} AS rewrite
               WHERE rewrite.event_id = memory_retrieval_events.id
            )
      WHERE id IN (SELECT event_id FROM ${RETRIEVAL_STAGE})`,
  );
}

function scrubReflections(db: MemoryDb, factIds: ReadonlySet<string>, quarantinedAt: number): void {
  const reflectionIds = db
    .getAllSync<ReflectionRow>(
      'SELECT id, source_fact_ids_json FROM memory_reflections WHERE deleted_at IS NULL',
    )
    .filter((row) => withoutFactIds(row.source_fact_ids_json, factIds).references)
    .map((row) => [row.id]);
  stageRows(db, REFLECTION_STAGE, ['reflection_id'], reflectionIds);
  db.runSync(
    `UPDATE memory_reflections
        SET deleted_at = ?, updated_at = MAX(updated_at, ?)
      WHERE id IN (SELECT reflection_id FROM ${REFLECTION_STAGE}) AND deleted_at IS NULL`,
    quarantinedAt,
    quarantinedAt,
  );
}

function scrubReceipts(db: MemoryDb, factIds: ReadonlySet<string>): void {
  const rewrites: SqlValue[][] = [];
  for (const row of db.getAllSync<ReceiptRow>('SELECT * FROM memory_ingestion_receipts')) {
    const filtered = RECEIPT_FACT_ID_COLUMNS.map((column) => withoutFactIds(row[column], factIds));
    if (!filtered.some(({ references }) => references)) continue;
    rewrites.push([row.job_id, row.attempt_number, ...filtered.map(({ json }) => json)]);
  }
  stageRows(db, RECEIPT_STAGE, ['job_id', 'attempt_number', ...RECEIPT_FACT_ID_COLUMNS], rewrites);
  db.runSync(
    `UPDATE memory_ingestion_receipts
        SET deterministic_fact_ids_json = (
              SELECT rewrite.deterministic_fact_ids_json FROM ${RECEIPT_STAGE} AS rewrite
               WHERE rewrite.job_id = memory_ingestion_receipts.job_id
                 AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
            ),
            provider_fact_ids_json = (
              SELECT rewrite.provider_fact_ids_json FROM ${RECEIPT_STAGE} AS rewrite
               WHERE rewrite.job_id = memory_ingestion_receipts.job_id
                 AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
            ),
            invalidated_fact_ids_json = (
              SELECT rewrite.invalidated_fact_ids_json FROM ${RECEIPT_STAGE} AS rewrite
               WHERE rewrite.job_id = memory_ingestion_receipts.job_id
                 AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
            ),
            bridged_evidence_fact_ids_json = (
              SELECT rewrite.bridged_evidence_fact_ids_json FROM ${RECEIPT_STAGE} AS rewrite
               WHERE rewrite.job_id = memory_ingestion_receipts.job_id
                 AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
            ),
            agent_run_memory_fact_ids_json = (
              SELECT rewrite.agent_run_memory_fact_ids_json FROM ${RECEIPT_STAGE} AS rewrite
               WHERE rewrite.job_id = memory_ingestion_receipts.job_id
                 AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
            )
      WHERE EXISTS (
        SELECT 1 FROM ${RECEIPT_STAGE} AS rewrite
         WHERE rewrite.job_id = memory_ingestion_receipts.job_id
           AND rewrite.attempt_number = memory_ingestion_receipts.attempt_number
      )`,
  );
}

/** Quarantine rejected rows with bounded native crossings and one scan per history table. */
export function quarantineLegacyFacts(input: {
  db: MemoryDb;
  entries: ReadonlyArray<LegacyFactQuarantineEntry>;
  quarantinedAt: number;
}): void {
  if (input.entries.length === 0) return;
  ensureEmptyWorkingStages(input.db);
  const factIds = new Set(input.entries.map(({ row }) => row.id));
  persistQuarantinedFacts(input.db, input.entries, input.quarantinedAt);
  scrubRetrievalEvents(input.db, factIds);
  scrubReflections(input.db, factIds, input.quarantinedAt);
  scrubReceipts(input.db, factIds);
  input.db.runSync(
    `DELETE FROM memory_working_blocks
      WHERE label IN ('active_focus', 'open_threads', 'compaction_summary')`,
  );
  clearWorkingStages(input.db);
}
