import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import {
  assertMemoryTransactionActive,
  runAfterMemoryTransactionCommit,
  runMemoryTransaction,
} from './access/transaction';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  advanceMemoryProjectionRevision,
  advanceRestrictiveMemoryAuthorityRevisions,
  invalidateMemoryProjectionProcessEpoch,
  invalidateRestrictiveMemoryAuthorityProcessEpoch,
  isMemoryAuthoritySnapshotShape,
  isMemoryProjectionProcessEpochCurrent,
  isRestrictiveMemoryAuthorityProcessEpochCurrent,
  readDurableMemoryPolicyState,
  readMemoryAuthorityProcessEpochs,
  readMemoryAuthorityRevisions,
  setDurableMemoryPolicyState,
  type MemoryAuthoritySnapshot,
  type MemoryProjectionRevision,
  type RestrictiveMemoryAuthorityRevision,
} from './memoryAuthorityState';

export {
  invalidateMemoryProjectionProcessEpoch,
  invalidateRestrictiveMemoryAuthorityProcessEpoch,
  type MemoryAuthoritySnapshot,
  type MemoryProjectionRevision,
  type RestrictiveMemoryAuthorityRevision,
} from './memoryAuthorityState';

/** Advance retrieval/prompt freshness without cancelling already-admitted work. */
export function advanceMemoryProjectionInTransaction(
  db: MemoryDatabase,
  memoryOwnerId: string,
): MemoryProjectionRevision {
  assertMemoryTransactionActive('memory_projection_transaction_required');
  const revision = advanceMemoryProjectionRevision(db, memoryOwnerId);
  runAfterMemoryTransactionCommit(invalidateMemoryProjectionProcessEpoch);
  return revision;
}

/** Advance the in-flight revocation fence and projection freshness atomically. */
export function advanceRestrictiveMemoryAuthorityInTransaction(
  db: MemoryDatabase,
  memoryOwnerId: string,
): Readonly<{
  restrictive: RestrictiveMemoryAuthorityRevision;
  projection: MemoryProjectionRevision;
}> {
  assertMemoryTransactionActive('restrictive_memory_authority_transaction_required');
  const revisions = advanceRestrictiveMemoryAuthorityRevisions(db, memoryOwnerId);
  runAfterMemoryTransactionCommit(invalidateRestrictiveMemoryAuthorityProcessEpoch);
  return revisions;
}

export function setDurableMemoryPolicyEnabled(enabled: boolean): void {
  runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const previous = readDurableMemoryPolicyState(db, memoryOwnerId);
    const current = setDurableMemoryPolicyState(db, memoryOwnerId, enabled);
    if (current.revision !== previous.revision) {
      advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);
    }
  });
}

export function isDurableMemoryPolicyEnabled(): boolean {
  try {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    return readDurableMemoryPolicyState(db, memoryOwnerId).enabled;
  } catch {
    return false;
  }
}

export function captureMemoryAuthoritySnapshot(): MemoryAuthoritySnapshot | null {
  try {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const processEpochs = readMemoryAuthorityProcessEpochs();
    const revisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
    const policy = readDurableMemoryPolicyState(db, memoryOwnerId);
    if (!policy.enabled) return null;
    if (
      !isRestrictiveMemoryAuthorityProcessEpochCurrent(processEpochs.restrictive) ||
      !isMemoryProjectionProcessEpochCurrent(processEpochs.projection)
    ) {
      return null;
    }
    return Object.freeze({
      processEpochs: Object.freeze({ ...processEpochs }),
      restrictiveRevision: Object.freeze({ ...revisions.restrictive }),
      projectionRevision: Object.freeze({ ...revisions.projection }),
      policy: Object.freeze({ enabled: true, revision: policy.revision }),
    });
  } catch {
    return null;
  }
}

/** Cheap same-runtime cancellation check for already-admitted model work. */
export function isRestrictiveMemoryAuthoritySnapshotCurrent(
  snapshot: MemoryAuthoritySnapshot,
): boolean {
  return (
    isMemoryAuthoritySnapshotShape(snapshot) &&
    isRestrictiveMemoryAuthorityProcessEpochCurrent(snapshot.processEpochs.restrictive)
  );
}

/** Cross-runtime cancellation check for provider dispatch, effects, and final delivery. */
export function isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(
  snapshot: MemoryAuthoritySnapshot,
): boolean {
  if (!isRestrictiveMemoryAuthoritySnapshotCurrent(snapshot)) return false;
  try {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    if (memoryOwnerId !== snapshot.restrictiveRevision.memoryOwnerId) return false;
    const revisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
    const policy = readDurableMemoryPolicyState(db, memoryOwnerId);
    return (
      revisions.restrictive.value === snapshot.restrictiveRevision.value &&
      policy.enabled &&
      policy.revision === snapshot.policy.revision
    );
  } catch {
    return false;
  }
}

/** Cheap same-runtime freshness check used before the next logical retrieval/model iteration. */
export function isMemoryProjectionSnapshotCurrent(snapshot: MemoryAuthoritySnapshot): boolean {
  return (
    isMemoryAuthoritySnapshotShape(snapshot) &&
    isMemoryProjectionProcessEpochCurrent(snapshot.processEpochs.projection)
  );
}

/** Cross-runtime freshness check spanning both restrictive and additive projection changes. */
export function isMemoryProjectionSnapshotDurablyCurrent(
  snapshot: MemoryAuthoritySnapshot,
): boolean {
  if (!isMemoryProjectionSnapshotCurrent(snapshot)) return false;
  try {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    if (memoryOwnerId !== snapshot.projectionRevision.memoryOwnerId) return false;
    const revisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
    const policy = readDurableMemoryPolicyState(db, memoryOwnerId);
    return (
      revisions.restrictive.value === snapshot.restrictiveRevision.value &&
      revisions.projection.value === snapshot.projectionRevision.value &&
      policy.enabled &&
      policy.revision === snapshot.policy.revision
    );
  } catch {
    return false;
  }
}
