import { assertMemoryTransactionActive } from './access/transaction';
import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import { loadIntegrityVerifiedSourceRetirementOperation } from './sourceRetirementIntegrity';
import {
  requireCanonicalRetirementContributionIds,
  requireCanonicalRetirementSources,
  validateSourceRetirementOperation,
  type ValidatedSourceRetirementOperation,
} from './sourceRetirementOperationCodec';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const LOOKUP_SOURCE_BATCH_SIZE = 100;
const LOOKUP_CONTRIBUTION_LIMIT = 128;
const LOOKUP_CONTRIBUTION_BATCH_SIZE = LOOKUP_CONTRIBUTION_LIMIT;
const TRANSACTION_REQUIRED = 'memory_source_retirement_transaction_required';
const SCHEMA_RESET_REQUIRED = 'memory_source_retirement_schema_reset_required';

interface PersistedSourceRow {
  retirement_group_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

interface RetiredContributionRow {
  contribution_id: string;
  retirement_group_id: string;
}

export interface ExistingSourceRetirementFence {
  retirementGroupId: string;
  source: Readonly<PersistedExactMemorySourceIdentity>;
}

export interface PriorRetiredFactContribution {
  retirementGroupId: string;
  contributionId: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceKey(source: PersistedExactMemorySourceIdentity): string {
  return JSON.stringify([
    source.memoryOwnerId,
    source.memoryConversationId,
    source.sourceThreadId,
    source.taskId,
    source.sourceKind,
    source.sourceId,
  ]);
}

function compareSources(
  left: PersistedExactMemorySourceIdentity,
  right: PersistedExactMemorySourceIdentity,
): number {
  const fields: ReadonlyArray<keyof PersistedExactMemorySourceIdentity> = [
    'memoryOwnerId',
    'memoryConversationId',
    'sourceThreadId',
    'taskId',
    'sourceKind',
    'sourceId',
  ];
  for (const field of fields) {
    const compared = compareOrdinal(left[field], right[field]);
    if (compared !== 0) return compared;
  }
  return 0;
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

function assertLocalOwner(db: MemoryDb, memoryOwnerId: string): void {
  if (memoryOwnerId !== getLocalMemoryVaultOwnerId(db)) {
    throw new Error('memory_source_retirement_owner_id_invalid');
  }
}

function requireVerifiedGroups(
  db: MemoryDb,
  groupIds: ReadonlySet<string>,
): Map<string, Readonly<ValidatedSourceRetirementOperation>> {
  const groups = new Map<string, Readonly<ValidatedSourceRetirementOperation>>();
  for (const groupId of Array.from(groupIds).sort(compareOrdinal)) {
    const verified = loadIntegrityVerifiedSourceRetirementOperation(db, groupId);
    if (!verified) throw new Error(SCHEMA_RESET_REQUIRED);
    groups.set(groupId, verified);
  }
  return groups;
}

/** Reload and verify all four committed child sets for one immutable operation. */
export function loadVerifiedSourceRetirementOperationInTransaction(
  db: MemoryDb,
  retirementGroupId: string,
): Readonly<ValidatedSourceRetirementOperation> | null {
  assertMemoryTransactionActive(TRANSACTION_REQUIRED);
  if (!isExactMemoryProvenanceId(retirementGroupId)) {
    throw new Error('memory_source_retirement_group_id_invalid');
  }
  return loadIntegrityVerifiedSourceRetirementOperation(db, retirementGroupId);
}

function insertSources(
  db: MemoryDb,
  table: 'memory_source_retirement_requests' | 'memory_retired_sources',
  retirementGroupId: string,
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
): void {
  for (const source of sources) {
    db.runSync(
      `INSERT INTO ${table}(
         retirement_group_id, memory_owner_id, memory_conversation_id,
         source_thread_id, task_id, source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      retirementGroupId,
      source.memoryOwnerId,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
      source.sourceKind,
      source.sourceId,
    );
  }
}

/** Persist one sealed operation. The caller owns the surrounding atomic transaction. */
export function persistSourceRetirementOperationInTransaction(
  db: MemoryDb,
  input: unknown,
): Readonly<ValidatedSourceRetirementOperation> {
  assertMemoryTransactionActive(TRANSACTION_REQUIRED);
  const operation = validateSourceRetirementOperation(input);
  assertLocalOwner(db, operation.memoryOwnerId);
  const requested = operation.requestedSourcesCommitment;
  const closed = operation.closedSourcesCommitment;
  const contributions = operation.retiredContributionsCommitment;
  const facts = operation.retiredFactsCommitment;
  return runMemoryDatabaseSavepoint(db, (database) => {
    database.runSync(
      `INSERT INTO memory_source_retirement_groups(
         id, memory_owner_id, reason, retired_at,
         requested_source_set_version, requested_source_set_count, requested_source_set_sha256,
         closed_source_set_version, closed_source_set_count, closed_source_set_sha256,
         retired_contribution_set_version, retired_contribution_set_count,
         retired_contribution_set_sha256,
         retired_fact_set_version, retired_fact_set_count, retired_fact_set_sha256
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.retirementGroupId,
      operation.memoryOwnerId,
      operation.reason,
      operation.retiredAt,
      requested.version,
      requested.count,
      requested.sha256,
      closed.version,
      closed.count,
      closed.sha256,
      contributions.version,
      contributions.count,
      contributions.sha256,
      facts.version,
      facts.count,
      facts.sha256,
    );
    insertSources(
      database,
      'memory_source_retirement_requests',
      operation.retirementGroupId,
      operation.requestedSources,
    );
    insertSources(
      database,
      'memory_retired_sources',
      operation.retirementGroupId,
      operation.closedSources,
    );
    for (const contributionId of operation.retiredContributionIds) {
      database.runSync(
        `INSERT INTO memory_retired_fact_contributions(contribution_id, retirement_group_id)
         VALUES (?, ?)`,
        contributionId,
        operation.retirementGroupId,
      );
    }
    for (const factId of operation.retiredFactIds) {
      database.runSync(
        'INSERT INTO memory_retired_facts(fact_id, retirement_group_id) VALUES (?, ?)',
        factId,
        operation.retirementGroupId,
      );
    }
    const persisted = loadVerifiedSourceRetirementOperationInTransaction(
      database,
      operation.retirementGroupId,
    );
    if (!persisted) throw new Error('memory_source_retirement_operation_not_persisted');
    return persisted;
  });
}

/** Resolve exact monotonic source fences without broadening across any tuple field. */
export function loadExistingSourceRetirementFencesInTransaction(
  db: MemoryDb,
  sourcesInput: unknown,
): ReadonlyArray<Readonly<ExistingSourceRetirementFence>> {
  assertMemoryTransactionActive(TRANSACTION_REQUIRED);
  const ownerId = getLocalMemoryVaultOwnerId(db);
  const sources = requireCanonicalRetirementSources(sourcesInput, {
    expectedOwnerId: ownerId,
    minimum: 0,
    limit: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
    code: 'memory_source_retirement_lookup_sources_invalid',
  });
  const grouped = new Map<string, PersistedExactMemorySourceIdentity[]>();
  for (const source of sources) {
    const key = JSON.stringify([
      source.memoryOwnerId,
      source.memoryConversationId,
      source.sourceThreadId,
      source.taskId,
    ]);
    const group = grouped.get(key) ?? [];
    group.push(source);
    grouped.set(key, group);
  }

  const found = new Map<string, ExistingSourceRetirementFence>();
  for (const group of grouped.values()) {
    const scope = group[0]!;
    for (let offset = 0; offset < group.length; offset += LOOKUP_SOURCE_BATCH_SIZE) {
      const batch = group.slice(offset, offset + LOOKUP_SOURCE_BATCH_SIZE);
      const predicates = batch.map(() => '(source_kind = ? AND source_id = ?)').join(' OR ');
      const rows = db.getAllSync<PersistedSourceRow>(
        `SELECT retirement_group_id, memory_owner_id, memory_conversation_id,
                source_thread_id, task_id, source_kind, source_id
           FROM memory_retired_sources
          WHERE memory_owner_id = ? AND memory_conversation_id = ?
            AND source_thread_id = ? AND task_id = ?
            AND (${predicates})`,
        scope.memoryOwnerId,
        scope.memoryConversationId,
        scope.sourceThreadId,
        scope.taskId,
        ...batch.flatMap((source) => [source.sourceKind, source.sourceId]),
      );
      for (const row of rows) {
        const source = rowToSource(row);
        found.set(sourceKey(source), {
          retirementGroupId: row.retirement_group_id,
          source: Object.freeze(source),
        });
      }
    }
  }
  const verifiedGroups = requireVerifiedGroups(
    db,
    new Set(Array.from(found.values()).map((entry) => entry.retirementGroupId)),
  );
  const verifiedSourceKeys = new Map(
    Array.from(verifiedGroups, ([groupId, verified]) => [
      groupId,
      new Set(verified.closedSources.map(sourceKey)),
    ]),
  );
  for (const entry of found.values()) {
    if (!verifiedSourceKeys.get(entry.retirementGroupId)?.has(sourceKey(entry.source))) {
      throw new Error(SCHEMA_RESET_REQUIRED);
    }
  }
  return Object.freeze(
    Array.from(found.values()).sort((left, right) => compareSources(left.source, right.source)),
  );
}

/** Load the bounded intersection with the immutable retired-contribution ledger. */
export function loadPriorRetiredFactContributionsInTransaction(
  db: MemoryDb,
  contributionIdsInput: unknown,
): ReadonlyArray<Readonly<PriorRetiredFactContribution>> {
  assertMemoryTransactionActive(TRANSACTION_REQUIRED);
  const contributionIds = requireCanonicalRetirementContributionIds(
    contributionIdsInput,
    'memory_source_retirement_lookup_contribution_ids_invalid',
    LOOKUP_CONTRIBUTION_LIMIT,
  );
  const rows: RetiredContributionRow[] = [];
  for (let offset = 0; offset < contributionIds.length; offset += LOOKUP_CONTRIBUTION_BATCH_SIZE) {
    const batch = contributionIds.slice(offset, offset + LOOKUP_CONTRIBUTION_BATCH_SIZE);
    rows.push(
      ...db.getAllSync<RetiredContributionRow>(
        `SELECT contribution_id, retirement_group_id
           FROM memory_retired_fact_contributions
          WHERE contribution_id IN (${batch.map(() => '?').join(', ')})`,
        ...batch,
      ),
    );
  }
  const verifiedGroups = requireVerifiedGroups(
    db,
    new Set(rows.map((row) => row.retirement_group_id)),
  );
  const verifiedContributionIds = new Map(
    Array.from(verifiedGroups, ([groupId, verified]) => [
      groupId,
      new Set(verified.retiredContributionIds),
    ]),
  );
  for (const row of rows) {
    if (!verifiedContributionIds.get(row.retirement_group_id)?.has(row.contribution_id)) {
      throw new Error(SCHEMA_RESET_REQUIRED);
    }
  }
  return Object.freeze(
    rows
      .map((row) =>
        Object.freeze({
          retirementGroupId: row.retirement_group_id,
          contributionId: row.contribution_id,
        }),
      )
      .sort((left, right) => compareOrdinal(left.contributionId, right.contributionId)),
  );
}
