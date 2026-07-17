import {
  assertMemoryTransactionActive,
  runAfterMemoryTransactionCommit,
} from '../access/transaction';
import { getMemoryDb } from '../database';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { ensureFactSchema } from '../schema';
import {
  advanceRestrictiveVerifiedProcedureAuthorityRevisions,
  advanceVerifiedProcedureProjectionRevision,
  invalidateRestrictiveVerifiedProcedureAuthorityProcessEpoch,
  invalidateVerifiedProcedureProjectionProcessEpoch,
  isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent,
  isVerifiedProcedureAuthoritySnapshotShape,
  isVerifiedProcedureProjectionProcessEpochCurrent,
  readVerifiedProcedureAuthorityProcessEpochs,
  readVerifiedProcedureAuthorityRevisions,
  type VerifiedProcedureAuthoritySnapshot,
  type VerifiedProcedureProjectionRevision,
  type VerifiedProcedureRestrictiveAuthorityRevision,
} from './observationAuthorityState';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export {
  invalidateRestrictiveVerifiedProcedureAuthorityProcessEpoch,
  invalidateVerifiedProcedureProjectionProcessEpoch,
  isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent,
  isVerifiedProcedureAuthoritySnapshotShape,
  type VerifiedProcedureAuthoritySnapshot,
  type VerifiedProcedureProjectionRevision,
  type VerifiedProcedureRestrictiveAuthorityRevision,
} from './observationAuthorityState';

/** Advance advisory freshness without revoking already-admitted model work. */
export function advanceVerifiedProcedureProjectionInTransaction(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureProjectionRevision {
  assertMemoryTransactionActive('verified_procedure_projection_transaction_required');
  const revision = advanceVerifiedProcedureProjectionRevision(db, memoryOwnerId);
  runAfterMemoryTransactionCommit(invalidateVerifiedProcedureProjectionProcessEpoch);
  return revision;
}

/** Revoke admitted procedure-derived work and advance advisory freshness atomically. */
export function advanceRestrictiveVerifiedProcedureAuthorityInTransaction(
  db: MemoryDb,
  memoryOwnerId: string,
): Readonly<{
  restrictive: VerifiedProcedureRestrictiveAuthorityRevision;
  projection: VerifiedProcedureProjectionRevision;
}> {
  assertMemoryTransactionActive('verified_procedure_restrictive_authority_transaction_required');
  const revisions = advanceRestrictiveVerifiedProcedureAuthorityRevisions(db, memoryOwnerId);
  runAfterMemoryTransactionCommit(invalidateRestrictiveVerifiedProcedureAuthorityProcessEpoch);
  return revisions;
}

export function captureVerifiedProcedureAuthoritySnapshot(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureAuthoritySnapshot | null {
  try {
    const processEpochs = readVerifiedProcedureAuthorityProcessEpochs();
    const revisions = readVerifiedProcedureAuthorityRevisions(db, memoryOwnerId);
    if (
      !isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent(processEpochs.restrictive) ||
      !isVerifiedProcedureProjectionProcessEpochCurrent(processEpochs.projection)
    ) {
      return null;
    }
    return Object.freeze({
      processEpochs: Object.freeze({ ...processEpochs }),
      restrictiveRevision: Object.freeze({ ...revisions.restrictive }),
      projectionRevision: Object.freeze({ ...revisions.projection }),
    });
  } catch {
    return null;
  }
}

export function isRestrictiveVerifiedProcedureAuthoritySnapshotCurrent(
  snapshot: VerifiedProcedureAuthoritySnapshot,
): boolean {
  return (
    isVerifiedProcedureAuthoritySnapshotShape(snapshot) &&
    isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent(snapshot.processEpochs.restrictive)
  );
}

export function isVerifiedProcedureProjectionSnapshotCurrent(
  snapshot: VerifiedProcedureAuthoritySnapshot,
): boolean {
  return (
    isVerifiedProcedureAuthoritySnapshotShape(snapshot) &&
    isVerifiedProcedureProjectionProcessEpochCurrent(snapshot.processEpochs.projection)
  );
}

export function isVerifiedProcedureRestrictiveAuthorityRevisionCurrentInDatabase(
  db: MemoryDb,
  revision: VerifiedProcedureRestrictiveAuthorityRevision,
): boolean {
  if (
    revision?.kind !== 'restrictive' ||
    typeof revision.memoryOwnerId !== 'string' ||
    !Number.isSafeInteger(revision.value) ||
    revision.value < 0
  ) {
    return false;
  }
  try {
    return (
      readVerifiedProcedureAuthorityRevisions(db, revision.memoryOwnerId).restrictive.value ===
      revision.value
    );
  } catch {
    return false;
  }
}

export function isRestrictiveVerifiedProcedureAuthoritySnapshotDurablyCurrent(
  snapshot: VerifiedProcedureAuthoritySnapshot,
): boolean {
  if (!isRestrictiveVerifiedProcedureAuthoritySnapshotCurrent(snapshot)) return false;
  try {
    ensureFactSchema();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    return (
      memoryOwnerId === snapshot.restrictiveRevision.memoryOwnerId &&
      isVerifiedProcedureRestrictiveAuthorityRevisionCurrentInDatabase(
        db,
        snapshot.restrictiveRevision,
      )
    );
  } catch {
    return false;
  }
}

export function isVerifiedProcedureRestrictiveAuthorityRevisionDurablyCurrent(
  revision: VerifiedProcedureRestrictiveAuthorityRevision,
): boolean {
  try {
    ensureFactSchema();
    const db = getMemoryDb();
    return (
      getLocalMemoryVaultOwnerId(db) === revision.memoryOwnerId &&
      isVerifiedProcedureRestrictiveAuthorityRevisionCurrentInDatabase(db, revision)
    );
  } catch {
    return false;
  }
}

export function isVerifiedProcedureProjectionSnapshotDurablyCurrent(
  snapshot: VerifiedProcedureAuthoritySnapshot,
): boolean {
  if (!isVerifiedProcedureProjectionSnapshotCurrent(snapshot)) return false;
  try {
    ensureFactSchema();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    if (memoryOwnerId !== snapshot.projectionRevision.memoryOwnerId) return false;
    const revisions = readVerifiedProcedureAuthorityRevisions(db, memoryOwnerId);
    return (
      revisions.restrictive.value === snapshot.restrictiveRevision.value &&
      revisions.projection.value === snapshot.projectionRevision.value
    );
  } catch {
    return false;
  }
}
