import type { MemoryFactKind } from './facts/types';

export const SURFACE_PROMPT_FIELDS = [
  'url',
  'goal',
  'action',
  'thought',
  'outcome',
  'trajectoryOutcome',
  'sourceRunId',
  'stateIndex',
] as const;

export const UI_AFFORDANCE_FACT_FIELDS = [
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

export const UI_FIELD_FACT_FIELDS = [
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

export const UI_FILTER_STATE_FACT_FIELDS = [
  'label',
  'value',
  'sourceIndex',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;

export const UI_INVENTORY_PROMPT_FIELDS = [
  'goal',
  'trajectoryOutcome',
  'domain',
  'environment',
  'fieldLabels',
  'fields',
  'textEntryControls',
  'searchControls',
  'sections',
  'labelValues',
  'tables',
  'controlNames',
  'action',
  'thought',
  'previousAction',
  'previousUrl',
  'previousStateIndex',
  'previousControlNames',
  'url',
  'sourceRunId',
  'stateIndex',
  'nodeCount',
  'controlCount',
  'textEntryCount',
  'searchControlCount',
] as const;

export const UI_INVENTORY_RETRIEVAL_FIELDS = [
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

export const UI_INVENTORY_PRIORITY_FIELDS = [
  'sections',
  'controlNames',
  'fieldLabels',
  'fields',
  'textEntryControls',
  'searchControls',
  'labelValues',
  'action',
  'thought',
  'previousAction',
  'previousUrl',
  'previousControlNames',
] as const;

export const UI_FIELD_PRIORITY_FIELDS = [
  'label',
  'role',
  'controlName',
  'value',
  'options',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;

export const UI_AFFORDANCE_PRIORITY_FIELDS = [
  'role',
  'name',
  'label',
  'contextLabels',
  'value',
  'options',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;

export const UI_FILTER_STATE_PRIORITY_FIELDS = [
  'label',
  'value',
  'url',
  'sourceRunId',
  'stateIndex',
] as const;

export const UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS = [
  'role',
  'controlName',
  'name',
  'type',
  'required',
] as const;
export const UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS = ['role', 'name', 'controlName', 'type'] as const;
export const UI_INVENTORY_SEARCH_SHAPE_FIELDS = ['role', 'name', 'controlName', 'type'] as const;
export const UI_INVENTORY_LABEL_VALUE_SHAPE_FIELDS = ['label', 'role', 'name'] as const;
export const UI_INVENTORY_SECTION_SHAPE_FIELDS = [
  'label',
  'controlNames',
  'fieldLabels',
] as const;
export const UI_INVENTORY_TABLE_SHAPE_FIELDS = ['label', 'columns'] as const;

export const UI_INVENTORY_TRANSITION_PREVIOUS_FIELDS = [
  'previousAction',
  'previousControlNames',
  'previousUrl',
] as const;

export const UI_INVENTORY_TRANSITION_CURRENT_FIELDS = [
  'sections',
  'controlNames',
  'fieldLabels',
  'fields',
  'textEntryControls',
  'searchControls',
  'labelValues',
  'tables',
  'url',
] as const;

const PROMPT_FIELDS_BY_KIND: Partial<Record<MemoryFactKind, ReadonlyArray<string>>> = {
  surface_schema: SURFACE_PROMPT_FIELDS,
  ui_affordance: UI_AFFORDANCE_FACT_FIELDS,
  ui_field: UI_FIELD_FACT_FIELDS,
  ui_filter_state: UI_FILTER_STATE_FACT_FIELDS,
  ui_inventory: UI_INVENTORY_PROMPT_FIELDS,
};

const RETRIEVAL_FIELDS_BY_KIND: Partial<Record<MemoryFactKind, ReadonlyArray<string>>> = {
  ui_inventory: UI_INVENTORY_RETRIEVAL_FIELDS,
  ui_field: UI_FIELD_FACT_FIELDS,
  ui_affordance: UI_AFFORDANCE_FACT_FIELDS,
  ui_filter_state: UI_FILTER_STATE_FACT_FIELDS,
};

const PRIORITY_FIELDS_BY_KIND: Partial<Record<MemoryFactKind, ReadonlyArray<string>>> = {
  surface_schema: UI_INVENTORY_PRIORITY_FIELDS,
  ui_inventory: UI_INVENTORY_PRIORITY_FIELDS,
  ui_field: UI_FIELD_PRIORITY_FIELDS,
  ui_affordance: UI_AFFORDANCE_PRIORITY_FIELDS,
  ui_filter_state: UI_FILTER_STATE_PRIORITY_FIELDS,
};

export function promptFieldsForMemoryKind(
  memoryKind: MemoryFactKind,
): ReadonlyArray<string> | null {
  return PROMPT_FIELDS_BY_KIND[memoryKind] ?? null;
}

export function retrievalFieldsForMemoryKind(
  memoryKind: MemoryFactKind,
): ReadonlyArray<string> | null {
  return RETRIEVAL_FIELDS_BY_KIND[memoryKind] ?? null;
}

export function priorityFieldsForMemoryKind(
  memoryKind: MemoryFactKind,
): ReadonlyArray<string> | null {
  return PRIORITY_FIELDS_BY_KIND[memoryKind] ?? null;
}

export function isUiSurfaceMemoryKind(memoryKind: MemoryFactKind): boolean {
  return Boolean(PROMPT_FIELDS_BY_KIND[memoryKind]);
}
