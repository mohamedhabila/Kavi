import type { MemoryFact } from '../facts/types';
import { parseJsonRecord } from '../factJson';
import {
  UI_INVENTORY_ACTION_CONTROL_SHAPE_FIELDS,
  UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS,
  UI_INVENTORY_LABEL_VALUE_SHAPE_FIELDS,
  UI_INVENTORY_POPUP_SHAPE_FIELDS,
  UI_INVENTORY_SEARCH_SHAPE_FIELDS,
  UI_INVENTORY_SECTION_SHAPE_FIELDS,
  UI_INVENTORY_TABLE_SHAPE_FIELDS,
  UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS,
} from '../uiFactFields';

const SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN = 4;
const SOURCE_RUN_SUPPORT_MAX_SLOTS = 4;
const UI_SCHEMA_KEY_ARRAY_LIMIT = 48;
const WORKFLOW_REPRESENTATIVE_MIN_SCORE_RATIO = 0.75;

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
    .filter(
      (entry): entry is Record<string, unknown> =>
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

const UI_INVENTORY_SUPPORT_FORM_FIELD_FIELDS = [
  ...UI_INVENTORY_FORM_FIELD_SHAPE_FIELDS,
  'value',
  'options',
] as const;

function canonicalSurfacePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const decodePathSegment = (candidate: string): string => {
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  };
  try {
    const url = new URL(trimmed);
    const decodedPath = decodePathSegment(url.pathname);
    return `${url.origin}${decodedPath.split('?')[0]}`;
  } catch {
    return decodePathSegment(trimmed).split('?')[0].split('#')[0];
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

function factStateIndexes(fact: MemoryFact): Array<string | number> {
  const directStateIndex = factStateIndex(fact);
  const indexes: Array<string | number> = directStateIndex !== null ? [directStateIndex] : [];
  if (fact.memoryKind !== 'procedure') return indexes;
  const parsed = parseJsonRecord(fact.objectText);
  const steps = parsed?.steps;
  if (!Array.isArray(steps)) return indexes;
  const seen = new Set(indexes.map((index) => String(index)));
  const stepStateIndexes = steps
    .map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return '';
      return scalarString(
        (step as Record<string, unknown>).stateIndex,
        (step as Record<string, unknown>).state_index,
      );
    })
    .filter(Boolean);
  const orderedStepStateIndexes: string[] = [];
  for (
    let start = 0, end = stepStateIndexes.length - 1;
    start <= end && orderedStepStateIndexes.length < SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN * 2;
    start += 1, end -= 1
  ) {
    orderedStepStateIndexes.push(stepStateIndexes[start]);
    if (end !== start) orderedStepStateIndexes.push(stepStateIndexes[end]);
  }
  for (const stateIndex of orderedStepStateIndexes) {
    if (!stateIndex || seen.has(stateIndex)) continue;
    seen.add(stateIndex);
    indexes.push(stateIndex);
  }
  return indexes;
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
  const searchControls = objectArrayShape(parsed.searchControls, UI_INVENTORY_SEARCH_SHAPE_FIELDS);
  const popupControls = objectArrayShape(parsed.popupControls, UI_INVENTORY_POPUP_SHAPE_FIELDS);
  const actionControls = objectArrayShape(
    parsed.actionControls,
    UI_INVENTORY_ACTION_CONTROL_SHAPE_FIELDS,
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
    actionControls,
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
  return `ui_state:${fact.memoryKind}:${sourceRunId}:${stateIndex}:${url}`;
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
  const fields = objectArrayShape(parsed.fields, UI_INVENTORY_SUPPORT_FORM_FIELD_FIELDS);
  const textEntryControls = objectArrayShape(
    parsed.textEntryControls,
    UI_INVENTORY_TEXT_ENTRY_SHAPE_FIELDS,
  );
  const searchControls = objectArrayShape(parsed.searchControls, UI_INVENTORY_SEARCH_SHAPE_FIELDS);
  const popupControls = objectArrayShape(parsed.popupControls, UI_INVENTORY_POPUP_SHAPE_FIELDS);
  const actionControls = objectArrayShape(
    parsed.actionControls,
    UI_INVENTORY_ACTION_CONTROL_SHAPE_FIELDS,
  );
  const hasFormShape =
    fields.length > 0 ||
    textEntryControls.length > 0 ||
    searchControls.length > 0 ||
    popupControls.length > 0;
  const key = {
    subjectId: fact.subjectId,
    fields,
    textEntryControls,
    searchControls,
    popupControls,
    actionControls,
    controlNames: stringArray(parsed.controlNames),
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
  const stateIndex = scalarString(fact.attributes.stateIndex, parsed?.stateIndex);
  return `support_surface:${fact.sourceRunId}:${url}:${stateIndex}`;
}

export function sourceRunStateKey(fact: MemoryFact): string | null {
  if (!fact.sourceRunId) return null;
  const stateIndex = fact.attributes.stateIndex;
  if (typeof stateIndex === 'string' && stateIndex.trim()) {
    return `${fact.sourceRunId}:${stateIndex.trim()}`;
  }
  if (typeof stateIndex === 'number' && Number.isFinite(stateIndex)) {
    return `${fact.sourceRunId}:${stateIndex}`;
  }
  return null;
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
  if (!fact.sourceRunId) return `fact:${fact.id}`;
  return `source_run:${fact.sourceRunId}`;
}

function procedureStepCount(fact: MemoryFact): number | null {
  if (fact.memoryKind !== 'procedure') return null;
  const parsed = parseJsonRecord(fact.objectText);
  if (typeof parsed?.stepCount === 'number' && Number.isFinite(parsed.stepCount)) {
    return parsed.stepCount;
  }
  const steps = parsed?.steps;
  return Array.isArray(steps) ? steps.length : null;
}

function procedureMaxStateNumber(fact: MemoryFact): number | null {
  if (fact.memoryKind !== 'procedure') return null;
  const parsed = parseJsonRecord(fact.objectText);
  const steps = parsed?.steps;
  if (!Array.isArray(steps)) return null;
  let maxState: number | null = null;
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const value = scalarString(
      (step as Record<string, unknown>).stateIndex,
      (step as Record<string, unknown>).state_index,
    );
    if (!value) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    maxState = maxState === null ? numeric : Math.max(maxState, numeric);
  }
  return maxState;
}

function hasWorkflowProcedureEvidence(outcome: MemoryFact, procedure: MemoryFact): boolean {
  const outcomeState = factStateNumber(outcome);
  const maxProcedureState = procedureMaxStateNumber(procedure);
  const stepCount = procedureStepCount(procedure) ?? 0;
  if (stepCount <= 1) return false;
  if (outcomeState === null || maxProcedureState === null) return stepCount > 1;
  return maxProcedureState >= outcomeState;
}

function arrayHasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasStructuredControlState(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (arrayHasEntries(record.options)) return true;
  for (const key of ['value', 'displayText', 'checked', 'selected', 'expanded', 'disabled']) {
    const fieldValue = record[key];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') return true;
  }
  return false;
}

function inventoryHasStructuredControlState(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  for (const key of ['fields', 'textEntryControls', 'searchControls', 'popupControls']) {
    const entries = parsed[key];
    if (!Array.isArray(entries)) continue;
    if (entries.some(hasStructuredControlState)) return true;
  }
  return false;
}

function outcomeHasDirectObservationEvidence(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  return [
    'fields',
    'sections',
    'actionControls',
    'controlNames',
    'visibleTextSnippets',
    'fieldLabels',
  ].some((key) => arrayHasEntries(parsed[key]));
}

function workflowRepresentativePriority(fact: MemoryFact): number {
  const parsed = parseJsonRecord(fact.objectText);
  if (fact.memoryKind === 'ui_field') {
    return hasStructuredControlState(parsed) ? 6 : 1;
  }
  if (fact.memoryKind === 'ui_filter_state') return 5;
  if (fact.memoryKind === 'ui_inventory') {
    return inventoryHasStructuredControlState(parsed) ? 4 : 2;
  }
  if (fact.memoryKind === 'outcome') {
    return outcomeHasDirectObservationEvidence(parsed) ? 3 : 1;
  }
  if (fact.memoryKind === 'procedure') return 4;
  return 1;
}

function shouldKeepDirectOutcomeEvidence(outcome: MemoryFact): boolean {
  if (outcome.memoryKind !== 'outcome') return false;
  return outcomeHasDirectObservationEvidence(parseJsonRecord(outcome.objectText));
}

function outcomePreviousStateNumber(fact: MemoryFact): number | null {
  if (fact.memoryKind !== 'outcome') return null;
  const parsed = parseJsonRecord(fact.objectText);
  const value = scalarString(fact.attributes.previousStateIndex, parsed?.previousStateIndex);
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function immediateOutcomeContinuation(
  representative: ScoredSelectionFact,
  scoredFacts: ReadonlyArray<ScoredSelectionFact>,
  threshold: number,
): ScoredSelectionFact | null {
  if (!representative.fact.sourceRunId || representative.fact.memoryKind !== 'outcome') {
    return null;
  }
  const stateNumber = factStateNumber(representative.fact);
  if (stateNumber === null) return null;
  let best: ScoredSelectionFact | null = null;
  for (const candidate of scoredFacts) {
    if (candidate.fact.sourceRunId !== representative.fact.sourceRunId) continue;
    if (candidate.fact.id === representative.fact.id) continue;
    if (candidate.fact.memoryKind !== 'outcome') continue;
    if (candidate.score < threshold && candidate.relevanceScore < threshold) continue;
    if (!shouldKeepDirectOutcomeEvidence(candidate.fact)) continue;
    if (outcomePreviousStateNumber(candidate.fact) !== stateNumber) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

export function workflowProcedureRepresentativeForOutcome(
  outcome: MemoryFact,
  procedures: ReadonlyArray<MemoryFact>,
): MemoryFact | null {
  if (!outcome.sourceRunId || outcome.memoryKind !== 'outcome') return null;
  if (shouldKeepDirectOutcomeEvidence(outcome)) return null;
  let best: MemoryFact | null = null;
  for (const procedure of procedures) {
    if (procedure.sourceRunId !== outcome.sourceRunId) continue;
    if (!hasWorkflowProcedureEvidence(outcome, procedure)) continue;
    if (!best) {
      best = procedure;
      continue;
    }
    const procedureSteps = procedureStepCount(procedure) ?? 0;
    const bestSteps = procedureStepCount(best) ?? 0;
    if (procedureSteps !== bestSteps) {
      if (procedureSteps > bestSteps) best = procedure;
      continue;
    }
    if (procedure.updatedAt > best.updatedAt) best = procedure;
  }
  return best;
}

export function primaryWorkflowRepresentative(
  entry: ScoredSelectionFact,
  scoredFacts: ReadonlyArray<ScoredSelectionFact>,
  threshold: number,
): ScoredSelectionFact {
  if (!entry.fact.sourceRunId) return entry;
  const minScore = Math.max(threshold, entry.score * WORKFLOW_REPRESENTATIVE_MIN_SCORE_RATIO);
  let best: ScoredSelectionFact = entry;
  let bestPriority = workflowRepresentativePriority(entry.fact);
  for (const candidate of scoredFacts) {
    if (candidate.fact.sourceRunId !== entry.fact.sourceRunId) continue;
    if (candidate.score < minScore && candidate.relevanceScore < threshold) continue;
    if (
      entry.fact.memoryKind === 'outcome' &&
      candidate.fact.memoryKind !== 'outcome' &&
      candidate.fact.memoryKind !== 'procedure'
    ) {
      continue;
    }
    if (
      candidate.fact.memoryKind === 'procedure' &&
      entry.fact.memoryKind === 'outcome' &&
      !hasWorkflowProcedureEvidence(entry.fact, candidate.fact)
    ) {
      continue;
    }
    const candidatePriority = workflowRepresentativePriority(candidate.fact);
    if (
      candidatePriority > bestPriority ||
      (candidatePriority === bestPriority && candidate.score > best.score)
    ) {
      best = candidate;
      bestPriority = candidatePriority;
    }
  }
  return immediateOutcomeContinuation(best, scoredFacts, threshold) ?? best;
}

export function supportSlotCount(limit: number): number {
  if (limit < 4) return 0;
  if (limit <= 4) return 1;
  return Math.min(SOURCE_RUN_SUPPORT_MAX_SLOTS, Math.max(1, Math.ceil(limit * 0.4)));
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
  const contextCountForRun = (sourceRunId: string): number =>
    Array.from(byKey.values()).filter((context) => context.sourceRunId === sourceRunId).length;
  const addFactContexts = (fact: MemoryFact): number => {
    if (!fact.sourceRunId || !selectedRuns.has(fact.sourceRunId)) return 0;
    let added = 0;
    let contextCount = contextCountForRun(fact.sourceRunId);
    for (const stateIndex of factStateIndexes(fact)) {
      if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) break;
      const beforeSize = byKey.size;
      byKey.set(`${fact.sourceRunId}:${stateIndex}`, {
        sourceRunId: fact.sourceRunId,
        stateIndex,
      });
      if (byKey.size > beforeSize) {
        added += 1;
        contextCount += 1;
      }
    }
    return added;
  };

  for (const fact of facts) {
    if (fact.memoryKind !== 'procedure') addFactContexts(fact);
  }

  for (const sourceRunId of selectedRunOrder) {
    let contextCount = contextCountForRun(sourceRunId);
    if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) continue;
    for (const entry of scoredFacts) {
      if (entry.fact.sourceRunId !== sourceRunId) continue;
      if (entry.fact.memoryKind === 'procedure') continue;
      if (entry.textScore <= 0 && entry.score <= 0) continue;
      contextCount += addFactContexts(entry.fact);
      if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) break;
    }
  }

  for (const fact of facts) {
    if (fact.memoryKind === 'procedure') addFactContexts(fact);
  }

  for (const sourceRunId of selectedRunOrder) {
    let contextCount = contextCountForRun(sourceRunId);
    if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) continue;
    for (const entry of scoredFacts) {
      if (entry.fact.sourceRunId !== sourceRunId) continue;
      if (entry.textScore <= 0 && entry.score <= 0) continue;
      contextCount += addFactContexts(entry.fact);
      if (contextCount >= SOURCE_RUN_SUPPORT_CONTEXTS_PER_RUN) break;
    }
  }

  return Array.from(byKey.values());
}

function supportFactPriority(fact: MemoryFact): number {
  if (fact.memoryKind === 'ui_filter_state') return 4;
  if (fact.memoryKind === 'ui_inventory') return 3;
  if (fact.memoryKind !== 'ui_field') return 1;
  const parsed = parseJsonRecord(fact.objectText);
  return parsed?.role === 'tab' ? 5 : 2;
}

export function compareSupportCandidates(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const rightPriority = supportFactPriority(right.fact);
  const leftPriority = supportFactPriority(left.fact);
  const leftStateKey = sourceRunStateKey(left.fact);
  const rightStateKey = sourceRunStateKey(right.fact);
  if (leftStateKey && leftStateKey === rightStateKey && rightPriority !== leftPriority) {
    return rightPriority - leftPriority;
  }
  if (right.scored.score !== left.scored.score) return right.scored.score - left.scored.score;
  if (right.scored.relevanceScore !== left.scored.relevanceScore) {
    return right.scored.relevanceScore - left.scored.relevanceScore;
  }
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  if (right.fact.retrievability !== left.fact.retrievability) {
    return right.fact.retrievability - left.fact.retrievability;
  }
  return right.fact.updatedAt - left.fact.updatedAt;
}

export function compareSupportPhaseRepresentatives(
  left: { fact: MemoryFact; scored: ScoredSelectionFact },
  right: { fact: MemoryFact; scored: ScoredSelectionFact },
): number {
  const supportComparison = compareSupportCandidates(left, right);
  if (supportComparison !== 0) return supportComparison;
  const leftState = factStateNumber(left.fact);
  const rightState = factStateNumber(right.fact);
  if (leftState !== null && rightState !== null && leftState !== rightState) {
    return rightState - leftState;
  }
  return 0;
}
