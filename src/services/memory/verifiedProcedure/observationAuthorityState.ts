import type { getMemoryDb } from '../database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const MAX_AUTHORITY_REVISION = Number.MAX_SAFE_INTEGER;

let restrictiveProcessEpoch = 0;
let projectionProcessEpoch = 0;

export type VerifiedProcedureRestrictiveAuthorityRevision = Readonly<{
  kind: 'restrictive';
  memoryOwnerId: string;
  value: number;
}>;

export type VerifiedProcedureProjectionRevision = Readonly<{
  kind: 'projection';
  memoryOwnerId: string;
  value: number;
}>;

export type VerifiedProcedureAuthoritySnapshot = Readonly<{
  processEpochs: Readonly<{
    restrictive: number;
    projection: number;
  }>;
  restrictiveRevision: VerifiedProcedureRestrictiveAuthorityRevision;
  projectionRevision: VerifiedProcedureProjectionRevision;
}>;

export type VerifiedProcedureAuthorityRevisions = Readonly<{
  restrictive: VerifiedProcedureRestrictiveAuthorityRevision;
  projection: VerifiedProcedureProjectionRevision;
}>;

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isProcessEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function ensureAuthorityRow(db: MemoryDb, memoryOwnerId: string): void {
  db.runSync(
    `INSERT OR IGNORE INTO memory_verified_procedure_state(
       memory_owner_id, restrictive_authority_revision, projection_revision
     ) VALUES (?, 0, 0)`,
    memoryOwnerId,
  );
}

export function isVerifiedProcedureAuthoritySnapshotShape(
  value: unknown,
): value is VerifiedProcedureAuthoritySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<VerifiedProcedureAuthoritySnapshot>;
  const ownerId = snapshot.restrictiveRevision?.memoryOwnerId;
  return (
    isProcessEpoch(snapshot.processEpochs?.restrictive) &&
    isProcessEpoch(snapshot.processEpochs?.projection) &&
    snapshot.restrictiveRevision?.kind === 'restrictive' &&
    typeof ownerId === 'string' &&
    ownerId.length > 0 &&
    isRevision(snapshot.restrictiveRevision.value) &&
    snapshot.projectionRevision?.kind === 'projection' &&
    snapshot.projectionRevision.memoryOwnerId === ownerId &&
    isRevision(snapshot.projectionRevision.value) &&
    snapshot.projectionRevision.value >= snapshot.restrictiveRevision.value
  );
}

export function readVerifiedProcedureAuthorityProcessEpochs(): Readonly<{
  restrictive: number;
  projection: number;
}> {
  return Object.freeze({
    restrictive: restrictiveProcessEpoch,
    projection: projectionProcessEpoch,
  });
}

export function readVerifiedProcedureAuthorityRevisions(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureAuthorityRevisions {
  ensureAuthorityRow(db, memoryOwnerId);
  const row = db.getFirstSync<{
    restrictive_authority_revision: unknown;
    projection_revision: unknown;
  }>(
    `SELECT restrictive_authority_revision, projection_revision
       FROM memory_verified_procedure_state
      WHERE memory_owner_id = ?`,
    memoryOwnerId,
  );
  if (
    !row ||
    !isRevision(row.restrictive_authority_revision) ||
    !isRevision(row.projection_revision) ||
    row.projection_revision < row.restrictive_authority_revision
  ) {
    throw new Error('verified_procedure_authority_revisions_invalid');
  }
  return Object.freeze({
    restrictive: Object.freeze({
      kind: 'restrictive',
      memoryOwnerId,
      value: row.restrictive_authority_revision,
    }),
    projection: Object.freeze({
      kind: 'projection',
      memoryOwnerId,
      value: row.projection_revision,
    }),
  });
}

export function advanceVerifiedProcedureProjectionRevision(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureProjectionRevision {
  ensureAuthorityRow(db, memoryOwnerId);
  const result = db.runSync(
    `UPDATE memory_verified_procedure_state
        SET projection_revision = projection_revision + 1
      WHERE memory_owner_id = ? AND projection_revision < ?`,
    memoryOwnerId,
    MAX_AUTHORITY_REVISION,
  );
  if ((result.changes ?? 0) !== 1) {
    throw new Error('verified_procedure_projection_revision_exhausted');
  }
  return readVerifiedProcedureAuthorityRevisions(db, memoryOwnerId).projection;
}

export function advanceRestrictiveVerifiedProcedureAuthorityRevisions(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureAuthorityRevisions {
  ensureAuthorityRow(db, memoryOwnerId);
  const result = db.runSync(
    `UPDATE memory_verified_procedure_state
        SET restrictive_authority_revision = restrictive_authority_revision + 1,
            projection_revision = projection_revision + 1
      WHERE memory_owner_id = ?
        AND restrictive_authority_revision < ?
        AND projection_revision < ?`,
    memoryOwnerId,
    MAX_AUTHORITY_REVISION,
    MAX_AUTHORITY_REVISION,
  );
  if ((result.changes ?? 0) !== 1) {
    throw new Error('verified_procedure_restrictive_authority_revision_exhausted');
  }
  return readVerifiedProcedureAuthorityRevisions(db, memoryOwnerId);
}

function advanceProcessEpoch(value: number, code: string): number {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(code);
  return value + 1;
}

export function invalidateVerifiedProcedureProjectionProcessEpoch(): void {
  projectionProcessEpoch = advanceProcessEpoch(
    projectionProcessEpoch,
    'verified_procedure_projection_process_epoch_exhausted',
  );
}

export function invalidateRestrictiveVerifiedProcedureAuthorityProcessEpoch(): void {
  restrictiveProcessEpoch = advanceProcessEpoch(
    restrictiveProcessEpoch,
    'verified_procedure_restrictive_authority_process_epoch_exhausted',
  );
  invalidateVerifiedProcedureProjectionProcessEpoch();
}

export function isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent(epoch: number): boolean {
  return isProcessEpoch(epoch) && epoch === restrictiveProcessEpoch;
}

export function isVerifiedProcedureProjectionProcessEpochCurrent(epoch: number): boolean {
  return isProcessEpoch(epoch) && epoch === projectionProcessEpoch;
}
