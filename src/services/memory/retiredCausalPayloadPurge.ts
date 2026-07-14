import type { MemoryDatabase } from './access/schemaGuard';
import { assertMemoryTransactionActive } from './access/transaction';

const PURGE_BATCH_SIZE = 128;

export interface RetiredCausalPayloadPurgeReceipt {
  contributionPayloads: number;
  factPayloads: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function uniqueIds(ids: ReadonlyArray<string>, code: string): string[] {
  const result = [...ids].sort();
  if (result.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 512)) fail(code);
  if (result.some((id, index) => index > 0 && id === result[index - 1])) fail(code);
  return result;
}

function countRowsByIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string>,
): number {
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += PURGE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PURGE_BATCH_SIZE);
    count +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}
          WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      )?.count ?? 0;
  }
  return count;
}

function countLocallyOwnedRetirementIds(
  db: MemoryDatabase,
  input: Readonly<{
    table: 'memory_retired_fact_contributions' | 'memory_retired_facts';
    idColumn: 'contribution_id' | 'fact_id';
    ids: ReadonlyArray<string>;
  }>,
): number {
  let count = 0;
  for (let offset = 0; offset < input.ids.length; offset += PURGE_BATCH_SIZE) {
    const batch = input.ids.slice(offset, offset + PURGE_BATCH_SIZE);
    count +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM ${input.table} AS retired
           JOIN memory_source_retirement_groups AS retirement
             ON retirement.id = retired.retirement_group_id
           JOIN memory_vault_identity AS vault
             ON vault.singleton = 1 AND vault.owner_id = retirement.memory_owner_id
          WHERE retired.${input.idColumn} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      )?.count ?? 0;
  }
  return count;
}

function deleteRowsByIds(
  db: MemoryDatabase,
  table: string,
  column: string,
  ids: ReadonlyArray<string>,
): number {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += PURGE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PURGE_BATCH_SIZE);
    deleted +=
      db.runSync(
        `DELETE FROM ${table} WHERE ${column} IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      ).changes ?? 0;
  }
  return deleted;
}

function existingIds(
  db: MemoryDatabase,
  table: 'memory_fact_contributions' | 'memory_facts',
  ids: ReadonlyArray<string>,
): string[] {
  const existing: string[] = [];
  for (let offset = 0; offset < ids.length; offset += PURGE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PURGE_BATCH_SIZE);
    existing.push(
      ...db
        .getAllSync<{ id: string }>(
          `SELECT id FROM ${table}
            WHERE id IN (${batch.map(() => '?').join(', ')}) ORDER BY id`,
          ...batch,
        )
        .map((row) => row.id),
    );
  }
  return existing;
}

function assertNoFactDependencies(db: MemoryDatabase, factIds: ReadonlyArray<string>): void {
  for (let offset = 0; offset < factIds.length; offset += PURGE_BATCH_SIZE) {
    const batch = factIds.slice(offset, offset + PURGE_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    const contribution = db.getFirstSync<{ present: number }>(
      `SELECT 1 AS present FROM memory_fact_contributions
        WHERE fact_id IN (${placeholders}) LIMIT 1`,
      ...batch,
    );
    if (contribution) fail('memory_retired_payload_fact_contribution_residual');
    const supersession = db.getFirstSync<{ present: number }>(
      `SELECT 1 AS present FROM memory_fact_contribution_supersessions
        WHERE predecessor_fact_id IN (${placeholders})
           OR successor_fact_id IN (${placeholders})
        LIMIT 1`,
      ...batch,
      ...batch,
    );
    if (supersession) fail('memory_retired_payload_fact_supersession_residual');
  }
}

function purgeContributionParents(
  db: MemoryDatabase,
  contributionIds: ReadonlyArray<string>,
): number {
  if (contributionIds.length === 0) return 0;
  if (
    countLocallyOwnedRetirementIds(db, {
      table: 'memory_retired_fact_contributions',
      idColumn: 'contribution_id',
      ids: contributionIds,
    }) !== contributionIds.length
  ) {
    fail('memory_retired_payload_contribution_fence_missing');
  }
  const parentIds = existingIds(db, 'memory_fact_contributions', contributionIds);
  const deleted = deleteRowsByIds(db, 'memory_fact_contributions', 'id', parentIds);
  if (
    deleted !== parentIds.length ||
    countRowsByIds(db, 'memory_fact_contributions', 'id', contributionIds) !== 0 ||
    countRowsByIds(db, 'memory_fact_contribution_sources', 'contribution_id', contributionIds) !==
      0 ||
    countRowsByIds(
      db,
      'memory_fact_contribution_supersession_snapshots',
      'contribution_id',
      contributionIds,
    ) !== 0 ||
    countRowsByIds(
      db,
      'memory_fact_contribution_supersessions',
      'contribution_id',
      contributionIds,
    ) !== 0
  ) {
    fail('memory_retired_payload_contribution_postcondition_invalid');
  }
  return deleted;
}

function purgeFactParents(
  db: MemoryDatabase,
  factIds: ReadonlyArray<string>,
  fenceTable: 'memory_retired_facts' | 'memory_fact_legacy_quarantine',
): number {
  if (factIds.length === 0) return 0;
  const fenceCount =
    fenceTable === 'memory_retired_facts'
      ? countLocallyOwnedRetirementIds(db, {
          table: 'memory_retired_facts',
          idColumn: 'fact_id',
          ids: factIds,
        })
      : countRowsByIds(db, 'memory_fact_legacy_quarantine', 'fact_id', factIds);
  if (fenceCount !== factIds.length) {
    fail('memory_retired_payload_fact_fence_missing');
  }
  assertNoFactDependencies(db, factIds);
  const parentIds = existingIds(db, 'memory_facts', factIds);
  const deleted = deleteRowsByIds(db, 'memory_facts', 'id', parentIds);
  if (deleted !== parentIds.length || countRowsByIds(db, 'memory_facts', 'id', factIds) !== 0) {
    fail('memory_retired_payload_fact_postcondition_invalid');
  }
  return deleted;
}

/**
 * Physically remove causal payload parents only after their immutable identifiers
 * and exact source fences have committed in the caller-owned transaction.
 */
export function purgeRetiredCausalPayloadsInTransaction(
  db: MemoryDatabase,
  input: Readonly<{
    retiredContributionIds: ReadonlyArray<string>;
    retiredFactIds: ReadonlyArray<string>;
  }>,
): Readonly<RetiredCausalPayloadPurgeReceipt> {
  assertMemoryTransactionActive('memory_retired_payload_purge_transaction_required');
  const contributionIds = uniqueIds(
    input.retiredContributionIds,
    'memory_retired_payload_contribution_ids_invalid',
  );
  const factIds = uniqueIds(input.retiredFactIds, 'memory_retired_payload_fact_ids_invalid');
  return Object.freeze({
    contributionPayloads: purgeContributionParents(db, contributionIds),
    factPayloads: purgeFactParents(db, factIds, 'memory_retired_facts'),
  });
}

function loadParentIds(
  db: MemoryDatabase,
  input: Readonly<{
    parentTable: 'memory_fact_contributions' | 'memory_facts';
    fenceTable:
      | 'memory_retired_fact_contributions'
      | 'memory_retired_facts'
      | 'memory_fact_legacy_quarantine';
    parentIdColumn: 'id';
    fenceIdColumn: 'contribution_id' | 'fact_id';
    memoryOwnerId: string;
  }>,
): string[] {
  return db
    .getAllSync<{ id: string }>(
      `SELECT parent.${input.parentIdColumn} AS id
         FROM ${input.parentTable} AS parent
         JOIN ${input.fenceTable} AS fence
           ON fence.${input.fenceIdColumn} = parent.${input.parentIdColumn}
        WHERE parent.memory_owner_id = ?
        ORDER BY parent.${input.parentIdColumn} ASC`,
      input.memoryOwnerId,
    )
    .map((row) => row.id);
}

/** Delete every payload parent after a full reset has fenced all causal sources. */
export function purgeAllRetiredCausalPayloadsForOwnerInTransaction(
  db: MemoryDatabase,
  memoryOwnerId: string,
): Readonly<RetiredCausalPayloadPurgeReceipt> {
  assertMemoryTransactionActive('memory_retired_payload_purge_transaction_required');
  const contributionIds = loadParentIds(db, {
    parentTable: 'memory_fact_contributions',
    fenceTable: 'memory_retired_fact_contributions',
    parentIdColumn: 'id',
    fenceIdColumn: 'contribution_id',
    memoryOwnerId,
  });
  const retiredFactIds = loadParentIds(db, {
    parentTable: 'memory_facts',
    fenceTable: 'memory_retired_facts',
    parentIdColumn: 'id',
    fenceIdColumn: 'fact_id',
    memoryOwnerId,
  });
  const quarantinedFactIds = loadParentIds(db, {
    parentTable: 'memory_facts',
    fenceTable: 'memory_fact_legacy_quarantine',
    parentIdColumn: 'id',
    fenceIdColumn: 'fact_id',
    memoryOwnerId,
  });
  const retiredFactIdSet = new Set(retiredFactIds);
  const uniquelyQuarantinedFactIds = quarantinedFactIds.filter(
    (factId) => !retiredFactIdSet.has(factId),
  );
  const contributionPayloads = purgeContributionParents(db, contributionIds);
  const factPayloads =
    purgeFactParents(db, retiredFactIds, 'memory_retired_facts') +
    purgeFactParents(db, uniquelyQuarantinedFactIds, 'memory_fact_legacy_quarantine');
  const causalResidual = db.getFirstSync<{ present: number }>(
    `SELECT 1 AS present FROM memory_fact_contributions
      WHERE memory_owner_id = ?
      UNION ALL
     SELECT 1 AS present FROM memory_facts
      WHERE memory_owner_id = ?
      LIMIT 1`,
    memoryOwnerId,
    memoryOwnerId,
  );
  if (causalResidual) fail('memory_reset_causal_payload_residual');
  return Object.freeze({ contributionPayloads, factPayloads });
}
