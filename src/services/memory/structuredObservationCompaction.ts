type JsonRecord = Record<string, unknown>;

const UI_INVENTORY_ARRAY_COMPACT_ORDER = [
  'controls',
  'controlNames',
  'previousControlNames',
  'roleCounts',
  'tables',
  'sections',
  'labelValues',
  'searchControls',
  'textEntryControls',
  'fields',
  'fieldLabels',
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
      fields: 24,
      textEntryControls: 24,
      searchControls: 12,
      labelValues: 24,
      tables: 4,
      sections: 32,
      controlNames: 160,
      previousControlNames: 80,
      controls: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 48,
      fields: 24,
      textEntryControls: 24,
      searchControls: 12,
      labelValues: 24,
      tables: 4,
      sections: 24,
      controlNames: 96,
      previousControlNames: 64,
      controls: 0,
      roleCounts: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 36,
      fields: 16,
      textEntryControls: 16,
      searchControls: 8,
      labelValues: 12,
      tables: 2,
      sections: 16,
      controlNames: 64,
      previousControlNames: 48,
      controls: 0,
      roleCounts: 0,
    }),
    limitInventoryArrays(value, {
      fieldLabels: 24,
      fields: 8,
      textEntryControls: 8,
      searchControls: 4,
      labelValues: 8,
      tables: 1,
      sections: 8,
      controlNames: 32,
      previousControlNames: 32,
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

  const minimal = dropEmpty({
    fieldLabels: limitStringArray(value.fieldLabels, 16, 96),
    controlNames: limitStringArrayBalanced(value.controlNames, 24, 96),
    sections: limitArray(value.sections, 8),
    fields: limitArray(value.fields, 4),
    textEntryControls: limitArray(value.textEntryControls, 4),
    searchControls: limitArray(value.searchControls, 2),
    url: value.url,
    sourceRunId: value.sourceRunId,
    stateIndex: value.stateIndex,
    previousUrl: value.previousUrl,
    previousAction: value.previousAction,
    previousStateIndex: value.previousStateIndex,
    previousControlNames: limitStringArrayBalanced(value.previousControlNames, 16, 96),
    nodeCount: value.nodeCount,
    controlCount: value.controlCount,
    textEntryCount: value.textEntryCount,
    searchControlCount: value.searchControlCount,
  });
  return compactRecordToLimit(minimal, maxChars, UI_INVENTORY_ARRAY_COMPACT_ORDER);
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
    fields: limitArray(value.fields, limits.fields),
    textEntryControls: limitArray(value.textEntryControls, limits.textEntryControls),
    searchControls: limitArray(value.searchControls, limits.searchControls),
    labelValues: limitArray(value.labelValues, limits.labelValues),
    tables: limitArray(value.tables, limits.tables),
    sections: limitArray(value.sections, limits.sections),
    controlNames: limitStringArrayBalanced(value.controlNames, limits.controlNames, 96),
    previousControlNames: limitStringArrayBalanced(
      value.previousControlNames,
      limits.previousControlNames,
      96,
    ),
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
      candidate[key] = entry.slice(0, Math.max(0, Math.floor(entry.length / 2)));
      compact = compactJson(dropEmpty(candidate));
      if (compact.length <= maxChars) return compact;
    } else if (entry && typeof entry === 'object') {
      delete candidate[key];
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

function limitStringArray(value: unknown, limit: number, maxItemChars: number): string[] | null {
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
