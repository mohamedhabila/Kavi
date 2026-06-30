type JsonRecord = Record<string, unknown>;

const MAX_STORED_UI_FIELD_OPTIONS = 24;
const MAX_STORED_UI_FIELD_ADJACENT_CONTROLS = 4;

const UI_INVENTORY_ARRAY_COMPACT_ORDER = [
  'controls',
  'controlNames',
  'roleCounts',
  'sections',
  'visibleTextSnippets',
  'labelValues',
  'actionControls',
  'roleControls',
  'contextRoleControls',
  'popupControls',
  'searchControls',
  'textEntryControls',
  'tables',
  'surfaceLabels',
  'fieldLabels',
  'fields',
] as const;

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fitObjectTextForStorage(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const parsed = parseJsonPayload(trimmed);
  if (parsed) return compactJsonForStorage(parsed, maxChars);
  return fitText(trimmed, maxChars);
}

export function compactJsonForStorage(value: JsonRecord, maxChars: number): string {
  const compact = compactJson(value);
  if (compact.length <= maxChars) return compact;
  if (isUiInventoryPayload(value)) return compactUiInventoryForStorage(value, maxChars);
  return compactGenericJsonForStorage(value, maxChars);
}

function parseJsonPayload(raw: string | undefined): JsonRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUiInventoryPayload(value: JsonRecord): boolean {
  return (
    Array.isArray(value.fieldLabels) ||
    Array.isArray(value.fields) ||
    Array.isArray(value.controls) ||
    typeof value.controlCount === 'number'
  );
}

function compactUiInventoryForStorage(value: JsonRecord, maxChars: number): string {
  const stages = [
    omitKeys(value, ['controls']),
    limitInventoryArrays(value, {
      fieldLabels: 48,
      surfaceLabels: 24,
      fields: 24,
      visibleTextSnippets: 48,
      textEntryControls: 24,
      searchControls: 12,
      popupControls: 12,
      labelValues: 24,
      actionControls: 48,
      roleControls: 12,
      contextRoleControls: 16,
      tables: 4,
      sections: 32,
      controlNames: 160,
      controls: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 48,
      surfaceLabels: 24,
      fields: 24,
      visibleTextSnippets: 32,
      textEntryControls: 24,
      searchControls: 12,
      popupControls: 12,
      labelValues: 24,
      actionControls: 32,
      roleControls: 8,
      contextRoleControls: 12,
      tables: 4,
      sections: 24,
      controlNames: 96,
      controls: 0,
      roleCounts: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 36,
      surfaceLabels: 18,
      fields: 16,
      visibleTextSnippets: 24,
      textEntryControls: 16,
      searchControls: 8,
      popupControls: 8,
      labelValues: 12,
      actionControls: 24,
      roleControls: 6,
      contextRoleControls: 8,
      tables: 2,
      sections: 16,
      controlNames: 64,
      controls: 0,
      roleCounts: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 24,
      surfaceLabels: 12,
      fields: 8,
      visibleTextSnippets: 12,
      textEntryControls: 8,
      searchControls: 4,
      popupControls: 4,
      labelValues: 8,
      actionControls: 12,
      roleControls: 4,
      contextRoleControls: 4,
      tables: 1,
      sections: 8,
      controlNames: 32,
      controls: 0,
      roleCounts: 0,
    }),
    omitKeys(value, ['controls', 'controlNames']),
    omitKeys(value, ['controls', 'controlNames', 'roleCounts']),
  ];

  for (const stage of stages) {
    const compact = compactJson(stage);
    if (compact.length <= maxChars) return compact;
  }

  const fieldCentric = compactFieldCentricUiInventoryForStorage(value, maxChars);
  if (fieldCentric) return fieldCentric;

  const minimal = dropEmpty({
    fieldLabels: limitStringArray(value.fieldLabels, 16, 96),
    surfaceLabels: limitStringArray(value.surfaceLabels, 12, 140),
    controlNames: limitStringArrayBalanced(value.controlNames, 24, 96),
    tables: limitUiTables(value.tables, 1),
    sections: limitSections(value.sections, 8),
    visibleTextSnippets: limitVisibleTextSnippets(value.visibleTextSnippets, 12),
    fields: limitUiFields(value.fields, 4),
    actionControls: limitArray(value.actionControls, 8),
    roleControls: limitRoleControls(value.roleControls, 4),
    contextRoleControls: limitArray(value.contextRoleControls, 4),
    textEntryControls: limitArray(value.textEntryControls, 4),
    searchControls: limitArray(value.searchControls, 2),
    popupControls: limitArray(value.popupControls, 2),
    url: value.url,
    sourceRunId: value.sourceRunId,
    stateIndex: value.stateIndex,
    nodeCount: value.nodeCount,
    controlCount: value.controlCount,
    textEntryCount: value.textEntryCount,
    searchControlCount: value.searchControlCount,
  });
  return compactRecordToLimit(minimal, maxChars, UI_INVENTORY_ARRAY_COMPACT_ORDER);
}

function compactFieldCentricUiInventoryForStorage(
  value: JsonRecord,
  maxChars: number,
): string | null {
  if (!Array.isArray(value.fields) || value.fields.length === 0) return null;
  const fieldLimits = [24, 16, 12, 8, 4, 2, 1];
  const supplementalVariants = [
    { sections: true, tables: true, controlNames: 24, actionControls: 48 },
    { sections: true, tables: true, controlNames: 8, actionControls: 8 },
    { sections: true, tables: false, controlNames: 0, actionControls: 0 },
    { sections: false, tables: false, controlNames: 8, actionControls: 8 },
  ];
  for (const fieldLimit of fieldLimits) {
    const fields = compactUiFieldsForStorage(value.fields, fieldLimit);
    if (!Array.isArray(fields) || fields.length === 0) continue;
    for (const variant of supplementalVariants) {
      const candidate = dropEmpty({
        fieldLabels: limitStringArray(value.fieldLabels, Math.max(fieldLimit, 8), 96),
        surfaceLabels: limitStringArray(value.surfaceLabels, variant.sections ? 12 : 6, 140),
        fields,
        sections: variant.sections ? limitSections(value.sections, 4) : null,
        visibleTextSnippets: variant.sections
          ? limitVisibleTextSnippets(value.visibleTextSnippets, 12)
          : null,
        tables: variant.tables ? limitUiTables(value.tables, 1) : null,
        controlNames: limitStringArrayBalanced(value.controlNames, variant.controlNames, 96),
        actionControls: limitArray(value.actionControls, variant.actionControls),
        url: value.url,
        sourceRunId: value.sourceRunId,
        stateIndex: value.stateIndex,
        nodeCount: value.nodeCount,
        controlCount: value.controlCount,
        textEntryCount: value.textEntryCount,
        searchControlCount: value.searchControlCount,
      });
      const compact = compactJson(candidate);
      if (compact.length <= maxChars) return compact;
    }
  }
  return null;
}

function compactGenericJsonForStorage(value: JsonRecord, maxChars: number): string {
  const compacted = dropEmpty(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (Array.isArray(entry)) return [key, limitArray(entry, 8)];
        if (isRecord(entry)) return [key, null];
        if (typeof entry === 'string') return [key, fitText(entry, 240)];
        return [key, entry];
      }),
    ),
  );
  return compactRecordToLimit(compacted, maxChars, Object.keys(compacted));
}

function limitInventoryArrays(
  value: JsonRecord,
  limits: Partial<Record<(typeof UI_INVENTORY_ARRAY_COMPACT_ORDER)[number], number>>,
): JsonRecord {
  return dropEmpty({
    ...value,
    fieldLabels: limitArray(value.fieldLabels, limits.fieldLabels),
    surfaceLabels: limitStringArray(value.surfaceLabels, limits.surfaceLabels, 140),
    visibleTextSnippets: limitVisibleTextSnippets(
      value.visibleTextSnippets,
      limits.visibleTextSnippets,
    ),
    fields: limitUiFields(value.fields, limits.fields),
    textEntryControls: limitArray(value.textEntryControls, limits.textEntryControls),
    searchControls: limitArray(value.searchControls, limits.searchControls),
    popupControls: limitArray(value.popupControls, limits.popupControls),
    labelValues: limitArray(value.labelValues, limits.labelValues),
    actionControls: limitArray(value.actionControls, limits.actionControls),
    roleControls: limitRoleControls(value.roleControls, limits.roleControls),
    contextRoleControls: limitArray(value.contextRoleControls, limits.contextRoleControls),
    tables: limitUiTables(value.tables, limits.tables),
    sections: limitSections(value.sections, limits.sections),
    controlNames: limitStringArrayBalanced(value.controlNames, limits.controlNames, 96),
    roleCounts: limits.roleCounts === 0 ? null : value.roleCounts,
    controls: limitArray(value.controls, limits.controls),
  });
}

function compactRecordToLimit(
  value: JsonRecord,
  maxChars: number,
  shrinkOrder: ReadonlyArray<string>,
): string {
  const candidate = { ...value };
  let compact = compactJson(dropEmpty(candidate));
  if (compact.length <= maxChars) return compact;

  for (const key of shrinkOrder) {
    const entry = candidate[key];
    if (Array.isArray(entry) && entry.length > 0) {
      const nextLength = Math.max(0, Math.floor(entry.length / 2));
      if (nextLength === 0) continue;
      candidate[key] = shrinkArrayForKey(key, entry, nextLength);
      compact = compactJson(dropEmpty(candidate));
      if (compact.length <= maxChars) return compact;
    } else if (key === 'roleControls' && isRecord(entry)) {
      candidate[key] = limitRoleControls(
        entry,
        Math.max(1, Math.floor(maxRoleControlsPerRole(entry) / 2)),
      );
      compact = compactJson(dropEmpty(candidate));
      if (compact.length <= maxChars) return compact;
    } else if (entry && typeof entry === 'object') {
      delete candidate[key];
      compact = compactJson(dropEmpty(candidate));
      if (compact.length <= maxChars) return compact;
    }
  }

  let shrankArray = true;
  while (shrankArray) {
    shrankArray = false;
    for (const key of shrinkOrder) {
      const entry = candidate[key];
      if (!Array.isArray(entry) || entry.length === 0) continue;
      const nextLength = Math.max(0, Math.floor(entry.length / 2));
      if (nextLength === entry.length) continue;
      candidate[key] = shrinkArrayForKey(key, entry, nextLength);
      shrankArray = true;
      compact = compactJson(dropEmpty(candidate));
      if (compact.length <= maxChars) return compact;
    }
  }

  for (const key of [...Object.keys(candidate)].reverse()) {
    delete candidate[key];
    compact = compactJson(dropEmpty(candidate));
    if (compact.length <= maxChars) return compact;
  }

  return '{}';
}

function shrinkArrayForKey(key: string, entry: unknown[], nextLength: number): unknown {
  if (key === 'controlNames') return limitStringArrayBalanced(entry, nextLength, 96);
  if (key === 'sections') return limitSectionsBalanced(entry, nextLength);
  if (key === 'visibleTextSnippets') return limitVisibleTextSnippets(entry, nextLength);
  if (key === 'tables') return limitUiTables(entry, nextLength);
  if (key === 'fields') return limitUiFields(entry, nextLength);
  return entry.slice(0, nextLength);
}

function omitKeys(value: JsonRecord, keys: ReadonlyArray<string>): JsonRecord {
  const omit = new Set(keys);
  return dropEmpty(Object.fromEntries(Object.entries(value).filter(([key]) => !omit.has(key))));
}

function limitArray(value: unknown, limit: number | undefined): unknown {
  if (!Array.isArray(value)) return value;
  if (limit === undefined) return value;
  if (limit <= 0) return null;
  return value.slice(0, limit);
}

function limitUiFields(value: unknown, limit: number | undefined): unknown {
  if (!Array.isArray(value)) return value;
  if (limit === undefined) return value;
  if (limit <= 0) return null;
  if (value.length <= limit) return value;
  return value
    .map((entry, index) => ({ entry, index, score: uiFieldSalienceScore(entry) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry);
}

function limitVisibleTextSnippets(value: unknown, limit: number | undefined): unknown {
  if (!Array.isArray(value)) return value;
  if (limit === undefined) return value.map(compactVisibleTextSnippetForStorage);
  if (limit <= 0) return null;
  return value.slice(0, limit).map(compactVisibleTextSnippetForStorage);
}

function compactVisibleTextSnippetForStorage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return dropEmpty({
    text: typeof value.text === 'string' ? fitText(value.text, 260) : value.text,
    contextLabels: limitStringArray(value.contextLabels, 4, 120),
    index: value.index,
  });
}

function compactUiFieldsForStorage(value: unknown, limit: number | undefined): unknown {
  const fields = limitUiFields(value, limit);
  if (!Array.isArray(fields)) return fields;
  return fields.map(compactUiFieldForStorage);
}

function compactUiFieldForStorage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const options = limitStringArray(value.options, MAX_STORED_UI_FIELD_OPTIONS, 120);
  const rawOptions = Array.isArray(value.options) ? value.options : null;
  return dropEmpty({
    order: value.order,
    label: typeof value.label === 'string' ? fitText(value.label, 140) : value.label,
    role: value.role,
    controlName:
      typeof value.controlName === 'string' ? fitText(value.controlName, 140) : value.controlName,
    value: typeof value.value === 'string' ? fitText(value.value, 180) : value.value,
    displayText:
      typeof value.displayText === 'string' ? fitText(value.displayText, 180) : value.displayText,
    options,
    optionCount:
      rawOptions && rawOptions.length > MAX_STORED_UI_FIELD_OPTIONS ? rawOptions.length : null,
    symbolMarkers: limitSymbolMarkers(value.symbolMarkers, 4),
    adjacentControls: limitArray(
      value.adjacentControls,
      MAX_STORED_UI_FIELD_ADJACENT_CONTROLS,
    ),
    checked: value.checked,
    selected: value.selected,
    disabled: value.disabled,
    expanded: value.expanded,
    controlIndex: value.controlIndex,
    nodeId: value.nodeId,
    required: value.required,
  });
}

function limitSymbolMarkers(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .slice(0, limit)
    .map((entry) => {
      if (!isRecord(entry)) return entry;
      return dropEmpty({
        glyph: typeof entry.glyph === 'string' ? fitText(entry.glyph, 16) : entry.glyph,
        source: typeof entry.source === 'string' ? fitText(entry.source, 32) : entry.source,
        text: typeof entry.text === 'string' ? fitText(entry.text, 120) : entry.text,
      });
    })
    .filter((entry) => isRecord(entry) && Object.keys(entry).length > 0);
}

function limitUiTables(value: unknown, limit: number | undefined): unknown {
  if (!Array.isArray(value)) return value;
  if (limit === undefined) return value.map(compactUiTable);
  if (limit <= 0) return null;
  if (value.length <= limit) return value.map(compactUiTable);
  return value
    .map((entry, index) => ({ entry, index, score: uiTableSalienceScore(entry) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => compactUiTable(entry));
}

function compactUiTable(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return dropEmpty({
    index: value.index,
    role: value.role,
    columnLabels: limitStringArray(value.columnLabels, 12, 80),
    rowCount: value.rowCount,
    interactiveControlCount: value.interactiveControlCount,
    interactiveControls: limitInteractiveControls(value.interactiveControls, 12),
    columnValueSamples: limitColumnValueSamples(value.columnValueSamples, 8, 6),
    rowSamples: limitTableRows(value.rowSamples, 2),
  });
}

function limitInteractiveControls(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .slice(0, limit)
    .map((entry) => {
      if (!isRecord(entry)) return entry;
      return dropEmpty({
        index: entry.index,
        role: entry.role,
        name: typeof entry.name === 'string' ? fitText(entry.name, 120) : entry.name,
      });
    })
    .filter((entry) => isRecord(entry) && Object.keys(entry).length > 0);
}

function limitColumnValueSamples(
  value: unknown,
  columnLimit: number,
  valueLimit: number,
): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .slice(0, columnLimit)
    .map((entry) => {
      if (!isRecord(entry)) return entry;
      return dropEmpty({
        column: entry.column,
        values: limitStringArray(entry.values, valueLimit, 120),
      });
    })
    .filter((entry) => isRecord(entry) && Object.keys(entry).length > 0);
}

function limitTableRows(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  if (limit <= 0) return null;
  if (value.length <= limit) return value;
  return value
    .map((entry, index) => ({ entry, index, score: tableRowSalienceScore(entry) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry);
}

function uiTableSalienceScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  let score = 0;
  if (Array.isArray(value.rowSamples)) {
    score += Math.min(
      value.rowSamples.reduce((total, row) => total + tableRowSalienceScore(row), 0),
      24,
    );
  }
  if (Array.isArray(value.columnValueSamples)) score += Math.min(value.columnValueSamples.length, 8);
  if (Array.isArray(value.columnLabels)) score += Math.min(value.columnLabels.length, 6);
  if (typeof value.interactiveControlCount === 'number') {
    score += Math.min(value.interactiveControlCount, 6);
  }
  return score;
}

function tableRowSalienceScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>((score, entry) => {
    if (typeof entry !== 'string') return score;
    const trimmed = entry.trim();
    if (!trimmed) return score;
    return score + 1 + Math.min(Math.ceil(trimmed.length / 80), 4);
  }, 0);
}

function uiFieldSalienceScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  let score = 0;
  if (typeof value.value === 'string' && value.value.trim().length > 0) score += 4;
  if (typeof value.displayText === 'string' && value.displayText.trim().length > 0) score += 4;
  if (Array.isArray(value.adjacentControls) && value.adjacentControls.length > 0) score += 3;
  if (Array.isArray(value.symbolMarkers) && value.symbolMarkers.length > 0) score += 3;
  if (Array.isArray(value.options) && value.options.length > 0) score += 2;
  if (value.checked !== undefined && value.checked !== null && value.checked !== '') score += 8;
  if (value.selected !== undefined && value.selected !== null && value.selected !== '') score += 4;
  if (value.disabled === true) score += 2;
  if (value.expanded !== undefined && value.expanded !== null && value.expanded !== '') score += 2;
  if (value.required === true) score += 1;
  return score;
}

function limitSections(value: unknown, limit: number | undefined): unknown {
  if (!Array.isArray(value)) return value;
  if (limit !== undefined && limit <= 0) return null;
  const sections = value.filter(isRecord).map((section) =>
    dropEmpty({
      label: typeof section.label === 'string' ? fitText(section.label, 160) : null,
      landmarkRole: typeof section.landmarkRole === 'string' ? fitText(section.landmarkRole, 80) : null,
      structuralPath: limitSectionStructuralPath(section.structuralPath),
      controlNames: limitStringArray(section.controlNames, 12, 96),
      textSnippets: limitStringArrayBalanced(section.textSnippets, 4, 120),
      controlCount: section.controlCount,
      firstControlIndex: section.firstControlIndex,
    }),
  );
  if (limit === undefined || sections.length <= limit) return sections;
  return selectInformativeSections(sections, limit);
}

function limitSectionsBalanced(value: unknown[], limit: number): unknown {
  if (limit <= 0) return null;
  const sections = limitSections(value, undefined);
  if (!Array.isArray(sections) || sections.length <= limit) return sections;
  return selectInformativeSections(sections.filter(isRecord), limit);
}

function selectInformativeSections(sections: JsonRecord[], limit: number): JsonRecord[] {
  if (limit <= 0) return [];
  if (sections.length <= limit) return sections;
  const selected = new Map<number, JsonRecord>();
  selected.set(0, sections[0]);
  const selectedSignatures = new Set<string>([sectionStructuralSignature(sections[0])]);
  const remaining = sections.slice(1).map((section, offset) => ({
    section,
    index: offset + 1,
  }));
  while (selected.size < limit && remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftScore = sectionCoverageScore(left.section, selectedSignatures);
      const rightScore = sectionCoverageScore(right.section, selectedSignatures);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.index - right.index;
    });
    const [next] = remaining.splice(0, 1);
    selected.set(next.index, next.section);
    selectedSignatures.add(sectionStructuralSignature(next.section));
  }
  return Array.from(selected.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, section]) => section);
}

function sectionCoverageScore(section: JsonRecord, selectedSignatures: ReadonlySet<string>): number {
  const textCount = Array.isArray(section.textSnippets) ? section.textSnippets.length : 0;
  const controlCount = Array.isArray(section.controlNames) ? section.controlNames.length : 0;
  const structuralDepth = Array.isArray(section.structuralPath) ? section.structuralPath.length : 0;
  const rawControlCount = typeof section.controlCount === 'number' ? section.controlCount : 0;
  const structuralSignature = sectionStructuralSignature(section);
  const diversityBonus = selectedSignatures.has(structuralSignature) ? 0 : 8;
  return (
    textCount * 4 +
    controlCount * 2 +
    structuralDepth +
    Math.min(rawControlCount, 8) +
    diversityBonus
  );
}

function sectionStructuralSignature(section: JsonRecord): string {
  if (!Array.isArray(section.structuralPath) || section.structuralPath.length === 0) {
    return 'root';
  }
  const path = section.structuralPath.filter(isRecord);
  const firstStructuralAncestor = path[0];
  if (!firstStructuralAncestor) return 'root';
  const role = typeof firstStructuralAncestor.role === 'string' ? firstStructuralAncestor.role : '';
  const label =
    typeof firstStructuralAncestor.label === 'string' ? firstStructuralAncestor.label : '';
  return `${role}\u0000${label}`;
}

function limitSectionStructuralPath(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  const path = value
    .filter(isRecord)
    .slice(0, 4)
    .map((entry) =>
      dropEmpty({
        role: typeof entry.role === 'string' ? fitText(entry.role, 80) : null,
        label: typeof entry.label === 'string' ? fitText(entry.label, 120) : null,
      }),
    )
    .filter((entry) => Object.keys(entry).length > 0);
  return path.length > 0 ? path : null;
}

function limitRoleControls(value: unknown, perRoleLimit: number | undefined): JsonRecord | null {
  if (!isRecord(value)) return null;
  if (perRoleLimit !== undefined && perRoleLimit <= 0) return null;
  const out: JsonRecord = {};
  for (const [role, controls] of Object.entries(value)) {
    if (!Array.isArray(controls) || controls.length === 0) continue;
    out[role] = perRoleLimit === undefined ? controls : controls.slice(0, perRoleLimit);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function maxRoleControlsPerRole(value: JsonRecord): number {
  let max = 0;
  for (const controls of Object.values(value)) {
    if (Array.isArray(controls)) max = Math.max(max, controls.length);
  }
  return max;
}

function limitStringArray(
  value: unknown,
  limit: number | undefined,
  maxItemChars: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit)
    .map((entry) => fitText(entry, maxItemChars));
}

function limitStringArrayBalanced(
  value: unknown,
  limit: number | undefined,
  maxItemChars: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  if (limit !== undefined && limit <= 0) return null;
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => fitText(entry, maxItemChars));
  if (limit === undefined || entries.length <= limit) return entries;
  const headCount = Math.ceil(limit / 2);
  const tailCount = limit - headCount;
  return [...entries.slice(0, headCount), ...entries.slice(entries.length - tailCount)];
}

function dropEmpty(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
