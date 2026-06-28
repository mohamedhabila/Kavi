import type { MemoryFact } from '../facts/types';
import { parseJsonRecord } from '../factJson';
import {
  UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS,
  UI_INVENTORY_LABEL_VALUE_SHAPE_FIELDS,
  UI_INVENTORY_POPUP_SHAPE_FIELDS,
  UI_INVENTORY_SEARCH_SHAPE_FIELDS,
  UI_INVENTORY_SECTION_SHAPE_FIELDS,
  UI_INVENTORY_TABLE_SHAPE_FIELDS,
  UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS,
} from '../uiFactFields';

const SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN = 4;
const SOURCE_RUN_SUPPORT_MAX_SLOTS = 3;
const UI_SCHEMA_KEY_ARRAY_LIMIT = 48;

export interface ScoredSelectionFact {
  fact: MemoryFact;
  score: number;
  textScore: number;
  relevanceScore: number;
}

function stringArray(value: unknown, limit = UI_SCHEMA_KEY_ARRAY_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, limit);
}

function objectArrayShape(
  value: unknown,
  fields: ReadonlyArray<string>,
  limit = UI_SCHEMA_KEY_ARRAY_LIMIT,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) =>
      Object.fromEntries(
        fields
          .map((field) => [field, entry[field]] as const)
          .filter(([, fieldValue]) =>
            Array.isArray(fieldValue)
              ? fieldValue.length > 0
              : fieldValue !== undefined && fieldValue !== null && fieldValue !== '',
          ),
      ),
    )
    .filter((entry) => Object.keys(entry).length > 0)
    .slice(0, limit);
}

function scalarString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function canonicalSurfacePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const decodedPath = decodeURIComponent(url.pathname);
    return `${url.origin}${decodedPath.split('?')[0]}`;
  } catch {
    return decodeURIComponent(trimmed).split('?')[0].split('#')[0];
  }
}

function factStateIndex(fact: MemoryFact): string | number | null {
  const parsed = parseJsonRecord(fact.objectText);
  return (
    scalarString(fact.attributes.stateIndex, parsed?.stateIndex) ||
    scalarString(fact.attributes.state_index, parsed?.state_index) ||
    null
  );
}

function uiInventorySchemaKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_inventory') return null;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return null;
  const url = scalarString(fact.attributes.url, parsed.url);
  const fields = objectArrayShape(parsed.fields, UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS);
  const textEntryControls = objectArrayShape(
    parsed.textEntryControls,
    UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS,
  );
  const searchControls = objectArrayShape(
    parsed.searchControls,
    UI_INVENTORY_SEARCH_SHAPE_FIELDS,
  );
  const popupControls = objectArrayShape(
    parsed.popupControls,
    UI_INVENTORY_POPUP_SHAPE_FIELDS,
  );
  const hasFormShape =
    fields.length > 0 ||
    textEntryControls.length > 0 ||
    searchControls.length > 0 ||
    popupControls.length > 0;
  const key = {
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    url,
    controlNames: hasFormShape ? [] : stringArray(parsed.controlNames),
    fields,
    textEntryControls,
    searchControls,
    popupControls,
    labelValues: objectArrayShape(parsed.labelValues, UI_INVENTORY_LABEL_VALUE_SHAPE_FIELDS),
    sections: hasFormShape
      ? []
      : objectArrayShape(parsed.sections, UI_INVENTORY_SECTION_SHAPE_FIELDS),
    tables: objectArrayShape(parsed.tables, UI_INVENTORY_TABLE_SHAPE_FIELDS),
  };
  return `ui_inventory:${JSON.stringify(key)}`;
}

function uiStateSlotKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_field' && fact.memoryKind !== 'ui_filter_state') return null;
  const parsed = parseJsonRecord(fact.objectText);
  const sourceRunId = scalarString(
    fact.sourceRunId,
    fact.attributes.sourceRunId,
    parsed?.sourceRunId,
  );
  const stateIndex = scalarString(fact.attributes.stateIndex, parsed?.stateIndex);
  const url = scalarString(fact.attributes.url, parsed?.url);
  if (!sourceRunId && !stateIndex && !url) return null;
  return `ui_state:${sourceRunId}:${stateIndex}:${url}`;
}

export function selectionDedupeKey(fact: MemoryFact): string | null {
  if (fact.memoryKind === 'procedure' && fact.sourceRunId) {
    return `procedure:${fact.sourceRunId}:${fact.predicate}`;
  }
  return uiInventorySchemaKey(fact) ?? uiStateSlotKey(fact);
}

export function supportDiversityKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_inventory' || !fact.sourceRunId) return selectionDedupeKey(fact);
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return selectionDedupeKey(fact);
  const fields = objectArrayShape(parsed.fields, UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS);
  const textEntryControls = objectArrayShape(
    parsed.textEntryControls,
    UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS,
  );
  const searchControls = objectArrayShape(
    parsed.searchControls,
    UI_INVENTORY_SEARCH_SHAPE_FIELDS,
  );
  const popupControls = objectArrayShape(
    parsed.popupControls,
    UI_INVENTORY_POPUP_SHAPE_FIELDS,
  );
  const hasFormShape =
    fields.length > 0 ||
    textEntryControls.length > 0 ||
    searchControls.length > 0 ||
    popupControls.length > 0;
  const url = canonicalSurfacePath(scalarString(fact.attributes.url, parsed.url));
  const key = {
    sourceRunId: fact.sourceRunId,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    url,
    fields,
    textEntryControls,
    searchControls,
    popupControls,
    controlNames: hasFormShape ? [] : stringArray(parsed.controlNames),
    sections: hasFormShape
      ? []
      : objectArrayShape(parsed.sections, UI_INVENTORY_SECTION_SHAPE_FIELDS),
    tables: objectArrayShape(parsed.tables, UI_INVENTORY_TABLE_SHAPE_FIELDS),
  };
  return `support_ui_phase:${JSON.stringify(key)}`;
}

export function supportPhaseKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_inventory' || !fact.sourceRunId) return null;
  const parsed = parseJsonRecord(fact.objectText);
  const url = canonicalSurfacePath(scalarString(fact.attributes.url, parsed?.url));
  if (!url) return null;
  return `support_surface:${fact.sourceRunId}:${url}`;
}

function factStateNumber(fact: MemoryFact): number | null {
  const value = factStateIndex(fact);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function primarySelectionGroupKey(fact: MemoryFact): string {
  return fact.sourceRunId ? `source_run:${fact.sourceRunId}` : `fact:${fact.id}`;
}

export function supportSlotCount(limit: number): number {
  if (limit < 4) return 0;
  return Math.min(SOURCE_RUN_SUPPORT_MAX_SLOTS, Math.ceil(limit * 0.25));
}

export function sourceRunSupportContexts(
  facts: ReadonlyArray<MemoryFact>,
  scoredFacts: ReadonlyArray<ScoredSelectionFact>,
): Array<{
  sourceRunId: string;
  stateIndex: string | number;
}> {
  const selectedRunOrder: string[] = [];
  const selectedRuns = new Set<string>();
  for (const fact of facts) {
    if (!fact.sourceRunId || selectedRuns.has(fact.sourceRunId)) continue;
    selectedRuns.add(fact.sourceRunId);
    selectedRunOrder.push(fact.sourceRunId);
  }

  const byKey = new Map<string, { sourceRunId: string; stateIndex: string | number }>();
  const addFactContext = (fact: MemoryFact): void => {
    if (!fact.sourceRunId || !selectedRuns.has(fact.sourceRunId)) return;
    const stateIndex = factStateIndex(fact);
    if (stateIndex === null) return;
    byKey.set(`${fact.sourceRunId}:${stateIndex}`, {
      sourceRunId: fact.sourceRunId,
      stateIndex,
    });
  };

  for (const fact of facts) addFactContext(fact);

  for (const sourceRunId of selectedRunOrder) {
    let contextCount = Array.from(byKey.values()).filter(
      (context) => context.sourceRunId === sourceRunId,
    ).length;
    if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) continue;
    for (const entry of scoredFacts) {
      if (entry.fact.sourceRunId !== sourceRunId) continue;
      if (entry.textScore <= 0 && entry.score <= 0) continue;
      const beforeSize = byKey.size;
      addFactContext(entry.fact);
      if (byKey.size > beforeSize) contextCount += 1;
      if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) break;
    }
  }

  return Array.from(byKey.values());
}

function supportFactPriority(fact: MemoryFact): number {
  if (fact.memoryKind === 'ui_inventory') return 3;
  if (fact.memoryKind !== 'ui_field') return 1;
  const parsed = parseJsonRecord(fact.objectText);
  return parsed?.role === 'tab' ? 0 : 2;
}

export function compareSupportCandidates(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const rightPriority = supportFactPriority(right.fact);
  const leftPriority = supportFactPriority(left.fact);
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  if (right.scored.score !== left.scored.score) return right.scored.score - left.scored.score;
  if (right.scored.relevanceScore !== left.scored.relevanceScore) {
    return right.scored.relevanceScore - left.scored.relevanceScore;
  }
  if (right.fact.retrievability !== left.fact.retrievability) {
    return right.fact.retrievability - left.fact.retrievability;
  }
  return right.fact.updatedAt - left.fact.updatedAt;
}

export function compareSupportPhaseRepresentatives(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const leftState = factStateNumber(left.fact);
  const rightState = factStateNumber(right.fact);
  if (leftState !== null && rightState !== null && leftState !== rightState) {
    return rightState - leftState;
  }
  return compareSupportCandidates(left, right);
}
