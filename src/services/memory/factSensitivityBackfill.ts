import { createLogger } from '../../utils/logger';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import {
  closedMemoryFactSensitivity,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { normalizeFactKind, type MemoryFactKind } from './facts/types';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  classifyMemoryFactSensitivity,
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from './memorySensitivityPolicy';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { advanceMemoryProjectionInTransaction } from './memoryAuthority';

const logger = createLogger('memory.factSensitivityBackfill');
const DEFAULT_BACKFILL_LIMIT = 16;
const MAXIMUM_BACKFILL_LIMIT = 64;

export const FACT_SENSITIVITY_BACKFILL_P95_BUDGET_MS = 100;

interface FactSensitivityBackfillRow {
  id: string;
  predicate: unknown;
  object_text: unknown;
  attributes: unknown;
  source_summary: unknown;
  memory_kind: unknown;
  sensitivity: unknown;
  subject_name: unknown;
  subject_type: unknown;
}

export interface FactSensitivityDiagnostics {
  policyVersion: typeof MEMORY_FACT_SENSITIVITY_POLICY_VERSION;
  localFactCount: number;
  currentPolicyFactCount: number;
  pendingPolicyFactCount: number;
  quarantinedFactCount: number;
}

export interface FactSensitivityBackfillResult {
  processedCount: number;
  pendingCount: number;
  hasMore: boolean;
  policyVersion: typeof MEMORY_FACT_SENSITIVITY_POLICY_VERSION;
}

function normalizeBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BACKFILL_LIMIT;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('memory_fact_sensitivity_backfill_limit_invalid');
  }
  return Math.min(Math.floor(value), MAXIMUM_BACKFILL_LIMIT);
}

function strictAttributes(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function strictMemoryKind(value: unknown): MemoryFactKind | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeFactKind(value);
  return normalized === value ? normalized : null;
}

function classifyBackfillRow(row: FactSensitivityBackfillRow): MemoryFactSensitivity {
  const attributes = strictAttributes(row.attributes);
  const memoryKind = strictMemoryKind(row.memory_kind);
  if (
    typeof row.predicate !== 'string' ||
    !row.predicate.trim() ||
    typeof row.object_text !== 'string' ||
    !row.object_text.trim() ||
    typeof row.subject_name !== 'string' ||
    !row.subject_name.trim() ||
    (row.source_summary !== null && typeof row.source_summary !== 'string') ||
    !attributes ||
    !memoryKind
  ) {
    return 'restricted';
  }
  return classifyMemoryFactSensitivity({
    // A pre-current-policy row has no sealed semantic declaration. Migration
    // therefore uses the most restrictive floor instead of guessing from
    // legacy prose or treating an old label as current authority.
    declaredSensitivity: 'restricted',
    subject: row.subject_name,
    predicate: row.predicate,
    objectText: row.object_text,
    attributes,
    sourceSummary: row.source_summary,
  });
}

function pendingCountForOwner(
  db: ReturnType<typeof getSchemaReadyMemoryDb>,
  memoryOwnerId: string,
): number {
  return Math.max(
    0,
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_facts
        WHERE memory_owner_id = ?
          AND sensitivity_policy_version < ?`,
      memoryOwnerId,
      MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    )?.count ?? 0,
  );
}

export function getFactSensitivityDiagnostics(): FactSensitivityDiagnostics {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const row = db.getFirstSync<{
    local_fact_count: number;
    current_policy_fact_count: number;
    pending_policy_fact_count: number;
    quarantined_fact_count: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN memory_owner_id = ? THEN 1 ELSE 0 END), 0)
         AS local_fact_count,
       COALESCE(SUM(CASE
         WHEN memory_owner_id = ? AND sensitivity_policy_version = ? THEN 1 ELSE 0 END), 0)
         AS current_policy_fact_count,
       COALESCE(SUM(CASE
         WHEN memory_owner_id = ? AND sensitivity_policy_version < ? THEN 1 ELSE 0 END), 0)
         AS pending_policy_fact_count,
       COALESCE(SUM(CASE
         WHEN memory_owner_id IS NULL
           OR memory_owner_id != ?
           OR typeof(sensitivity_policy_version) != 'integer'
           OR sensitivity_policy_version > ?
         THEN 1 ELSE 0 END), 0) AS quarantined_fact_count
       FROM memory_facts`,
    memoryOwnerId,
    memoryOwnerId,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    memoryOwnerId,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    memoryOwnerId,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
  );
  return {
    policyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    localFactCount: Math.max(0, row?.local_fact_count ?? 0),
    currentPolicyFactCount: Math.max(0, row?.current_policy_fact_count ?? 0),
    pendingPolicyFactCount: Math.max(0, row?.pending_policy_fact_count ?? 0),
    quarantinedFactCount: Math.max(0, row?.quarantined_fact_count ?? 0),
  };
}

export function backfillFactSensitivityPolicy(
  input: { limit?: number } = {},
): FactSensitivityBackfillResult {
  const limit = normalizeBackfillLimit(input.limit);
  return runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const candidates = db.getAllSync<FactSensitivityBackfillRow>(
      `SELECT fact.id, fact.predicate, fact.object_text, fact.attributes,
              fact.source_summary, fact.memory_kind, fact.sensitivity,
              subject.canonical_name AS subject_name, subject.type AS subject_type
         FROM memory_facts AS fact
         LEFT JOIN memory_entities AS subject ON subject.id = fact.subject_id
        WHERE fact.memory_owner_id = ?
          AND fact.sensitivity_policy_version < ?
        ORDER BY fact.created_at ASC, fact.id ASC
        LIMIT ${limit + 1}`,
      memoryOwnerId,
      MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    );
    const rows = candidates.slice(0, limit);
    let processedCount = 0;
    for (const row of rows) {
      const persisted = closedMemoryFactSensitivity(row.sensitivity) ?? 'restricted';
      const sensitivity = maxMemoryFactSensitivity(persisted, classifyBackfillRow(row));
      processedCount +=
        db.runSync(
          `UPDATE memory_facts
              SET sensitivity = ?, sensitivity_policy_version = ?
            WHERE id = ?
              AND memory_owner_id = ?
              AND sensitivity_policy_version < ?`,
          sensitivity,
          MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
          row.id,
          memoryOwnerId,
          MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
        ).changes ?? 0;
    }
    if (processedCount > 0) {
      advanceMemoryProjectionInTransaction(db, memoryOwnerId);
      runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
    }
    const pendingCount = pendingCountForOwner(db, memoryOwnerId);
    return {
      processedCount,
      pendingCount,
      hasMore: pendingCount > 0,
      policyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    } satisfies FactSensitivityBackfillResult;
  });
}

export function maintainFactSensitivityPolicy(
  input: { limit?: number } = {},
): FactSensitivityBackfillResult | null {
  try {
    return backfillFactSensitivityPolicy(input);
  } catch (error) {
    logger.devWarn(
      'Fact-sensitivity backfill failed; unclassified rows remain restricted.',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
