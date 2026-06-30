import type { MemoryFact } from './facts/types';
import { parseJsonRecord } from './factJson';
import { extractDelimitedQuerySpans } from './ranking/quotedSpans';
import { isUiObservationFact } from './uiObservationEvidence';

const QUERY_CONTROL_LABEL_SPAN_LIMIT = 12;

const UI_CONTROL_COLLECTION_FIELDS = [
  'controlNames',
  'visibleControls',
  'controls',
  'actionControls',
  'roleControls',
  'contextRoleControls',
  'fields',
  'textEntryControls',
  'searchControls',
  'popupControls',
] as const;

const UI_LABEL_FIELDS = ['name', 'label', 'controlName'] as const;

interface MatchedQuotedControlLabel {
  requested: string;
  observed: string;
}

export interface QueryQuotedControlLabelEvidence {
  matched: MatchedQuotedControlLabel[];
}

function normalizeUiLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized.toLocaleLowerCase() : null;
}

function rememberLabel(labelsByNormalizedValue: Map<string, string>, value: unknown): void {
  const normalized = normalizeUiLabel(value);
  if (!normalized || labelsByNormalizedValue.has(normalized)) return;
  labelsByNormalizedValue.set(normalized, String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim());
}

function collectLabelsFromUiControlValue(
  value: unknown,
  labelsByNormalizedValue: Map<string, string>,
): void {
  if (typeof value === 'string') {
    rememberLabel(labelsByNormalizedValue, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLabelsFromUiControlValue(item, labelsByNormalizedValue);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  for (const labelField of UI_LABEL_FIELDS) {
    rememberLabel(labelsByNormalizedValue, record[labelField]);
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) collectLabelsFromUiControlValue(nested, labelsByNormalizedValue);
  }
}

function collectObservedUiControlLabels(fact: MemoryFact): Map<string, string> {
  const labelsByNormalizedValue = new Map<string, string>();
  const parsed = parseJsonRecord(fact.objectText);
  for (const field of UI_CONTROL_COLLECTION_FIELDS) {
    collectLabelsFromUiControlValue(fact.attributes[field], labelsByNormalizedValue);
    if (parsed) collectLabelsFromUiControlValue(parsed[field], labelsByNormalizedValue);
  }
  return labelsByNormalizedValue;
}

export function buildQueryQuotedControlLabelEvidence(
  query: string,
  fact: MemoryFact,
): QueryQuotedControlLabelEvidence | null {
  const parsed = parseJsonRecord(fact.objectText);
  if (!isUiObservationFact(fact, parsed)) return null;
  const queryLabels = extractDelimitedQuerySpans(query, QUERY_CONTROL_LABEL_SPAN_LIMIT);
  if (queryLabels.length === 0) return null;
  const observedLabelsByNormalizedValue = collectObservedUiControlLabels(fact);
  if (observedLabelsByNormalizedValue.size === 0) return null;

  const matched: MatchedQuotedControlLabel[] = [];
  for (const requested of queryLabels) {
    const normalized = normalizeUiLabel(requested);
    if (!normalized) continue;
    const observed = observedLabelsByNormalizedValue.get(normalized);
    if (observed) matched.push({ requested, observed });
  }
  return matched.length > 0 ? { matched } : null;
}

export function queryQuotedControlLabelMatchRatio(query: string, fact: MemoryFact): number {
  const queryLabels = extractDelimitedQuerySpans(query, QUERY_CONTROL_LABEL_SPAN_LIMIT);
  if (queryLabels.length === 0) return 0;
  const evidence = buildQueryQuotedControlLabelEvidence(query, fact);
  if (!evidence) return 0;
  return evidence.matched.length / queryLabels.length;
}

export function annotateUiInventoryQueryEvidence(
  query: string,
  facts: ReadonlyArray<MemoryFact>,
): MemoryFact[] {
  if (!query.trim()) return [...facts];
  return facts.map((fact) => {
    const evidence = buildQueryQuotedControlLabelEvidence(query, fact);
    if (!evidence) return fact;
    return {
      ...fact,
      attributes: {
        ...fact.attributes,
        queryQuotedControlLabelEvidence: evidence,
      },
    };
  });
}
