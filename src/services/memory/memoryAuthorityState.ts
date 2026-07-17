import type { MemoryDatabase } from './access/schemaGuard';

const MAX_AUTHORITY_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_MEMORY_POLICY_REVISION = Number.MAX_SAFE_INTEGER;

let restrictiveProcessEpoch = 0;
let projectionProcessEpoch = 0;

export type RestrictiveMemoryAuthorityRevision = Readonly<{
  kind: 'restrictive';
  memoryOwnerId: string;
  value: number;
}>;

export type MemoryProjectionRevision = Readonly<{
  kind: 'projection';
  memoryOwnerId: string;
  value: number;
}>;

export type MemoryAuthoritySnapshot = Readonly<{
  processEpochs: Readonly<{
    restrictive: number;
    projection: number;
  }>;
  restrictiveRevision: RestrictiveMemoryAuthorityRevision;
  projectionRevision: MemoryProjectionRevision;
  policy: Readonly<{
    enabled: true;
    revision: number;
  }>;
}>;

export type DurableMemoryPolicyState = Readonly<{
  enabled: boolean;
  memoryOwnerId: string;
  revision: number;
}>;

export type MemoryAuthorityRevisions = Readonly<{
  restrictive: RestrictiveMemoryAuthorityRevision;
  projection: MemoryProjectionRevision;
}>;

function isRevisionValue(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isProcessEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isMemoryAuthoritySnapshotShape(value: unknown): value is MemoryAuthoritySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<MemoryAuthoritySnapshot>;
  const ownerId = snapshot.restrictiveRevision?.memoryOwnerId;
  return (
    isProcessEpoch(snapshot.processEpochs?.restrictive) &&
    isProcessEpoch(snapshot.processEpochs?.projection) &&
    snapshot.restrictiveRevision?.kind === 'restrictive' &&
    typeof ownerId === 'string' &&
    ownerId.length > 0 &&
    isRevisionValue(snapshot.restrictiveRevision.value) &&
    snapshot.projectionRevision?.kind === 'projection' &&
    snapshot.projectionRevision.memoryOwnerId === ownerId &&
    isRevisionValue(snapshot.projectionRevision.value) &&
    snapshot.projectionRevision.value >= snapshot.restrictiveRevision.value &&
    snapshot.policy?.enabled === true &&
    isRevisionValue(snapshot.policy.revision)
  );
}

export function readMemoryAuthorityProcessEpochs(): Readonly<{
  restrictive: number;
  projection: number;
}> {
  return Object.freeze({
    restrictive: restrictiveProcessEpoch,
    projection: projectionProcessEpoch,
  });
}

export function readMemoryAuthorityRevisions(
  db: MemoryDatabase,
  memoryOwnerId: string,
): MemoryAuthorityRevisions {
  const row = db.getFirstSync<{
    owner_id: string;
    restrictive_authority_revision: unknown;
    projection_revision: unknown;
  }>(
    `SELECT owner_id, restrictive_authority_revision, projection_revision
       FROM memory_vault_identity
      WHERE singleton = 1 AND owner_id = ?`,
    memoryOwnerId,
  );
  if (
    !row ||
    row.owner_id !== memoryOwnerId ||
    !isRevisionValue(row.restrictive_authority_revision) ||
    !isRevisionValue(row.projection_revision) ||
    row.projection_revision < row.restrictive_authority_revision
  ) {
    throw new Error('memory_authority_revisions_invalid');
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

export function advanceMemoryProjectionRevision(
  db: MemoryDatabase,
  memoryOwnerId: string,
): MemoryProjectionRevision {
  const result = db.runSync(
    `UPDATE memory_vault_identity
        SET projection_revision = projection_revision + 1
      WHERE singleton = 1
        AND owner_id = ?
        AND projection_revision < ?`,
    memoryOwnerId,
    MAX_AUTHORITY_REVISION,
  );
  if ((result.changes ?? 0) !== 1) {
    throw new Error('memory_projection_revision_exhausted');
  }
  return readMemoryAuthorityRevisions(db, memoryOwnerId).projection;
}

export function advanceRestrictiveMemoryAuthorityRevisions(
  db: MemoryDatabase,
  memoryOwnerId: string,
): MemoryAuthorityRevisions {
  const result = db.runSync(
    `UPDATE memory_vault_identity
        SET restrictive_authority_revision = restrictive_authority_revision + 1,
            projection_revision = projection_revision + 1
      WHERE singleton = 1
        AND owner_id = ?
        AND restrictive_authority_revision < ?
        AND projection_revision < ?`,
    memoryOwnerId,
    MAX_AUTHORITY_REVISION,
    MAX_AUTHORITY_REVISION,
  );
  if ((result.changes ?? 0) !== 1) {
    throw new Error('restrictive_memory_authority_revision_exhausted');
  }
  return readMemoryAuthorityRevisions(db, memoryOwnerId);
}

export function readDurableMemoryPolicyState(
  db: MemoryDatabase,
  memoryOwnerId: string,
): DurableMemoryPolicyState {
  const row = db.getFirstSync<{
    owner_id: string;
    memory_policy_enabled: unknown;
    memory_policy_revision: unknown;
  }>(
    `SELECT owner_id, memory_policy_enabled, memory_policy_revision
       FROM memory_vault_identity
      WHERE singleton = 1 AND owner_id = ?`,
    memoryOwnerId,
  );
  if (
    !row ||
    row.owner_id !== memoryOwnerId ||
    (row.memory_policy_enabled !== 0 && row.memory_policy_enabled !== 1) ||
    !isRevisionValue(row.memory_policy_revision)
  ) {
    throw new Error('memory_policy_authority_invalid');
  }
  return Object.freeze({
    enabled: row.memory_policy_enabled === 1,
    memoryOwnerId,
    revision: row.memory_policy_revision,
  });
}

export function setDurableMemoryPolicyState(
  db: MemoryDatabase,
  memoryOwnerId: string,
  enabled: boolean,
): DurableMemoryPolicyState {
  const current = readDurableMemoryPolicyState(db, memoryOwnerId);
  if (current.enabled === enabled) return current;
  const result = db.runSync(
    `UPDATE memory_vault_identity
        SET memory_policy_enabled = ?,
            memory_policy_revision = memory_policy_revision + 1
      WHERE singleton = 1
        AND owner_id = ?
        AND memory_policy_enabled = ?
        AND memory_policy_revision < ?`,
    enabled ? 1 : 0,
    memoryOwnerId,
    current.enabled ? 1 : 0,
    MAX_MEMORY_POLICY_REVISION,
  );
  if ((result.changes ?? 0) !== 1) {
    throw new Error('memory_policy_authority_transition_failed');
  }
  return readDurableMemoryPolicyState(db, memoryOwnerId);
}

function advanceProcessEpoch(value: number, code: string): number {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(code);
  return value + 1;
}

export function invalidateMemoryProjectionProcessEpoch(): void {
  projectionProcessEpoch = advanceProcessEpoch(
    projectionProcessEpoch,
    'memory_projection_process_epoch_exhausted',
  );
}

export function invalidateRestrictiveMemoryAuthorityProcessEpoch(): void {
  restrictiveProcessEpoch = advanceProcessEpoch(
    restrictiveProcessEpoch,
    'restrictive_memory_authority_process_epoch_exhausted',
  );
  invalidateMemoryProjectionProcessEpoch();
}

export function isRestrictiveMemoryAuthorityProcessEpochCurrent(epoch: number): boolean {
  return isProcessEpoch(epoch) && epoch === restrictiveProcessEpoch;
}

export function isMemoryProjectionProcessEpochCurrent(epoch: number): boolean {
  return isProcessEpoch(epoch) && epoch === projectionProcessEpoch;
}
