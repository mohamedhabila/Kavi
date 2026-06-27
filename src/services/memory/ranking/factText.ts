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
  'action',
  'thought',
  'sourceRunId',
  'stateIndex',
  'previousAction',
  'previousUrl',
  'previousStateIndex',
  'previousControlNames',
  'nodeCount',
  'controlCount',
  'textEntryCount',
  'searchControlCount',
] as const;
const UI_FIELD_RETRIEVAL_FIELDS = [
  'order',
  'label',
  'role',
  'controlName',
  'value',
  'options',
  'controlIndex',
  'nodeId',
  'required',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;
const UI_AFFORDANCE_RETRIEVAL_FIELDS = [
  'index',
  'nodeId',
  'role',
  'name',
  'label',
  'contextLabels',
  'value',
  'options',
  'attributes',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;
const UI_FILTER_STATE_RETRIEVAL_FIELDS = [
  'label',
  'value',
  'sourceIndex',
  'url',
  'sourceRunId',
  'stateIndex',
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
  let fields: ReadonlyArray<string> | null = null;
  if (fact.memoryKind === 'ui_inventory') fields = UI_INVENTORY_RETRIEVAL_FIELDS;
  if (fact.memoryKind === 'ui_field') fields = UI_FIELD_RETRIEVAL_FIELDS;
  if (fact.memoryKind === 'ui_affordance') fields = UI_AFFORDANCE_RETRIEVAL_FIELDS;
  if (fact.memoryKind === 'ui_filter_state') fields = UI_FILTER_STATE_RETRIEVAL_FIELDS;
  if (!fields) return fact.objectText;
  const parsed = parseJsonRecord(fact.objectText);
  return parsed ? compactJsonFields(parsed, fields) : fact.objectText;
}

export function retrievalTextForFact(fact: MemoryFact): string {
  return `${fact.subjectId} ${fact.predicate} ${retrievalObjectTextForFact(fact)} ${
    fact.sourceSummary ?? ''
  }`;
}
