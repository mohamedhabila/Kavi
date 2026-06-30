import type { MemoryFact } from './facts/types';

const UI_OBSERVATION_COLLECTION_FIELDS = [
  'surfaceLabels',
  'sections',
  'fieldLabels',
  'fields',
  'controlNames',
  'actionControls',
  'roleControls',
  'contextRoleControls',
  'textEntryControls',
  'searchControls',
  'popupControls',
  'labelValues',
  'tables',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasObservationValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

function rememberLabel(labels: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const label = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!label) return;
  const key = label.toLocaleLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  labels.push(label);
}

function collectStringArrayLabels(
  labels: string[],
  seen: Set<string>,
  value: unknown,
): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) rememberLabel(labels, seen, entry);
}

function collectSectionPathLabels(
  labels: string[],
  seen: Set<string>,
  sections: unknown,
): void {
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    if (!isRecord(section) || !Array.isArray(section.structuralPath)) continue;
    for (const pathEntry of section.structuralPath) {
      if (!isRecord(pathEntry)) continue;
      rememberLabel(labels, seen, pathEntry.label);
    }
  }
}

function collectSectionLabels(labels: string[], seen: Set<string>, sections: unknown): void {
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    if (!isRecord(section)) continue;
    rememberLabel(labels, seen, section.label);
  }
}

function collectText(value: unknown, texts: string[], seen: Set<string>): void {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!text) return;
  const key = text.toLocaleLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  texts.push(text);
}

function collectTextArray(value: unknown, texts: string[], seen: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) collectText(entry, texts, seen);
}

function collectRecordTextFields(
  value: unknown,
  fields: ReadonlyArray<string>,
  texts: string[],
  seen: Set<string>,
): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    for (const field of fields) {
      const fieldValue = entry[field];
      if (Array.isArray(fieldValue)) {
        collectTextArray(fieldValue, texts, seen);
      } else {
        collectText(fieldValue, texts, seen);
      }
    }
  }
}

export function hasStructuredUiObservation(
  parsed: Record<string, unknown> | null,
  attributes: Record<string, unknown> = {},
): boolean {
  for (const field of UI_OBSERVATION_COLLECTION_FIELDS) {
    if (hasObservationValue(attributes[field]) || hasObservationValue(parsed?.[field])) {
      return true;
    }
  }
  return false;
}

export function isUiObservationFact(
  fact: MemoryFact,
  parsed: Record<string, unknown> | null,
): boolean {
  if (fact.memoryKind === 'ui_inventory') return true;
  return fact.memoryKind === 'outcome' && hasStructuredUiObservation(parsed, fact.attributes);
}

export function collectUiObservationEvidenceTexts(
  parsed: Record<string, unknown> | null,
  attributes: Record<string, unknown> = {},
): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  const collectFrom = (source: Record<string, unknown> | null | undefined): void => {
    if (!source) return;
    collectText(source.action, texts, seen);
    collectText(source.thought, texts, seen);
    collectText(source.outcome, texts, seen);
    collectTextArray(source.surfaceLabels, texts, seen);
    collectRecordTextFields(source.visibleTextSnippets, ['text'], texts, seen);
    collectRecordTextFields(
      source.sections,
      ['label', 'textSnippets', 'controlNames', 'fieldLabels'],
      texts,
      seen,
    );
    collectTextArray(source.fieldLabels, texts, seen);
    collectTextArray(source.controlNames, texts, seen);
    collectRecordTextFields(
      source.fields,
      ['label', 'controlName', 'name', 'value', 'displayText', 'options'],
      texts,
      seen,
    );
    collectRecordTextFields(
      source.actionControls,
      ['name', 'label', 'contextLabels'],
      texts,
      seen,
    );
    collectRecordTextFields(
      source.popupControls,
      ['name', 'controlName', 'value', 'options'],
      texts,
      seen,
    );
    collectRecordTextFields(source.labelValues, ['label', 'value'], texts, seen);
    collectRecordTextFields(source.tables, ['label', 'columnLabels', 'rowSample'], texts, seen);
  };
  collectFrom(attributes);
  collectFrom(parsed);
  return texts;
}

export function collectUiObservationSurfaceLabels(
  parsed: Record<string, unknown> | null,
  attributes: Record<string, unknown> = {},
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  collectStringArrayLabels(labels, seen, attributes.surfaceLabels);
  collectStringArrayLabels(labels, seen, parsed?.surfaceLabels);
  collectSectionPathLabels(labels, seen, attributes.sections);
  collectSectionPathLabels(labels, seen, parsed?.sections);
  collectSectionLabels(labels, seen, attributes.sections);
  collectSectionLabels(labels, seen, parsed?.sections);
  return labels;
}
