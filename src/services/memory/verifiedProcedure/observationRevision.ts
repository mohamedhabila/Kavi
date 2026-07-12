import { getMemoryDb } from '../database';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { ensureFactSchema } from '../schema';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const MAX_OBSERVATION_REVISION = Number.MAX_SAFE_INTEGER;

export type VerifiedProcedureObservationRevision = Readonly<{
  memoryOwnerId: string;
  value: number;
}>;

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function ensureRevisionRow(db: MemoryDb, memoryOwnerId: string): void {
  db.runSync(
    `INSERT OR IGNORE INTO memory_verified_procedure_state(
       memory_owner_id, observation_revision
     ) VALUES (?, 0)`,
    memoryOwnerId,
  );
}

export function readVerifiedProcedureObservationRevision(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureObservationRevision {
  ensureRevisionRow(db, memoryOwnerId);
  const row = db.getFirstSync<{ observation_revision: unknown }>(
    `SELECT observation_revision
       FROM memory_verified_procedure_state
      WHERE memory_owner_id = ?`,
    memoryOwnerId,
  );
  if (!row || !validRevision(row.observation_revision)) {
    throw new Error('verified_procedure_observation_revision_invalid');
  }
  return Object.freeze({ memoryOwnerId, value: row.observation_revision });
}

export function advanceVerifiedProcedureObservationRevision(
  db: MemoryDb,
  memoryOwnerId: string,
): VerifiedProcedureObservationRevision {
  ensureRevisionRow(db, memoryOwnerId);
  const update = db.runSync(
    `UPDATE memory_verified_procedure_state
        SET observation_revision = observation_revision + 1
      WHERE memory_owner_id = ? AND observation_revision < ?`,
    memoryOwnerId,
    MAX_OBSERVATION_REVISION,
  );
  if (update.changes !== 1) {
    throw new Error('verified_procedure_observation_revision_exhausted');
  }
  return readVerifiedProcedureObservationRevision(db, memoryOwnerId);
}

export function isVerifiedProcedureObservationRevisionCurrent(
  revision: VerifiedProcedureObservationRevision,
): boolean {
  if (
    !revision ||
    typeof revision !== 'object' ||
    typeof revision.memoryOwnerId !== 'string' ||
    !validRevision(revision.value)
  ) {
    return false;
  }
  try {
    ensureFactSchema();
    const db = getMemoryDb();
    const currentOwnerId = getLocalMemoryVaultOwnerId(db);
    if (currentOwnerId !== revision.memoryOwnerId) return false;
    return readVerifiedProcedureObservationRevision(db, currentOwnerId).value === revision.value;
  } catch {
    return false;
  }
}
