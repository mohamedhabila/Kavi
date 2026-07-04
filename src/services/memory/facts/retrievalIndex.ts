import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
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
    return left.localeCompare(right);
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
