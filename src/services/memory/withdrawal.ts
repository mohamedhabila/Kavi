import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { checkpointMemoryDatabaseAfterSensitiveDeletion } from './database';
import type { VerifiedFactContributionAggregate } from './factContributionAggregateTypes';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import type { FactRow } from './facts/types';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import { purgeRetiredCausalPayloadsInTransaction } from './retiredCausalPayloadPurge';
import { newId } from './schema';
import { loadCompleteActiveRetirementGraphInTransaction } from './sourceRetirementActiveGraph';
import { retireExactMemorySources } from './sourceRetirementCoordinator';
import {
  compareSourceRetirementOrdinal,
  sourceRetirementIdentityKey,
} from './sourceRetirementPlanningGraph';
import { loadVerifiedSourceRetirementOperationInTransaction } from './sourceRetirementStore';
import { cleanupRetiredMemoryArtifactsInTransaction } from './withdrawalCascade';
import { collectMemoryWithdrawalLineage, normalizeWithdrawalOpaqueId } from './withdrawalLineage';
import {
  EMPTY_MEMORY_WITHDRAWAL_COUNTS,
  type MemoryWithdrawalReceipt,
  type WithdrawMemoryFactResult,
} from './withdrawalTypes';

interface RetiredFactRow {
  retirement_group_id: string;
}

function fail(code: string): never {
  throw new Error(code);
}

function alreadyWithdrawnReceipt(input: {
  retirementGroupId: string;
  factId: string;
  retiredAt: number;
}): MemoryWithdrawalReceipt {
  return {
    status: 'already_withdrawn',
    withdrawalId: input.retirementGroupId,
    factId: input.factId,
    withdrawnAt: input.retiredAt,
    counts: { ...EMPTY_MEMORY_WITHDRAWAL_COUNTS },
  };
}

function contributionSources(
  aggregate: Readonly<VerifiedFactContributionAggregate>,
): PersistedExactMemorySourceIdentity[] {
  return aggregate.sourceAliases.map((alias) => ({
    memoryOwnerId: aggregate.memoryOwnerId,
    memoryConversationId: aggregate.sourceScope.memoryConversationId,
    sourceThreadId: aggregate.sourceScope.sourceThreadId,
    taskId: aggregate.sourceScope.taskId,
    sourceKind: alias.sourceKind,
    sourceId: alias.sourceId,
  }));
}

function activeSourcesForFact(
  activeGraph: ReadonlyArray<Readonly<VerifiedFactContributionAggregate>>,
  factId: string,
): ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>> {
  const sources = new Map<string, PersistedExactMemorySourceIdentity>();
  for (const aggregate of activeGraph) {
    if (aggregate.factId !== factId) continue;
    for (const source of contributionSources(aggregate)) {
      sources.set(sourceRetirementIdentityKey(source), source);
    }
  }
  if (sources.size === 0) fail('memory_fact_withdrawal_provenance_missing');
  return Object.freeze(
    Array.from(sources.values()).sort((left, right) => {
      const leftKey = sourceRetirementIdentityKey(left);
      const rightKey = sourceRetirementIdentityKey(right);
      return compareSourceRetirementOrdinal(leftKey, rightKey);
    }),
  );
}

function verifiedPriorWithdrawal(factId: string): Readonly<MemoryWithdrawalReceipt> | null {
  const db = getSchemaReadyMemoryDb();
  const prior = db.getFirstSync<RetiredFactRow>(
    'SELECT retirement_group_id FROM memory_retired_facts WHERE fact_id = ? LIMIT 1',
    factId,
  );
  if (!prior) return null;
  const operation = loadVerifiedSourceRetirementOperationInTransaction(
    db,
    prior.retirement_group_id,
  );
  if (!operation || !operation.retiredFactIds.includes(factId)) {
    fail('memory_source_retirement_schema_reset_required');
  }
  return alreadyWithdrawnReceipt({
    retirementGroupId: operation.retirementGroupId,
    factId,
    retiredAt: operation.retiredAt,
  });
}

/**
 * Forget one fact by retiring every active, integrity-verified causal source that supports it.
 * The immutable ledger and all derived-artifact cleanup commit through the same transaction.
 */
export function withdrawMemoryFact(factId: string, now = Date.now()): WithdrawMemoryFactResult {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError('withdrawal_timestamp_invalid');
  }
  const normalizedFactId = normalizeWithdrawalOpaqueId(factId);
  if (!normalizedFactId) return { status: 'not_found' };

  return runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const prior = verifiedPriorWithdrawal(normalizedFactId);
    if (prior) return { status: 'already_withdrawn' as const, receipt: prior };

    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const target = db.getFirstSync<FactRow>(
      `SELECT * FROM memory_facts
        WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL
        LIMIT 1`,
      normalizedFactId,
      memoryOwnerId,
    );
    if (!target) return { status: 'not_found' as const };

    const requestedSources = activeSourcesForFact(
      loadCompleteActiveRetirementGraphInTransaction(db, memoryOwnerId),
      normalizedFactId,
    );
    const retirementGroupId = newId('retirement');
    const retirement = retireExactMemorySources({
      reason: 'fact_withdrawal',
      requestedSources,
      retiredAt: now,
      retirementGroupId,
    });
    if (retirement.status !== 'retired' || retirement.retirementGroupId !== retirementGroupId) {
      fail('memory_fact_withdrawal_retirement_invalid');
    }
    const operation = loadVerifiedSourceRetirementOperationInTransaction(db, retirementGroupId);
    if (!operation || !operation.retiredFactIds.includes(normalizedFactId)) {
      fail('memory_fact_withdrawal_target_not_retired');
    }
    const fencedSources = operation.closedSources.map((source) => ({
      memoryConversationId: source.memoryConversationId,
      sourceThreadId: source.sourceThreadId,
      taskId: source.taskId,
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
    }));
    const lineage = collectMemoryWithdrawalLineage(db, target, {
      factIds: operation.retiredFactIds,
      scopedSources: fencedSources,
    });
    const cleanup = cleanupRetiredMemoryArtifactsInTransaction(db, lineage, fencedSources, now);
    purgeRetiredCausalPayloadsInTransaction(db, {
      retiredContributionIds: operation.retiredContributionIds,
      retiredFactIds: operation.retiredFactIds,
    });
    runAfterMemoryTransactionCommit(checkpointMemoryDatabaseAfterSensitiveDeletion);

    return {
      status: 'withdrawn' as const,
      receipt: {
        status: 'withdrawn' as const,
        withdrawalId: retirementGroupId,
        factId: normalizedFactId,
        withdrawnAt: now,
        counts: cleanup.counts,
      },
    };
  });
}
