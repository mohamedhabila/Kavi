import type { MemoryFact } from '../facts/types';

const UI_INVENTORY_RETRIEVAL_FIELDS = [
  'fieldLabels',
  'fields',
  'textEntryControls',
  'searchControls',
  'sections',
  'controlNames',
  'labelValues',
  'tables',
  'url',
  'sourceRunId',
  'stateIndex',
  'nodeCount',
  'controlCount',
  'textEntryCount',
  'searchControlCount',
] as const;

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

function compactJsonFields(
  value: Record<string, unknown>,
  fields: ReadonlyArray<string>,
): string {
  const compact: Record<string, unknown> = {};
  for (const field of fields) {
    const entry = value[field];
    if (entry !== undefined && entry !== null && entry !== '') compact[field] = entry;
  }
  return JSON.stringify(Object.keys(compact).length > 0 ? compact : value);
}

export function retrievalObjectTextForFact(fact: MemoryFact): string {
  if (fact.memoryKind !== 'ui_inventory') return fact.objectText;
  const parsed = parseJsonRecord(fact.objectText);
  return parsed ? compactJsonFields(parsed, UI_INVENTORY_RETRIEVAL_FIELDS) : fact.objectText;
}

export function retrievalTextForFact(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${retrievalObjectTextForFact(fact)} ${
    fact.sourceSummary ?? ''
  }`;
}
