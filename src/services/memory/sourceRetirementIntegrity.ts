import type { getMemoryDb } from './database';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  assertSourceRetirementChildCommitment,
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS,
  type MemorySourceRetirementChildCommitment,
} from './sourceRetirementChildCommitments';
import {
  validateSourceRetirementOperation,
  type ValidatedSourceRetirementOperation,
} from './sourceRetirementOperationCodec';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const SCHEMA_RESET_REQUIRED = 'memory_source_retirement_schema_reset_required';
const GROUP_PAGE_SIZE = 128;
const OWNERSHIP_BATCH_SIZE = 400;

interface RetirementGroupRow {
  id: string;
  memory_owner_id: string;
  reason: string;
  retired_at: number;
  requested_source_set_version: number;
  requested_source_set_count: number;
  requested_source_set_sha256: string;
  closed_source_set_version: number;
  closed_source_set_count: number;
  closed_source_set_sha256: string;
  retired_contribution_set_version: number;
  retired_contribution_set_count: number;
  retired_contribution_set_sha256: string;
  retired_fact_set_version: number;
  retired_fact_set_count: number;
  retired_fact_set_sha256: string;
}

interface PersistedSourceRow {
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

function failIntegrity(): never {
  throw new Error(SCHEMA_RESET_REQUIRED);
}

function rowToSource(row: PersistedSourceRow): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: row.memory_owner_id,
    memoryConversationId: row.memory_conversation_id,
    sourceThreadId: row.source_thread_id,
    taskId: row.task_id,
    sourceKind: row.source_kind as PersistedExactMemorySourceIdentity['sourceKind'],
    sourceId: row.source_id,
  };
}

function metadata(
  version: number,
  count: number,
  sha256: string,
): MemorySourceRetirementChildCommitment {
  return { version: version as 1, count, sha256 };
}

function loadSources(
  db: MemoryDb,
  table: 'memory_source_retirement_requests' | 'memory_retired_sources',
  groupId: string,
  limit: number,
): PersistedSourceRow[] {
  return db.getAllSync<PersistedSourceRow>(
    `SELECT memory_owner_id, memory_conversation_id, source_thread_id,
            task_id, source_kind, source_id
       FROM ${table}
      WHERE retirement_group_id = ?
      LIMIT ?`,
    groupId,
    limit + 1,
  );
}

function assertOwnedIds(
  db: MemoryDb,
  input: Readonly<{
    table: 'memory_fact_contributions' | 'memory_facts';
    idColumn: 'id';
    memoryOwnerId: string;
    ids: ReadonlyArray<string>;
  }>,
): void {
  let matched = 0;
  for (let offset = 0; offset < input.ids.length; offset += OWNERSHIP_BATCH_SIZE) {
    const batch = input.ids.slice(offset, offset + OWNERSHIP_BATCH_SIZE);
    matched +=
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${input.table}
          WHERE memory_owner_id = ?
            AND ${input.idColumn} IN (${batch.map(() => '?').join(', ')})`,
        input.memoryOwnerId,
        ...batch,
      )?.count ?? 0;
  }
  if (matched !== input.ids.length) failIntegrity();
}

function verifyPersistedOperation(
  db: MemoryDb,
  parent: RetirementGroupRow,
): Readonly<ValidatedSourceRetirementOperation> {
  if (parent.memory_owner_id !== getLocalMemoryVaultOwnerId(db)) failIntegrity();
  const requestedRows = loadSources(
    db,
    'memory_source_retirement_requests',
    parent.id,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
  );
  const closedRows = loadSources(
    db,
    'memory_retired_sources',
    parent.id,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources,
  );
  const contributionIds = db
    .getAllSync<{ contribution_id: string }>(
      `SELECT contribution_id FROM memory_retired_fact_contributions
        WHERE retirement_group_id = ? LIMIT ?`,
      parent.id,
      MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions + 1,
    )
    .map((row) => row.contribution_id);
  const factIds = db
    .getAllSync<{ fact_id: string }>(
      `SELECT fact_id FROM memory_retired_facts
        WHERE retirement_group_id = ? LIMIT ?`,
      parent.id,
      MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredFacts + 1,
    )
    .map((row) => row.fact_id);
  const verified = validateSourceRetirementOperation({
    retirementGroupId: parent.id,
    memoryOwnerId: parent.memory_owner_id,
    reason: parent.reason,
    retiredAt: parent.retired_at,
    requestedSources: requestedRows.map(rowToSource),
    closedSources: closedRows.map(rowToSource),
    retiredContributionIds: contributionIds,
    retiredFactIds: factIds,
  });
  assertSourceRetirementChildCommitment(
    metadata(
      parent.requested_source_set_version,
      parent.requested_source_set_count,
      parent.requested_source_set_sha256,
    ),
    verified.requestedSourcesCommitment,
  );
  assertSourceRetirementChildCommitment(
    metadata(
      parent.closed_source_set_version,
      parent.closed_source_set_count,
      parent.closed_source_set_sha256,
    ),
    verified.closedSourcesCommitment,
  );
  assertSourceRetirementChildCommitment(
    metadata(
      parent.retired_contribution_set_version,
      parent.retired_contribution_set_count,
      parent.retired_contribution_set_sha256,
    ),
    verified.retiredContributionsCommitment,
  );
  assertSourceRetirementChildCommitment(
    metadata(
      parent.retired_fact_set_version,
      parent.retired_fact_set_count,
      parent.retired_fact_set_sha256,
    ),
    verified.retiredFactsCommitment,
  );
  assertOwnedIds(db, {
    table: 'memory_fact_contributions',
    idColumn: 'id',
    memoryOwnerId: parent.memory_owner_id,
    ids: verified.retiredContributionIds,
  });
  assertOwnedIds(db, {
    table: 'memory_facts',
    idColumn: 'id',
    memoryOwnerId: parent.memory_owner_id,
    ids: verified.retiredFactIds,
  });
  return verified;
}

/** Verify one complete persisted group using bounded child and ownership reads. */
export function loadIntegrityVerifiedSourceRetirementOperation(
  db: MemoryDb,
  retirementGroupId: string,
): Readonly<ValidatedSourceRetirementOperation> | null {
  const parent = db.getFirstSync<RetirementGroupRow>(
    'SELECT * FROM memory_source_retirement_groups WHERE id = ? LIMIT 1',
    retirementGroupId,
  );
  if (!parent) return null;
  try {
    return verifyPersistedOperation(db, parent);
  } catch (error) {
    if (error instanceof Error && error.message === SCHEMA_RESET_REQUIRED) throw error;
    return failIntegrity();
  }
}

/** Keyset-page every immutable group without an unbounded in-memory bootstrap read. */
export function assertAllSourceRetirementOperationsIntegrity(db: MemoryDb): void {
  let afterId: string | null = null;
  for (;;) {
    const rows: Array<{ id: string }> = afterId === null
      ? db.getAllSync<{ id: string }>(
          'SELECT id FROM memory_source_retirement_groups ORDER BY id LIMIT ?',
          GROUP_PAGE_SIZE,
        )
      : db.getAllSync<{ id: string }>(
          `SELECT id FROM memory_source_retirement_groups
            WHERE id > ? ORDER BY id LIMIT ?`,
          afterId,
          GROUP_PAGE_SIZE,
        );
    if (rows.length === 0) return;
    for (const row of rows) {
      if (!loadIntegrityVerifiedSourceRetirementOperation(db, row.id)) failIntegrity();
    }
    afterId = rows[rows.length - 1]!.id;
  }
}
