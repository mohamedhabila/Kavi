import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import {
  runAfterMemoryTransactionCommit,
  runMemoryTransaction,
} from './access/transaction';
import { clearEmbeddingCache, getEmbeddingCacheEntryCount } from './embeddings';
import type { FactRow } from './facts/types';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { executeMemoryWithdrawalCascade } from './withdrawalCascade';
import { collectMemoryWithdrawalLineage, normalizeWithdrawalOpaqueId } from './withdrawalLineage';
import { assertMemoryWithdrawalHasNoResiduals } from './withdrawalResidualProbe';
import {
  EMPTY_MEMORY_WITHDRAWAL_COUNTS,
  type MemoryWithdrawalReceipt,
  type WithdrawMemoryFactResult,
} from './withdrawalTypes';

interface WithdrawalRow {
  id: string;
  target_fact_id: string;
  withdrawn_at: number;
}

function alreadyWithdrawnReceipt(row: WithdrawalRow, factId: string): MemoryWithdrawalReceipt {
  return {
    status: 'already_withdrawn',
    withdrawalId: row.id,
    factId,
    withdrawnAt: row.withdrawn_at,
    counts: { ...EMPTY_MEMORY_WITHDRAWAL_COUNTS },
  };
}

export function withdrawMemoryFact(factId: string, now = Date.now()): WithdrawMemoryFactResult {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError('withdrawal_timestamp_invalid');
  }
  const normalizedFactId = normalizeWithdrawalOpaqueId(factId);
  if (!normalizedFactId) return { status: 'not_found' };

  const transaction = runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const prior =
      db.getFirstSync<WithdrawalRow>(
        'SELECT * FROM memory_withdrawals WHERE target_fact_id = ? LIMIT 1',
        normalizedFactId,
      ) ??
      db.getFirstSync<WithdrawalRow>(
        `SELECT withdrawal.id, withdrawal.target_fact_id, withdrawal.withdrawn_at
           FROM memory_withdrawal_facts AS removed
           JOIN memory_withdrawals AS withdrawal ON withdrawal.id = removed.withdrawal_id
          WHERE removed.fact_id = ? LIMIT 1`,
        normalizedFactId,
      );
    if (prior) {
      return {
        result: {
          status: 'already_withdrawn' as const,
          receipt: alreadyWithdrawnReceipt(prior, normalizedFactId),
        },
        notificationScope: null,
        residualPlan: null,
      };
    }

    const target = db.getFirstSync<FactRow>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      normalizedFactId,
    );
    if (!target) {
      return {
        result: { status: 'not_found' as const },
        notificationScope: null,
        residualPlan: null,
      };
    }
    return executeMemoryWithdrawalCascade(
      db,
      normalizedFactId,
      collectMemoryWithdrawalLineage(db, target),
      now,
    );
  });

  let result: WithdrawMemoryFactResult = transaction.result;
  if (result.status === 'withdrawn') {
    const embeddingCacheEntries = clearEmbeddingCache();
    if (getEmbeddingCacheEntryCount() !== 0) {
      throw new Error('withdrawal_cache_residual_detected');
    }
    if (transaction.residualPlan) {
      assertMemoryWithdrawalHasNoResiduals(getSchemaReadyMemoryDb(), transaction.residualPlan);
    }
    result = {
      status: 'withdrawn',
      receipt: {
        ...result.receipt,
        counts: { ...result.receipt.counts, embeddingCacheEntries },
      },
    };
    runAfterMemoryTransactionCommit(() =>
      notifyStructuredMemoryChanged(transaction.notificationScope),
    );
  }
  return result;
}
