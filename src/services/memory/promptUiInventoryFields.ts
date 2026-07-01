import type { MemoryFact } from './facts/types';
import { recordHasUiStateBearingValue } from './uiStateBearingFields';

const MAX_VISIBLE_UI_CONTROLS = 64;
const MAX_VISIBLE_UI_SECTIONS = 12;
const MAX_VISIBLE_SECTION_CONTROLS = 20;
const MAX_VISIBLE_SECTION_TEXT_SNIPPETS = 4;
const MAX_VISIBLE_TEXT_SNIPPETS = 24;
const MAX_VISIBLE_UI_FIELD_ROWS = 32;
const MAX_VISIBLE_UI_FIELDS = 24;
const MAX_VISIBLE_FIELD_OPTIONS = 12;
const MAX_VISIBLE_LANDMARK_ROWS = 8;
const MAX_LANDMARK_ROW_LABELS = 8;
const MAX_LANDMARK_ROW_CONTROLS = 24;
const MAX_LANDMARK_ROW_TEXT_SNIPPETS = 8;
const MAX_ADJACENT_CONTROL_PAIRS = 8;

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function dropEmptyPromptRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}

function limitPromptStringArray(
  value: unknown,
  limit: number,
  maxItemChars: number,
): string[] | null {
  if (!Array.isArray(value) || limit <= 0) return null;
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit)
    .map((entry) => fitText(entry, maxItemChars));
  return entries.length > 0 ? entries : null;
}

function adjacentStringPairs(values: string[] | null): string[][] | null {
  if (!values || values.length < 2) return null;
  const pairs: string[][] = [];
  const pairLimit = Math.min(values.length - 1, MAX_ADJACENT_CONTROL_PAIRS);
  for (let index = 0; index < pairLimit; index += 1) {
    pairs.push([values[index], values[index + 1]]);
  }
  return pairs.length > 0 ? pairs : null;
}

function compactSectionStructuralPathForPrompt(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const path = value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
    )
    .slice(0, 4)
    .map((entry) =>
      dropEmptyPromptRecord({
        role: typeof entry.role === 'string' ? fitText(entry.role, 80) : entry.role,
        label: typeof entry.label === 'string' ? fitText(entry.label, 120) : entry.label,
      }),
    )
    .filter((entry) => Object.keys(entry).length > 0);
  return path.length > 0 ? path : null;
}

function compactUiSectionForPrompt(section: unknown): Record<string, unknown> | null {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const input = section as Record<string, unknown>;
  const controlNames = limitPromptStringArray(
    input.controlNames,
    MAX_VISIBLE_SECTION_CONTROLS,
    96,
  );
  const textSnippets = limitPromptStringArray(
    input.textSnippets,
    MAX_VISIBLE_SECTION_TEXT_SNIPPETS,
    120,
  );
  const structuralPath = compactSectionStructuralPathForPrompt(input.structuralPath);
  if (!structuralPath && !textSnippets && (!controlNames || controlNames.length < 2)) return null;
  const compact = dropEmptyPromptRecord({
    label: typeof input.label === 'string' ? fitText(input.label, 140) : input.label,
    landmarkRole:
      typeof input.landmarkRole === 'string' ? fitText(input.landmarkRole, 80) : input.landmarkRole,
    structuralPath,
    controlNames,
    adjacentControlPairs: adjacentStringPairs(controlNames),
    textSnippets,
    controlCount: input.controlCount,
    firstControlIndex: input.firstControlIndex,
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function addUniqueText(target: string[], seen: Set<string>, value: unknown, limit: number): void {
  if (target.length >= limit || typeof value !== 'string') return;
  const trimmed = value.normalize('NFKC').trim();
  if (!trimmed) return;
  const key = trimmed.toLocaleLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(trimmed);
}

function compactLandmarkRowsForPrompt(sections: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(sections)) return null;
  const rows = new Map<
    string,
    {
      landmarkRole: string;
      sectionLabels: string[];
      controlNames: string[];
      textSnippets: string[];
      seenLabels: Set<string>;
      seenControls: Set<string>;
      seenTexts: Set<string>;
    }
  >();
  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const input = section as Record<string, unknown>;
    const landmarkRole =
      typeof input.landmarkRole === 'string' && input.landmarkRole.trim()
        ? input.landmarkRole.trim()
        : null;
    if (!landmarkRole) continue;
    const key = landmarkRole.toLocaleLowerCase();
    const row =
      rows.get(key) ??
      {
        landmarkRole,
        sectionLabels: [],
        controlNames: [],
        textSnippets: [],
        seenLabels: new Set<string>(),
        seenControls: new Set<string>(),
        seenTexts: new Set<string>(),
      };
    addUniqueText(row.sectionLabels, row.seenLabels, input.label, MAX_LANDMARK_ROW_LABELS);
    if (Array.isArray(input.controlNames)) {
      for (const controlName of input.controlNames) {
        addUniqueText(row.controlNames, row.seenControls, controlName, MAX_LANDMARK_ROW_CONTROLS);
      }
    }
    if (Array.isArray(input.textSnippets)) {
      for (const snippet of input.textSnippets) {
        addUniqueText(row.textSnippets, row.seenTexts, snippet, MAX_LANDMARK_ROW_TEXT_SNIPPETS);
      }
    }
    rows.set(key, row);
  }
  const compactRows = Array.from(rows.values())
    .map((row) =>
      dropEmptyPromptRecord({
        landmarkRole: fitText(row.landmarkRole, 80),
        sectionLabels: row.sectionLabels.map((label) => fitText(label, 120)),
        controlNames: row.controlNames.map((name) => fitText(name, 96)),
        textSnippets: row.textSnippets.map((text) => fitText(text, 120)),
      }),
    )
    .filter((row) => Object.keys(row).length > 1)
    .slice(0, MAX_VISIBLE_LANDMARK_ROWS);
  return compactRows.length > 0 ? compactRows : null;
}

function compactVisibleTextSnippetForPrompt(snippet: unknown): Record<string, unknown> | null {
  if (!snippet || typeof snippet !== 'object' || Array.isArray(snippet)) return null;
  const input = snippet as Record<string, unknown>;
  const text = typeof input.text === 'string' ? fitText(input.text, 220) : null;
  if (!text) return null;
  const compact = dropEmptyPromptRecord({
    text,
    contextLabels: limitPromptStringArray(input.contextLabels, 4, 120),
    index: input.index,
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function normalizedUiFieldLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized.toLocaleLowerCase() : null;
}

function uiFieldsByNormalizedLabel(rawFields: unknown): Map<string, Record<string, unknown>> {
  const fieldsByLabel = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(rawFields)) return fieldsByLabel;
  for (const field of rawFields) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    for (const key of ['label', 'controlName', 'name']) {
      const normalized = normalizedUiFieldLabel(record[key]);
      if (normalized && !fieldsByLabel.has(normalized)) fieldsByLabel.set(normalized, record);
    }
  }
  return fieldsByLabel;
}

function compactUiFieldForPrompt(field: Record<string, unknown>): Record<string, unknown> | null {
  const compact: Record<string, unknown> = {};
  const copyScalar = (name: string, maxChars = 140): void => {
    const value = field[name];
    if (value === undefined || value === null || value === '') return;
    compact[name] = typeof value === 'string' ? fitText(value, maxChars) : value;
  };
  copyScalar('order');
  copyScalar('label');
  copyScalar('role');
  copyScalar('controlName');
  copyScalar('name');
  copyScalar('value', 160);
  copyScalar('displayText', 160);
  copyScalar('required');
  copyScalar('checked');
  copyScalar('selected');
  copyScalar('disabled');
  copyScalar('expanded');
  if (Array.isArray(field.symbolMarkers)) compact.symbolMarkers = field.symbolMarkers.slice(0, 4);
  if (Array.isArray(field.options)) {
    const rawOptions = field.options.filter(
      (option): option is string => typeof option === 'string' && option.trim().length > 0,
    );
    if (rawOptions.length > MAX_VISIBLE_FIELD_OPTIONS) {
      compact.optionCount = rawOptions.length;
    } else {
      const options = rawOptions.map((option) => fitText(option, 96));
      if (options.length > 0) compact.options = options;
    }
  }
  if (Array.isArray(field.adjacentControls)) {
    const adjacentControls = field.adjacentControls
      .map((control) => {
        if (!control || typeof control !== 'object' || Array.isArray(control)) return null;
        const input = control as Record<string, unknown>;
        return dropEmptyPromptRecord({
          role: typeof input.role === 'string' ? fitText(input.role, 80) : input.role,
          name: typeof input.name === 'string' ? fitText(input.name, 140) : input.name,
          label: typeof input.label === 'string' ? fitText(input.label, 140) : input.label,
          value: typeof input.value === 'string' ? fitText(input.value, 140) : input.value,
          expanded: input.expanded,
        });
      })
      .filter((control): control is Record<string, unknown> =>
        Boolean(control && Object.keys(control).length > 0),
      )
      .slice(0, 6);
    if (adjacentControls.length > 0) compact.adjacentControls = adjacentControls;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function compactUiFieldRowForPrompt(
  label: string,
  index: number,
  fieldsByLabel: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  const field = fieldsByLabel.get(normalizedUiFieldLabel(label) ?? '') ?? {};
  return compactUiFieldForPrompt({ order: field.order ?? index, label, ...field });
}

export function compactUiInventoryPromptFields(
  fact: MemoryFact,
  parsed: Record<string, unknown> | null,
): string | null {
  if (!parsed) return null;
  const compact: Record<string, unknown> = {};
  const copyField = (from: string, to = from): void => {
    const rawValue =
      from === 'sourceRunId'
        ? (fact.sourceRunId ?? fact.attributes[from] ?? parsed[from])
        : (fact.attributes[from] ?? parsed[from]);
    if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
      compact[to] = rawValue;
    }
  };
  const copyVisibleControls = (): void => {
    const rawControlNames = fact.attributes.controlNames ?? parsed.controlNames;
    if (Array.isArray(rawControlNames)) {
      const visibleControls = rawControlNames
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .map((name) => name.trim())
        .slice(0, MAX_VISIBLE_UI_CONTROLS);
      if (visibleControls.length > 0) {
        compact.visibleControls = visibleControls;
        return;
      }
    }
    if (Array.isArray(parsed.controls)) {
      const visibleControls = parsed.controls
        .map((control) =>
          control && typeof control === 'object' && !Array.isArray(control)
            ? (control as Record<string, unknown>).name
            : null,
        )
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .slice(0, MAX_VISIBLE_UI_CONTROLS);
      if (visibleControls.length > 0) compact.visibleControls = visibleControls;
    }
  };
  const compactFieldRows = (): void => {
    const rawFieldLabels = fact.attributes.fieldLabels ?? parsed.fieldLabels;
    if (!Array.isArray(rawFieldLabels)) return;
    const fieldsByLabel = uiFieldsByNormalizedLabel(fact.attributes.fields ?? parsed.fields);
    const rows = rawFieldLabels
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
      .slice(0, MAX_VISIBLE_UI_FIELD_ROWS)
      .map((label, index) => compactUiFieldRowForPrompt(label, index, fieldsByLabel))
      .filter((row): row is Record<string, unknown> => Boolean(row));
    if (rows.length > 0) compact.fieldRows = rows;
  };
  const compactFields = (): void => {
    const rawFields = fact.attributes.fields ?? parsed.fields;
    if (!Array.isArray(rawFields)) return;
    const fields = rawFields
      .map((field) =>
        field && typeof field === 'object' && !Array.isArray(field)
          ? compactUiFieldForPrompt(field as Record<string, unknown>)
          : null,
      )
      .filter((field): field is Record<string, unknown> => Boolean(field))
      .slice(0, MAX_VISIBLE_UI_FIELDS);
    if (fields.length > 0) compact.fields = fields;
  };
  const compactStateFields = (): void => {
    const rawFields = fact.attributes.fields ?? parsed.fields;
    if (!Array.isArray(rawFields)) return;
    const fields = rawFields
      .map((field) =>
        field && typeof field === 'object' && !Array.isArray(field)
          ? (field as Record<string, unknown>)
          : null,
      )
      .filter((field): field is Record<string, unknown> =>
        Boolean(field && recordHasUiStateBearingValue(field)),
      )
      .map(compactUiFieldForPrompt)
      .filter((field): field is Record<string, unknown> => Boolean(field))
      .slice(0, MAX_VISIBLE_UI_FIELDS);
    if (fields.length > 0) compact.stateFields = fields;
  };
  const compactSections = (): void => {
    const rawSections = fact.attributes.sections ?? parsed.sections;
    if (!Array.isArray(rawSections)) return;
    const sections = rawSections
      .map(compactUiSectionForPrompt)
      .filter((section): section is Record<string, unknown> => Boolean(section))
      .slice(0, MAX_VISIBLE_UI_SECTIONS);
    if (sections.length > 0) compact.sectionRows = sections;
    const landmarkRows = compactLandmarkRowsForPrompt(rawSections);
    if (landmarkRows) compact.landmarkRows = landmarkRows;
  };
  const compactVisibleTextSnippets = (): void => {
    const rawSnippets = fact.attributes.visibleTextSnippets ?? parsed.visibleTextSnippets;
    if (!Array.isArray(rawSnippets)) return;
    const snippets = rawSnippets
      .map(compactVisibleTextSnippetForPrompt)
      .filter((snippet): snippet is Record<string, unknown> => Boolean(snippet))
      .slice(0, MAX_VISIBLE_TEXT_SNIPPETS);
    if (snippets.length > 0) compact.visibleTextSnippets = snippets;
  };

  copyField('goal', 'sourceGoal');
  copyField('action');
  copyField('thought');
  copyField('outcome');
  copyField('trajectoryOutcome');
  copyField('domain');
  copyField('environment');
  copyField('url');
  copyField('sourceRunId');
  copyField('stateIndex');
  copyField('surfaceLabels');
  copyField('queryQuotedControlLabelEvidence');
  copyField('tables');
  copyField('labelValues');
  copyVisibleControls();
  compactSections();
  compactVisibleTextSnippets();
  copyField('fieldLabels');
  compactFieldRows();
  compactStateFields();
  compactFields();
  copyField('sections');
  copyField('actionControls');
  copyField('roleControls');
  copyField('contextRoleControls');
  copyField('textEntryControls');
  copyField('searchControls');
  copyField('popupControls');
  copyField('nodeCount');
  copyField('controlCount');
  copyField('textEntryCount');
  copyField('searchControlCount');
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : null;
}
