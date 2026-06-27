import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { retrievalTextForFact } from '../ranking/factText';
import { tokenizeLexicalUnits } from '../ranking/lexical';
import { rowToFact, type FactRow, type MemoryFact } from './types';

type TermInsertValue = string | number | null;

const MAX_TERMS_PER_FACT = 192;
const BACKFILL_BATCH_LIMIT = 256;

function termWeight(unit: string): number {
  const length = Array.from(unit).length;
  return 1 + Math.min(length, 24) / 24;
}

function rankedTermsForFact(fact: MemoryFact): string[] {
  return Array.from(tokenizeLexicalUnits(retrievalTextForFact(fact)))
    .sort((left, right) => {
      const rightLength = Array.from(right).length;
      const leftLength = Array.from(left).length;
      if (rightLength !== leftLength) return rightLength - leftLength;
      return left.localeCompare(right);
    })
    .slice(0, MAX_TERMS_PER_FACT);
}

export function deleteFactRetrievalTerms(factId: string): void {
  if (!factId) return;
  getSchemaReadyMemoryDb().runSync('DELETE FROM memory_fact_terms WHERE fact_id = ?', factId);
}

export function replaceFactRetrievalTerms(fact: MemoryFact): void {
  const db = getSchemaReadyMemoryDb();
  const terms = rankedTermsForFact(fact);
  db.runSync('DELETE FROM memory_fact_terms WHERE fact_id = ?', fact.id);
  if (terms.length === 0) return;

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
}

export function ensureFactRetrievalIndexCoverage(limit = BACKFILL_BATCH_LIMIT): number {
  const db = getSchemaReadyMemoryDb();
  const rows = db.getAllSync<FactRow>(
    `SELECT f.*
       FROM memory_facts f
      WHERE f.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM memory_fact_terms t WHERE t.fact_id = f.id LIMIT 1
        )
      ORDER BY f.updated_at DESC
      LIMIT ?`,
    Math.max(1, Math.min(limit, BACKFILL_BATCH_LIMIT)),
  );
  for (const row of rows) {
    replaceFactRetrievalTerms(rowToFact(row));
  }
  return rows.length;
}
