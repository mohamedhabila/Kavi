import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { assertMemoryTransactionActive } from '../access/transaction';
import { maxMemoryFactSensitivity } from '../memorySensitivityPolicy';
import { closedMemoryFactSensitivity, type MemoryFactSensitivity } from './applicabilityProvenance';
import {
  rowToFact,
  type FactRow,
  type MemoryFact,
  type RecordFactInput,
  type RecordFactResult,
} from './types';

export interface RecordFactWithContributionOptions {
  materializationInput?: RecordFactInput;
  superseded?: ReadonlyArray<MemoryFact>;
  sensitivityFloor?: MemoryFactSensitivity;
  expectedStatus?: RecordFactResult['status'];
}

export class FactContributionMaterializationConflict extends Error {
  constructor() {
    super('memory_fact_contribution_materialization_conflict');
  }
}

/** Apply a code-owned monotonic floor while a fact transaction is active. */
export function setFactSensitivityFloorInTransaction(
  factId: string,
  minimum: MemoryFactSensitivity,
): MemoryFact {
  assertMemoryTransactionActive('fact_sensitivity_floor_transaction_required');
  const db = getSchemaReadyMemoryDb();
  const row = db.getFirstSync<FactRow>('SELECT * FROM memory_facts WHERE id = ? LIMIT 1', factId);
  if (!row) throw new Error('memory_fact_sensitivity_target_missing');
  const existing = closedMemoryFactSensitivity(row.sensitivity) ?? 'restricted';
  const sensitivity = maxMemoryFactSensitivity(existing, minimum);
  if (sensitivity !== existing) {
    db.runSync('UPDATE memory_facts SET sensitivity = ? WHERE id = ?', sensitivity, factId);
  }
  return rowToFact({ ...row, sensitivity });
}
