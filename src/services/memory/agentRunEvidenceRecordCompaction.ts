import { fitAgentRunText } from './agentRunEvidenceCompaction';

export type JsonRecord = Record<string, unknown>;

const MAX_RECORD_CHARS = 10_000;
const MIN_COMPACT_OBSERVATION_CHARS = 700;
const MIN_COMPACT_TOOL_RESULT_CHARS = 520;
const MIN_OBSERVED_AFFORDANCE_ITEMS = 18;
const MIN_OBSERVED_CONTROL_SEQUENCE_ITEMS = 32;

interface CompactRecordLimits {
  maxStringChars: number;
  maxTopLevelArrayItems: number;
  maxNestedArrayItems: number;
}

const COMPACT_RECORD_LIMITS: CompactRecordLimits[] = [
  { maxStringChars: 1_200, maxTopLevelArrayItems: 32, maxNestedArrayItems: 12 },
  { maxStringChars: 900, maxTopLevelArrayItems: 28, maxNestedArrayItems: 10 },
  { maxStringChars: 700, maxTopLevelArrayItems: 24, maxNestedArrayItems: 8 },
  { maxStringChars: 520, maxTopLevelArrayItems: 20, maxNestedArrayItems: 6 },
  { maxStringChars: 360, maxTopLevelArrayItems: 18, maxNestedArrayItems: 5 },
  { maxStringChars: 260, maxTopLevelArrayItems: 16, maxNestedArrayItems: 4 },
  { maxStringChars: 180, maxTopLevelArrayItems: 16, maxNestedArrayItems: 3 },
  { maxStringChars: 120, maxTopLevelArrayItems: 14, maxNestedArrayItems: 3 },
  { maxStringChars: 80, maxTopLevelArrayItems: 14, maxNestedArrayItems: 2 },
  { maxStringChars: 60, maxTopLevelArrayItems: 12, maxNestedArrayItems: 2 },
];

export function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function scalarField(record: JsonRecord, field: string): string | number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined;
}

export function compactRecord(value: JsonRecord): string {
  for (const limits of COMPACT_RECORD_LIMITS) {
    const compacted = compactRecordValue(value, limits, 0);
    const json = JSON.stringify(compacted);
    if (json.length <= MAX_RECORD_CHARS) return json;
  }

  const structuredFallback = compactStructuredEvidenceRecord(value);
  if (structuredFallback) return structuredFallback;

  const fallback = compactRecordScalars(value);
  const fallbackJson = JSON.stringify(fallback);
  if (fallbackJson.length <= MAX_RECORD_CHARS) return fallbackJson;

  return JSON.stringify({
    sourceRunId: stringField(value, 'sourceRunId'),
    goal: fitAgentRunText(String(value.goal ?? ''), 360),
    status: fitAgentRunText(String(value.status ?? ''), 120),
    outcome: fitAgentRunText(String(value.outcome ?? ''), 120),
  });
}

function compactRecordValue(
  value: unknown,
  limits: CompactRecordLimits,
  depth: number,
  fieldName?: string,
): unknown {
  if (typeof value === 'string') {
    return fitAgentRunText(value, compactStringLimit(fieldName, limits));
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const baseMaxItems = depth <= 1 ? limits.maxTopLevelArrayItems : limits.maxNestedArrayItems;
    const maxItems =
      fieldName === 'observedAffordances'
        ? Math.max(baseMaxItems, MIN_OBSERVED_AFFORDANCE_ITEMS)
        : fieldName === 'observedControlSequence'
          ? Math.max(baseMaxItems, MIN_OBSERVED_CONTROL_SEQUENCE_ITEMS)
          : baseMaxItems;
    const selected =
      fieldName === 'observedControlSequence'
        ? value.slice(0, maxItems)
        : sampleArray(value, maxItems);
    return selected
      .map((entry) => compactRecordValue(entry, limits, depth + 1, fieldName))
      .filter(hasRecordValue);
  }
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .map(([key, entry]) => [key, compactRecordValue(entry, limits, depth + 1, key)] as const)
      .filter(([, entry]) => hasRecordValue(entry)),
  );
}

function compactStringLimit(fieldName: string | undefined, limits: CompactRecordLimits): number {
  if (fieldName === 'observation' || fieldName === 'accessibility_tree') {
    return Math.max(limits.maxStringChars, MIN_COMPACT_OBSERVATION_CHARS);
  }
  if (fieldName === 'toolResult' || fieldName === 'tool_result') {
    return Math.max(limits.maxStringChars, MIN_COMPACT_TOOL_RESULT_CHARS);
  }
  return limits.maxStringChars;
}

function compactRecordScalars(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string' || typeof entry === 'number')
      .map(([key, entry]) => [
        key,
        typeof entry === 'string' ? fitAgentRunText(entry, 360) : entry,
      ]),
  );
}

function compactStructuredEvidenceRecord(value: JsonRecord): string | null {
  const stepField = Array.isArray(value.lastSteps)
    ? 'lastSteps'
    : Array.isArray(value.steps)
      ? 'steps'
      : Array.isArray(value.waypoints)
        ? 'waypoints'
        : null;
  if (!stepField) return null;
  const sourceSteps = value[stepField] as unknown[];
  const budgets = [
    { maxSteps: 6, maxAffordances: 18, maxControls: 32, observationChars: 240 },
    { maxSteps: 6, maxAffordances: 18, maxControls: 32, observationChars: 0 },
    { maxSteps: 4, maxAffordances: 18, maxControls: 32, observationChars: 0 },
    { maxSteps: 3, maxAffordances: 18, maxControls: 32, observationChars: 0 },
    { maxSteps: 6, maxAffordances: 12, maxControls: 24, observationChars: 160 },
    { maxSteps: 4, maxAffordances: 12, maxControls: 24, observationChars: 0 },
    { maxSteps: 3, maxAffordances: 8, maxControls: 18, observationChars: 0 },
  ];

  for (const budget of budgets) {
    const compact = Object.fromEntries(
      Object.entries({
        sourceRunId: stringField(value, 'sourceRunId'),
        status: stringField(value, 'status'),
        outcome: stringField(value, 'outcome'),
        tools: Array.isArray(value.tools) ? value.tools.slice(0, 8) : undefined,
        [stepField]: sampleArray(sourceSteps, budget.maxSteps)
          .map((step) => compactStructuredEvidenceStep(step, budget))
          .filter(hasRecordValue),
      }).filter(([, entry]) => hasRecordValue(entry)),
    );
    const json = JSON.stringify(compact);
    if (json.length <= MAX_RECORD_CHARS) return json;
  }
  return null;
}

function compactStructuredEvidenceStep(
  value: unknown,
  budget: { maxAffordances: number; maxControls: number; observationChars: number },
): JsonRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  return Object.fromEntries(
    Object.entries({
      stateIndex: scalarField(record, 'stateIndex') ?? scalarField(record, 'state_index'),
      status: stringField(record, 'status'),
      toolName: stringField(record, 'toolName') ?? stringField(record, 'tool_name'),
      action: stringField(record, 'action')
        ? fitAgentRunText(stringField(record, 'action') ?? '', 180)
        : undefined,
      thought: stringField(record, 'thought')
        ? fitAgentRunText(stringField(record, 'thought') ?? '', 180)
        : undefined,
      observedControlSequence: compactObservedAffordances(
        record.observedControlSequence,
        budget.maxControls,
        { preservePrefix: true },
      ),
      observedAffordances: compactObservedAffordances(
        record.observedAffordances,
        budget.maxAffordances,
      ),
      inputControlsPresent:
        typeof record.inputControlsPresent === 'boolean' ? record.inputControlsPresent : undefined,
      observation:
        budget.observationChars > 0 && stringField(record, 'observation')
          ? fitAgentRunText(stringField(record, 'observation') ?? '', budget.observationChars)
          : undefined,
      toolResult:
        budget.observationChars > 0 &&
        (stringField(record, 'toolResult') ?? stringField(record, 'tool_result'))
          ? fitAgentRunText(
              stringField(record, 'toolResult') ?? stringField(record, 'tool_result') ?? '',
              budget.observationChars,
            )
          : undefined,
    }).filter(([, entry]) => hasRecordValue(entry)),
  );
}

function compactObservedAffordances(
  value: unknown,
  limit: number,
  options: { preservePrefix?: boolean } = {},
): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const compacted = (
    options.preservePrefix
      ? value.slice(0, Math.max(1, limit))
      : sampleArray(value, Math.max(1, limit))
  )
    .map((entry): JsonRecord | undefined => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
      const record = entry as JsonRecord;
      return Object.fromEntries(
        Object.entries({
          role: stringField(record, 'role'),
          label: stringField(record, 'label')
            ? fitAgentRunText(stringField(record, 'label') ?? '', 140)
            : undefined,
          attributes: stringField(record, 'attributes')
            ? fitAgentRunText(stringField(record, 'attributes') ?? '', 140)
            : undefined,
          section: stringField(record, 'section')
            ? fitAgentRunText(stringField(record, 'section') ?? '', 140)
            : undefined,
        }).filter(([, item]) => hasRecordValue(item)),
      ) as JsonRecord;
    })
    .filter((entry): entry is JsonRecord => entry !== undefined && hasRecordValue(entry));
  return compacted.length > 0 ? compacted : undefined;
}

function compactRecordPreservingArrays(
  value: JsonRecord,
  requiredArrays: ReadonlyArray<string>,
): string | null {
  const compacted = compactRecord(value);
  try {
    const parsed = JSON.parse(compacted) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as JsonRecord;
    for (const key of requiredArrays) {
      if (!Array.isArray(record[key]) || record[key].length === 0) return null;
    }
    return compacted;
  } catch {
    return null;
  }
}

export function compactProcedureRecord(params: {
  base: JsonRecord;
  waypoints: JsonRecord[];
  steps: JsonRecord[];
  sources: string[];
}): string {
  const { base, waypoints, steps, sources } = params;
  const full = compactRecordPreservingArrays({ ...base, sources, waypoints, steps }, [
    'waypoints',
    'steps',
  ]);
  if (full) return full;

  const conciseSteps = sampleArray(steps, Math.min(4, steps.length));
  const concise = compactRecordPreservingArrays(
    { ...base, sources: sources.slice(0, 8), waypoints, steps: conciseSteps },
    ['waypoints'],
  );
  if (concise) return concise;

  const waypointOnly = compactRecordPreservingArrays(
    { ...base, sources: sources.slice(0, 8), waypoints },
    ['waypoints'],
  );
  if (waypointOnly) return waypointOnly;

  return compactRecord({ ...base, sources: sources.slice(0, 8), steps });
}

function hasRecordValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as JsonRecord).length > 0;
  return true;
}

function sampleArray<T>(values: ReadonlyArray<T>, maxItems: number): T[] {
  if (values.length <= maxItems) return [...values];
  if (maxItems <= 1) return values[0] === undefined ? [] : [values[0]];
  const lastIndex = values.length - 1;
  const sampled: T[] = [];
  const seen = new Set<number>();
  for (let slot = 0; slot < maxItems; slot += 1) {
    const index = Math.round((slot * lastIndex) / (maxItems - 1));
    if (seen.has(index)) continue;
    const value = values[index];
    if (value === undefined) continue;
    seen.add(index);
    sampled.push(value);
  }
  return sampled;
}
