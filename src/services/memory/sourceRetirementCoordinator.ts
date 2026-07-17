import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { clearEmbeddingCache } from './embeddings';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { newId } from './schemaValues';
import {
  assertNoActiveContributionForClosedSourcesInTransaction,
  loadCompleteActiveRetirementGraphInTransaction,
} from './sourceRetirementActiveGraph';
import {
  type ExactSourceRetirementResult,
  validateExactSourceRetirementInput,
} from './sourceRetirementCoordinatorTypes';
import { applySourceRetirementFactPlanInTransaction } from './sourceRetirementFactMaterializer';
import { planExactSourceRetirement } from './sourceRetirementPlanner';
import {
  compareSourceRetirementOrdinal,
  sourceRetirementIdentityKey,
} from './sourceRetirementPlanningGraph';
import {
  loadExistingSourceRetirementFencesInTransaction,
  loadVerifiedSourceRetirementOperationInTransaction,
  persistSourceRetirementOperationInTransaction,
} from './sourceRetirementStore';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import type { MemoryDatabase } from './access/schemaGuard';
import { advanceRestrictiveMemoryAuthorityInTransaction } from './memoryAuthority';

const SOURCE_FENCE_PAGE_SIZE = 256;
const LEDGER_PROBE_PAGE_SIZE = 128;

function fail(code: string): never {
  throw new Error(code);
}

function loadFences(
  db: MemoryDatabase,
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
) {
  const fences = [];
  for (let offset = 0; offset < sources.length; offset += SOURCE_FENCE_PAGE_SIZE) {
    fences.push(
      ...loadExistingSourceRetirementFencesInTransaction(
        db,
        sources.slice(offset, offset + SOURCE_FENCE_PAGE_SIZE),
      ),
    );
  }
  return fences;
}

function requireSafeRetirementClock(input: {
  retiredAt: number;
  retiredContributionIds: ReadonlyArray<string>;
  activeAggregates: ReturnType<typeof loadCompleteActiveRetirementGraphInTransaction>;
}): void {
  const byId = new Map(
    input.activeAggregates.map((aggregate) => [aggregate.contributionId, aggregate]),
  );
  for (const contributionId of input.retiredContributionIds) {
    const aggregate = byId.get(contributionId);
    if (!aggregate) fail('memory_source_retirement_active_graph_incomplete');
    if (aggregate.contributedAt > input.retiredAt) {
      fail('memory_source_retirement_clock_regression');
    }
  }
}

function assertLedgerRows(input: {
  db: MemoryDatabase;
  table: 'memory_retired_fact_contributions' | 'memory_retired_facts';
  idColumn: 'contribution_id' | 'fact_id';
  ids: ReadonlyArray<string>;
  retirementGroupId: string;
}): void {
  let found = 0;
  let parents = 0;
  for (let offset = 0; offset < input.ids.length; offset += LEDGER_PROBE_PAGE_SIZE) {
    const page = input.ids.slice(offset, offset + LEDGER_PROBE_PAGE_SIZE);
    const row = input.db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${input.table}
        WHERE ${input.idColumn} IN (${page.map(() => '?').join(', ')})
          AND retirement_group_id = ?`,
      ...page,
      input.retirementGroupId,
    );
    found += row?.count ?? 0;
    const parentTable =
      input.table === 'memory_retired_fact_contributions'
        ? 'memory_fact_contributions'
        : 'memory_facts';
    const parentIdColumn = input.table === 'memory_retired_fact_contributions' ? 'id' : 'id';
    const parentRow = input.db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM ${input.table} AS retired
         JOIN ${parentTable} AS parent ON parent.${parentIdColumn} = retired.${input.idColumn}
        WHERE retired.${input.idColumn} IN (${page.map(() => '?').join(', ')})
          AND retired.retirement_group_id = ?`,
      ...page,
      input.retirementGroupId,
    );
    parents += parentRow?.count ?? 0;
  }
  if (found !== input.ids.length || parents !== input.ids.length) {
    fail('memory_source_retirement_ledger_postcondition_invalid');
  }
}

function exactIdsMatch(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactSourcesMatch(
  left: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
  right: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (source, index) =>
        sourceRetirementIdentityKey(source) === sourceRetirementIdentityKey(right[index]!),
    )
  );
}

function oneNotificationConversation(
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>,
): string | null {
  const conversationIds = Array.from(
    new Set(sources.map((source) => source.memoryConversationId)),
  ).sort(compareSourceRetirementOrdinal);
  return conversationIds.length === 1 ? conversationIds[0]! : null;
}

function alreadyRetiredResult(requestedSourceCount: number): ExactSourceRetirementResult {
  return Object.freeze({
    status: 'already_retired',
    requestedSourceCount,
    closedSourceCount: 0,
    retiredContributionCount: 0,
    tombstonedFactCount: 0,
    reactivatedFactCount: 0,
    rematerializedFactCount: 0,
  });
}

/**
 * Retire exact source tuples through one caller-owned atomic boundary.
 * User-authored text is never inspected; only committed identities and causal edges participate.
 */
export function retireExactMemorySources(input: unknown): ExactSourceRetirementResult {
  return runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const validated = validateExactSourceRetirementInput(input, memoryOwnerId);
    const priorFenceKeys = new Set(
      loadFences(db, validated.requestedSources).map(({ source }) =>
        sourceRetirementIdentityKey(source),
      ),
    );
    const newlyRequested = validated.requestedSources.filter(
      (source) => !priorFenceKeys.has(sourceRetirementIdentityKey(source)),
    );
    if (newlyRequested.length === 0) {
      return alreadyRetiredResult(validated.requestedSources.length);
    }

    const activeAggregates = loadCompleteActiveRetirementGraphInTransaction(db, memoryOwnerId);
    const plan = planExactSourceRetirement({
      requestedSources: newlyRequested,
      activeAggregates,
    });
    const priorClosedFences = loadFences(db, plan.closedSources);
    if (priorClosedFences.length > 0) {
      fail('memory_source_retirement_closed_source_already_fenced');
    }
    requireSafeRetirementClock({
      retiredAt: validated.retiredAt,
      retiredContributionIds: plan.newlyRetiredContributionIds,
      activeAggregates,
    });

    const retirementGroupId = validated.retirementGroupId ?? newId('retirement');
    const retiredFactIds = plan.tombstones
      .map(({ factId }) => factId)
      .sort(compareSourceRetirementOrdinal);
    const persisted = persistSourceRetirementOperationInTransaction(db, {
      retirementGroupId,
      memoryOwnerId,
      reason: validated.reason,
      retiredAt: validated.retiredAt,
      requestedSources: plan.requestedSources,
      closedSources: plan.closedSources,
      retiredContributionIds: plan.newlyRetiredContributionIds,
      retiredFactIds,
    });
    if (
      persisted.retirementGroupId !== retirementGroupId ||
      persisted.memoryOwnerId !== memoryOwnerId ||
      persisted.reason !== validated.reason ||
      persisted.retiredAt !== validated.retiredAt ||
      !exactSourcesMatch(persisted.requestedSources, plan.requestedSources) ||
      !exactSourcesMatch(persisted.closedSources, plan.closedSources) ||
      !exactIdsMatch(persisted.retiredContributionIds, plan.newlyRetiredContributionIds) ||
      !exactIdsMatch(persisted.retiredFactIds, retiredFactIds)
    ) {
      fail('memory_source_retirement_operation_postcondition_invalid');
    }

    applySourceRetirementFactPlanInTransaction({
      db,
      memoryOwnerId,
      retiredAt: validated.retiredAt,
      activeAggregates,
      plan,
    });
    const verified = loadVerifiedSourceRetirementOperationInTransaction(db, retirementGroupId);
    if (!verified) fail('memory_source_retirement_operation_postcondition_invalid');
    const fences = loadFences(db, plan.closedSources);
    if (
      fences.length !== plan.closedSources.length ||
      fences.some((fence) => fence.retirementGroupId !== retirementGroupId)
    ) {
      fail('memory_source_retirement_source_fence_postcondition_invalid');
    }
    assertLedgerRows({
      db,
      table: 'memory_retired_fact_contributions',
      idColumn: 'contribution_id',
      ids: plan.newlyRetiredContributionIds,
      retirementGroupId,
    });
    assertLedgerRows({
      db,
      table: 'memory_retired_facts',
      idColumn: 'fact_id',
      ids: retiredFactIds,
      retirementGroupId,
    });
    assertNoActiveContributionForClosedSourcesInTransaction(db, plan.closedSources);
    advanceRestrictiveMemoryAuthorityInTransaction(db, memoryOwnerId);

    const notificationConversation = oneNotificationConversation(plan.closedSources);
    runAfterMemoryTransactionCommit(() => {
      clearEmbeddingCache();
      notifyStructuredMemoryChanged(notificationConversation);
    });
    return Object.freeze({
      status: 'retired',
      retirementGroupId,
      requestedSourceCount: validated.requestedSources.length,
      closedSourceCount: plan.closedSources.length,
      retiredContributionCount: plan.newlyRetiredContributionIds.length,
      tombstonedFactCount: plan.tombstones.length,
      reactivatedFactCount: plan.reactivations.length,
      rematerializedFactCount: plan.rematerializations.length,
    });
  });
}
