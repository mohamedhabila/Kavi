import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { retrievalTextForFact } from '../ranking/factText';
import { tokenizeLexicalUnits } from '../ranking/lexical';
import type { MemoryFact } from './types';

type TermInsertValue = string | number | null;

const MAX_TERMS_PER_FACT = 192;
const MAX_PRIORITY_UI_TERMS_PER_FACT = 96;
const MAX_PRIORITY_VALUE_DEPTH = 4;
const UI_PRIORITY_FIELDS = [
  'sections',
  'controlNames',
  'fieldLabels',
  'fields',
  'textEntryControls',
  'searchControls',
  'labelValues',
] as const;

function termWeight(unit: string): number {
  const length = Array.from(unit).length;
  return 1 + Math.min(length, 24) / 24;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > MAX_PRIORITY_VALUE_DEPTH) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, output, depth + 1);
    }
  }
}

function priorityUiTermTexts(fact: MemoryFact): string[] {
  if (
    fact.memoryKind !== 'ui_inventory' &&
    fact.memoryKind !== 'ui_affordance' &&
    fact.memoryKind !== 'ui_field' &&
    fact.memoryKind !== 'ui_filter_state' &&
    fact.memoryKind !== 'surface_schema'
  ) {
    return [];
  }
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return [];
  const values: string[] = [];
  for (const field of UI_PRIORITY_FIELDS) {
    collectStrings(parsed[field], values);
    collectStrings(fact.attributes[field], values);
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
