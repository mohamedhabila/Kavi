import { getSchemaReadyMemoryDb, type MemoryDatabase } from '../access/schemaGuard';
import { assertMemoryTransactionActive, runMemoryTransaction } from '../access/transaction';
import {
  advanceMemoryProjectionInTransaction,
  advanceRestrictiveMemoryAuthorityInTransaction,
} from '../memoryAuthority';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { retrievalTextForFact } from '../ranking/factText';
import { tokenizeLexicalUnits } from '../ranking/lexical';
import type { MemoryFact } from './types';

type TermInsertValue = string | number | null;

const MAX_TERMS_PER_FACT = 384;
const ENCOUNTER_ORDER_TERM_BUDGET = Math.floor(MAX_TERMS_PER_FACT / 2);

function termWeight(unit: string): number {
  const length = Array.from(unit).length;
  return 1 + Math.min(length, 24) / 24;
}

function termsInEncounterOrder(fact: MemoryFact): string[] {
  return Array.from(tokenizeLexicalUnits(retrievalTextForFact(fact)));
}

function termsBySpecificity(terms: ReadonlyArray<string>): string[] {
  return [...terms].sort((left, right) => {
    const rightLength = Array.from(right).length;
    const leftLength = Array.from(left).length;
    if (rightLength !== leftLength) return rightLength - leftLength;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function rankedTermsForFact(fact: MemoryFact): string[] {
  const terms = termsInEncounterOrder(fact);
  if (terms.length <= MAX_TERMS_PER_FACT) return terms;

  const selected = new Set<string>();
  for (const term of terms) {
    if (selected.size >= ENCOUNTER_ORDER_TERM_BUDGET) break;
    selected.add(term);
  }
  for (const term of termsBySpecificity(terms)) {
    if (selected.size >= MAX_TERMS_PER_FACT) break;
    selected.add(term);
  }
  return Array.from(selected);
}

export function deleteFactRetrievalTerms(factId: string): void {
  runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    if (deleteFactRetrievalTermsInTransaction(db, factId) > 0) {
      advanceRestrictiveMemoryAuthorityInTransaction(db, getLocalMemoryVaultOwnerId(db));
    }
  });
}

/** Caller owns the surrounding transaction and its matching authority revision. */
export function deleteFactRetrievalTermsInTransaction(db: MemoryDatabase, factId: string): number {
  assertMemoryTransactionActive('fact_retrieval_index_transaction_required');
  if (db !== getSchemaReadyMemoryDb()) throw new Error('fact_retrieval_index_database_mismatch');
  if (!factId) return 0;
  return db.runSync('DELETE FROM memory_fact_terms WHERE fact_id = ?', factId).changes ?? 0;
}

export function replaceFactRetrievalTerms(fact: MemoryFact): void {
  runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const mutation = replaceFactRetrievalTermsInTransaction(db, fact);
    if (mutation === 'restrictive') {
      advanceRestrictiveMemoryAuthorityInTransaction(db, getLocalMemoryVaultOwnerId(db));
    } else if (mutation === 'additive') {
      advanceMemoryProjectionInTransaction(db, getLocalMemoryVaultOwnerId(db));
    }
  });
}

type FactRetrievalTermMutation = 'none' | 'additive' | 'restrictive';

/** Caller owns the surrounding transaction and its matching authority revision. */
export function replaceFactRetrievalTermsInTransaction(
  db: MemoryDatabase,
  fact: MemoryFact,
): FactRetrievalTermMutation {
  assertMemoryTransactionActive('fact_retrieval_index_transaction_required');
  if (db !== getSchemaReadyMemoryDb()) throw new Error('fact_retrieval_index_database_mismatch');
  const terms = rankedTermsForFact(fact);
  const existing = db.getAllSync<{
    unit: string;
    source_run_id: string | null;
    memory_kind: string;
    weight: number;
  }>(
    `SELECT unit, source_run_id, memory_kind, weight
       FROM memory_fact_terms
      WHERE fact_id = ?
      ORDER BY unit`,
    fact.id,
  );
  const desired = terms
    .map((unit) => ({
      unit,
      sourceRunId: fact.sourceRunId,
      memoryKind: fact.memoryKind,
      weight: termWeight(unit),
    }))
    .sort((left, right) => (left.unit < right.unit ? -1 : left.unit > right.unit ? 1 : 0));
  if (
    existing.length === desired.length &&
    existing.every(
      (row, index) =>
        row.unit === desired[index].unit &&
        row.source_run_id === desired[index].sourceRunId &&
        row.memory_kind === desired[index].memoryKind &&
        row.weight === desired[index].weight,
    )
  ) {
    return 'none';
  }
  const desiredByUnit = new Map(desired.map((row) => [row.unit, row]));
  const onlyAddsTerms = existing.every((row) => {
    const next = desiredByUnit.get(row.unit);
    return (
      next !== undefined &&
      row.source_run_id === next.sourceRunId &&
      row.memory_kind === next.memoryKind &&
      row.weight === next.weight
    );
  });
  const mutation: FactRetrievalTermMutation = onlyAddsTerms ? 'additive' : 'restrictive';
  db.runSync('DELETE FROM memory_fact_terms WHERE fact_id = ?', fact.id);
  if (terms.length === 0) return mutation;

  const values: TermInsertValue[] = [];
  const placeholders = terms
    .map((unit) => {
      values.push(fact.id, unit, fact.sourceRunId, fact.memoryKind, termWeight(unit));
      return '(?, ?, ?, ?, ?)';
    })
    .join(', ');
  db.runSync(
    `INSERT OR REPLACE INTO memory_fact_terms
       (fact_id, unit, source_run_id, memory_kind, weight)
     VALUES ${placeholders}`,
    ...values,
  );
  return mutation;
}
