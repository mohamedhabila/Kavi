import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import type { IngestionJobStatus, IngestionProviderOutcome } from './ingestionQueueStore';

const ALL_INGESTION_STATUSES: ReadonlyArray<IngestionJobStatus> = [
  'pending',
  'processing',
  'retrying',
  'degraded',
  'completed_structural',
  'completed_enriched',
  'failed',
];

const ALL_PROVIDER_OUTCOMES: ReadonlyArray<IngestionProviderOutcome> = [
  'structural_only',
  'valid',
  'empty_valid',
  'malformed',
  'schema_invalid',
  'provider_error',
];

export interface IngestionQueueDiagnostics {
  total: number;
  byStatus: Record<IngestionJobStatus, number>;
  byProviderOutcome: Record<IngestionProviderOutcome, number>;
  dueRetryCount: number;
  staleProcessingCount: number;
}

export function getIngestionQueueDiagnostics(now = Date.now()): IngestionQueueDiagnostics {
  ensureFactSchema();
  const db = getMemoryDb();
  const statusRows = db.getAllSync<{ status: IngestionJobStatus; count: number }>(
    'SELECT status, COUNT(*) AS count FROM memory_ingestion_jobs GROUP BY status',
  );
  const providerRows = db.getAllSync<{
    provider_outcome: IngestionProviderOutcome;
    count: number;
  }>(
    `SELECT provider_outcome, COUNT(*) AS count
       FROM memory_ingestion_jobs
      WHERE provider_outcome IS NOT NULL
      GROUP BY provider_outcome`,
  );
  const byStatus = Object.fromEntries(
    ALL_INGESTION_STATUSES.map((status) => [status, 0]),
  ) as Record<IngestionJobStatus, number>;
  const byProviderOutcome = Object.fromEntries(
    ALL_PROVIDER_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<IngestionProviderOutcome, number>;
  for (const row of statusRows) byStatus[row.status] = Math.max(0, row.count);
  for (const row of providerRows) {
    byProviderOutcome[row.provider_outcome] = Math.max(0, row.count);
  }
  const dueRetryCount =
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_ingestion_jobs
        WHERE status IN ('pending', 'retrying')
          AND next_attempt_at <= ?`,
      now,
    )?.count ?? 0;
  const staleProcessingCount =
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_ingestion_jobs
        WHERE status = 'processing'
          AND lease_expires_at <= ?`,
      now,
    )?.count ?? 0;

  return {
    total: statusRows.reduce((sum, row) => sum + Math.max(0, row.count), 0),
    byStatus,
    byProviderOutcome,
    dueRetryCount: Math.max(0, dueRetryCount),
    staleProcessingCount: Math.max(0, staleProcessingCount),
  };
}
