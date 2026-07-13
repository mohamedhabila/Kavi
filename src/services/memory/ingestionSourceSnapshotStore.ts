import { runMemoryTransaction } from './access/transaction';
import { getMemoryDb } from './database';
import type { IngestionJobRow } from './ingestionQueueIdentity';
import {
  decodeIngestionSourceSnapshot,
  type EncodedIngestionSourceSnapshot,
  type IngestionSourceSnapshotV1,
} from './ingestionSourceSnapshot';

type MemoryDb = ReturnType<typeof getMemoryDb>;
type SnapshotFailureCode = 'source_snapshot_missing' | 'source_snapshot_invalid';

interface PersistedSnapshotRow {
  payload_json: string;
}

type SnapshotResolution =
  | { status: 'resolved'; snapshot: IngestionSourceSnapshotV1 }
  | { status: 'invalid'; code: SnapshotFailureCode };

function isActiveStatus(status: string): boolean {
  return status === 'pending' || status === 'processing' || status === 'retrying';
}

function resolvePersistedSnapshot(db: MemoryDb, row: IngestionJobRow): SnapshotResolution {
  const metadataMissing =
    row.source_snapshot_version === null &&
    row.source_snapshot_sha256 === null &&
    row.source_snapshot_byte_length === null;
  if (metadataMissing) return { status: 'invalid', code: 'source_snapshot_missing' };
  if (
    row.source_snapshot_version !== 1 ||
    typeof row.source_snapshot_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.source_snapshot_sha256) ||
    !Number.isSafeInteger(row.source_snapshot_byte_length) ||
    (row.source_snapshot_byte_length ?? 0) <= 0
  ) {
    return { status: 'invalid', code: 'source_snapshot_invalid' };
  }

  const persisted = db.getFirstSync<PersistedSnapshotRow>(
    `SELECT payload_json
       FROM memory_ingestion_source_snapshots
      WHERE job_id = ?
      LIMIT 1`,
    row.id,
  );
  if (!persisted) return { status: 'invalid', code: 'source_snapshot_missing' };

  try {
    const snapshot = decodeIngestionSourceSnapshot({
      snapshotVersion: row.source_snapshot_version,
      payloadJson: persisted.payload_json,
      payloadSha256: row.source_snapshot_sha256,
      payloadByteLength: row.source_snapshot_byte_length,
    });
    if (
      snapshot.sourceStartMessageId !== row.source_start_message_id ||
      snapshot.sourceEndMessageId !== row.source_end_message_id ||
      snapshot.priorUserMessageId !== row.prior_user_message_id
    ) {
      return { status: 'invalid', code: 'source_snapshot_invalid' };
    }
    return { status: 'resolved', snapshot };
  } catch {
    return { status: 'invalid', code: 'source_snapshot_invalid' };
  }
}

function snapshotFailureCode(db: MemoryDb, row: IngestionJobRow): SnapshotFailureCode | null {
  const resolution = resolvePersistedSnapshot(db, row);
  return resolution.status === 'invalid' ? resolution.code : null;
}

function failActiveSnapshot(
  db: MemoryDb,
  jobId: string,
  outcomeCode: SnapshotFailureCode,
  now: number,
): boolean {
  const result = db.runSync(
    `UPDATE memory_ingestion_jobs
        SET status = CASE
              WHEN structural_completed_at IS NULL THEN 'failed'
              ELSE 'degraded'
            END,
            provider_outcome = CASE
              WHEN structural_completed_at IS NULL THEN NULL
              ELSE 'structural_only'
            END,
            outcome_code = ?,
            next_attempt_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            claim_process_epoch = NULL,
            completed_at = ?,
            updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'processing', 'retrying')`,
    outcomeCode,
    now,
    now,
    jobId,
  );
  if ((result.changes ?? 0) !== 1) return false;
  if (
    db.getFirstSync<{ status: string }>(
      'SELECT status FROM memory_ingestion_jobs WHERE id = ? LIMIT 1',
      jobId,
    )?.status === 'failed'
  ) {
    db.runSync('DELETE FROM memory_ingestion_receipts WHERE job_id = ?', jobId);
  }
  return true;
}

export function validateIngestionSourceSnapshotForIdentity(
  encoded: EncodedIngestionSourceSnapshot,
  identity: {
    priorUserMessageId: string | null;
    sourceStartMessageId: string | null;
    sourceEndMessageId: string;
  },
): IngestionSourceSnapshotV1 {
  const decoded = decodeIngestionSourceSnapshot(encoded);
  if (
    decoded.priorUserMessageId !== identity.priorUserMessageId ||
    decoded.sourceStartMessageId !== identity.sourceStartMessageId ||
    decoded.sourceEndMessageId !== identity.sourceEndMessageId
  ) {
    throw new Error('memory_ingestion_source_snapshot_identity_conflict');
  }
  return decoded;
}

export function insertIngestionSourceSnapshot(
  db: MemoryDb,
  jobId: string,
  encoded: EncodedIngestionSourceSnapshot,
  createdAt: number,
): void {
  db.runSync(
    `INSERT INTO memory_ingestion_source_snapshots(job_id, payload_json, created_at)
     VALUES (?, ?, ?)`,
    jobId,
    encoded.payloadJson,
    createdAt,
  );
}

export function requireMatchingIngestionSourceSnapshot(
  db: MemoryDb,
  row: IngestionJobRow,
  encoded: EncodedIngestionSourceSnapshot,
  now: number,
): void {
  if (isActiveStatus(row.status)) {
    const failure = snapshotFailureCode(db, row);
    if (failure) {
      failActiveSnapshot(db, row.id, failure, now);
      throw new Error(`memory_ingestion_${failure}`);
    }
  }
  if (
    row.source_snapshot_version !== encoded.snapshotVersion ||
    row.source_snapshot_sha256 !== encoded.payloadSha256 ||
    row.source_snapshot_byte_length !== encoded.payloadByteLength
  ) {
    throw new Error('memory_ingestion_source_snapshot_conflict');
  }
}

export function ensureActiveIngestionSourceSnapshot(row: IngestionJobRow, now: number): boolean {
  if (!isActiveStatus(row.status)) return true;
  return runMemoryTransaction(() => {
    return loadActiveIngestionSourceSnapshotForRow(row, now) !== null;
  });
}

/**
 * Resolve one already-selected active row inside its caller's transaction.
 * Missing, corrupt, or identity-mismatched payloads terminalize the job.
 */
export function loadActiveIngestionSourceSnapshotForRow(
  row: IngestionJobRow,
  now: number,
): IngestionSourceSnapshotV1 | null {
  const db = getMemoryDb();
  if (!isActiveStatus(row.status)) return null;
  const resolution = resolvePersistedSnapshot(db, row);
  if (resolution.status === 'resolved') return resolution.snapshot;
  failActiveSnapshot(db, row.id, resolution.code, now);
  return null;
}

export function failActiveJobsWithInvalidSourceSnapshots(db: MemoryDb, now: number): void {
  const rows = db.getAllSync<IngestionJobRow>(
    `SELECT * FROM memory_ingestion_jobs
      WHERE status IN ('pending', 'processing', 'retrying')`,
  );
  for (const row of rows) {
    const failure = snapshotFailureCode(db, row);
    if (failure) failActiveSnapshot(db, row.id, failure, now);
  }
}
