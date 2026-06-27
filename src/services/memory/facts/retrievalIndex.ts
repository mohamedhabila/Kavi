import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { collectJsonStrings, parseJsonRecord } from '../factJson';
import { retrievalTextForFact } from '../ranking/factText';
import { tokenizeLexicalUnits } from '../ranking/lexical';
import { priorityFieldsForMemoryKind } from '../uiFactFields';
import type { MemoryFact } from './types';

type TermInsertValue = string | number | null;

const MAX_TERMS_PER_FACT = 192;
const MAX_PRIORITY_UI_TERMS_PER_FACT = 96;
const MAX_PRIORITY_VALUE_DEPTH = 4;

function termWeight(unit: string): number {
  const length = Array.from(unit).length;
  return 1 + Math.min(length, 24) / 24;
}

function priorityUiTermTexts(fact: MemoryFact): string[] {
  const fields = priorityFieldsForMemoryKind(fact.memoryKind);
  if (!fields) return [];
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return [];
  const values: string[] = [];
  for (const field of fields) {
    collectJsonStrings(parsed[field], values, 0, MAX_PRIORITY_VALUE_DEPTH);
    collectJsonStrings(fact.attributes[field], values, 0, MAX_PRIORITY_VALUE_DEPTH);
  }
  return values;
}

function sortedGeneralTerms(fact: MemoryFact): string[] {
  return Array.from(tokenizeLexicalUnits(retrievalTextForFact(fact)))
    .sort((left, right) => {
      const rightLength = Array.from(right).length;
      const leftLength = Array.from(left).length;
      if (rightLength !== leftLength) return rightLength - leftLength;
      return left.localeCompare(right);
    });
}

function rankedTermsForFact(fact: MemoryFact): string[] {
  const priorityTerms = Array.from(
    new Set(priorityUiTermTexts(fact).flatMap((value) => Array.from(tokenizeLexicalUnits(value)))),
  ).slice(0, MAX_PRIORITY_UI_TERMS_PER_FACT);
  const selected = new Set(priorityTerms);
  for (const term of sortedGeneralTerms(fact)) {
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
