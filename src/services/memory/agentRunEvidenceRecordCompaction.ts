import { fitAgentRunText } from './agentRunEvidenceCompaction';
import {
  agentRunNavigationSurfaceDepth,
  agentRunNavigationSurfaceFamilyKey,
  agentRunNavigationSurfaceKey,
} from './agentRunNavigationSurface';

export type JsonRecord = Record<string, unknown>;

const MAX_RECORD_CHARS = 10_000;
const MIN_COMPACT_OBSERVATION_CHARS = 700;
const MIN_COMPACT_TOOL_RESULT_CHARS = 520;
const MIN_OBSERVED_AFFORDANCE_ITEMS = 18;
const MIN_OBSERVED_CONTROL_SEQUENCE_ITEMS = 18;
const SMALL_AFFORDANCE_GROUP_LIMIT = 12;
const COMPACT_ACTION_GROUP_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'menuitem',
  'option',
  'radio',
  'tab',
  'textbox',
]);

interface ObservedAffordanceIndexGroup {
  indexes: number[];
  role?: string;
  sectioned: boolean;
}

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
    return sampleArray(value, maxItems)
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
  if (fieldName === 'goal') {
    return Math.max(limits.maxStringChars, 360);
  }
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
  if (!Array.isArray(value.evidenceSlices)) return null;
  const sourceSteps = value.evidenceSlices as unknown[];
  const budgets = [
    { maxSteps: 12, maxAffordances: 12, maxControls: 18, observationChars: 700 },
    { maxSteps: 12, maxAffordances: 8, maxControls: 12, observationChars: 240 },
    { maxSteps: 12, maxAffordances: 6, maxControls: 10, observationChars: 0 },
    { maxSteps: 8, maxAffordances: 8, maxControls: 12, observationChars: 240 },
    { maxSteps: 8, maxAffordances: 6, maxControls: 10, observationChars: 0 },
    { maxSteps: 6, maxAffordances: 8, maxControls: 14, observationChars: 0 },
    { maxSteps: 4, maxAffordances: 6, maxControls: 12, observationChars: 0 },
  ];

  for (const budget of budgets) {
    const compact = Object.fromEntries(
      Object.entries({
        sourceRunId: stringField(value, 'sourceRunId'),
        goal: stringField(value, 'goal'),
        status: stringField(value, 'status'),
        outcome: stringField(value, 'outcome'),
        tools: Array.isArray(value.tools) ? value.tools.slice(0, 8) : undefined,
        sources: Array.isArray(value.sources) ? value.sources.slice(0, 8) : undefined,
        artifacts: Array.isArray(value.artifacts) ? value.artifacts.slice(0, 8) : undefined,
        decisions: Array.isArray(value.decisions) ? value.decisions.slice(0, 8) : undefined,
        risks: Array.isArray(value.risks) ? value.risks.slice(0, 8) : undefined,
        summaries: Array.isArray(value.summaries) ? value.summaries.slice(0, 8) : undefined,
        evidenceSlices: selectEvidenceSlices(sourceSteps, budget.maxSteps)
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
  const observationChars =
    record.navigationAnchor === true
      ? Math.max(budget.observationChars, MIN_COMPACT_OBSERVATION_CHARS)
      : budget.observationChars;
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
      url: stringField(record, 'url')
        ? fitAgentRunText(stringField(record, 'url') ?? '', 220)
        : undefined,
      navigationAnchor:
        typeof record.navigationAnchor === 'boolean' ? record.navigationAnchor : undefined,
      observedControlSequence: compactObservedAffordances(
        record.observedControlSequence,
        budget.maxControls,
      ),
      observedAffordances: compactObservedAffordances(
        record.observedAffordances,
        budget.maxAffordances,
      ),
      inputControlsPresent:
        typeof record.inputControlsPresent === 'boolean' ? record.inputControlsPresent : undefined,
      observation:
        observationChars > 0 && stringField(record, 'observation')
          ? fitAgentRunText(stringField(record, 'observation') ?? '', observationChars)
          : undefined,
      toolResult:
        observationChars > 0 &&
        (stringField(record, 'toolResult') ?? stringField(record, 'tool_result'))
          ? fitAgentRunText(
              stringField(record, 'toolResult') ?? stringField(record, 'tool_result') ?? '',
              observationChars,
            )
          : undefined,
    }).filter(([, entry]) => hasRecordValue(entry)),
  );
}

function compactObservedAffordances(value: unknown, limit: number): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const selectedIndexes = selectObservedAffordanceIndexes(value, Math.max(1, limit));
  const compacted = selectedIndexes
    .map((index) => value[index])
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

function selectObservedAffordanceIndexes(value: ReadonlyArray<unknown>, limit: number): number[] {
  if (value.length <= limit) return Array.from({ length: value.length }, (_entry, index) => index);
  const selected = new Set<number>();
  const append = (index: number): void => {
    if (selected.size >= limit || index < 0 || index >= value.length) return;
    selected.add(index);
  };

  const grouped = observedAffordanceIndexGroups(value);
  for (const group of grouped.filter(isCompactActionGroup)) {
    for (const index of group.indexes) append(index);
  }
  const perGroupLimit = Math.max(1, Math.ceil(limit / Math.max(1, grouped.length)));
  const groupSelections = grouped.map((group) => {
    const groupLimit =
      group.indexes.length <= SMALL_AFFORDANCE_GROUP_LIMIT
        ? group.indexes.length
        : Math.min(group.indexes.length, perGroupLimit);
    return selectAnchoredSpreadIndexes(group.indexes, groupLimit);
  });
  const longestGroupSelection = Math.max(0, ...groupSelections.map((indexes) => indexes.length));
  for (let offset = 0; offset < longestGroupSelection; offset += 1) {
    for (const indexes of groupSelections) {
      const index = indexes[offset];
      if (index !== undefined) append(index);
    }
  }

  for (const index of sampleArray(
    Array.from({ length: value.length }, (_entry, index) => index),
    limit,
  )) {
    append(index);
  }

  return Array.from(selected).sort((left, right) => left - right);
}

function selectAnchoredSpreadIndexes(indexes: ReadonlyArray<number>, limit: number): number[] {
  if (indexes.length <= limit) return [...indexes];
  const selected = new Set<number>();
  const append = (index: number | undefined): void => {
    if (index === undefined || selected.size >= limit) return;
    selected.add(index);
  };
  append(indexes[0]);
  append(indexes[Math.floor(indexes.length / 2)]);
  append(indexes[indexes.length - 3]);
  append(indexes[indexes.length - 2]);
  append(indexes[indexes.length - 1]);
  for (const index of sampleArray(indexes, limit)) {
    append(index);
  }
  return Array.from(selected).sort((left, right) => left - right);
}

function observedAffordanceIndexGroups(
  value: ReadonlyArray<unknown>,
): ObservedAffordanceIndexGroup[] {
  const groups = new Map<string, ObservedAffordanceIndexGroup>();
  for (const [index, entry] of value.entries()) {
    const record =
      entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as JsonRecord) : null;
    const role = record ? stringField(record, 'role') : undefined;
    const section = record ? stringField(record, 'section') : undefined;
    const key = `${role ?? ''}\u0000${section ?? ''}`;
    const group = groups.get(key) ?? { indexes: [], role, sectioned: Boolean(section) };
    group.indexes.push(index);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .filter((group) => group.indexes.length > 0)
    .sort((left, right) => Number(right.sectioned) - Number(left.sectioned));
}

function isCompactActionGroup(group: ObservedAffordanceIndexGroup): boolean {
  return (
    group.sectioned &&
    group.indexes.length > 0 &&
    group.indexes.length <= SMALL_AFFORDANCE_GROUP_LIMIT &&
    Boolean(group.role && COMPACT_ACTION_GROUP_ROLES.has(group.role))
  );
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

export function compactAgentRunRecord(params: {
  base: JsonRecord;
  evidenceSlices: JsonRecord[];
  sources: string[];
  artifacts: string[];
  decisions: string[];
  risks: string[];
  summaries: string[];
}): string {
  const { base, evidenceSlices, sources, artifacts, decisions, risks, summaries } = params;
  const structured = compactStructuredEvidenceRecord({
    ...base,
    sources,
    artifacts,
    decisions,
    risks,
    summaries,
    evidenceSlices,
  });
  if (structured) return structured;

  const full = compactRecordPreservingArrays(
    { ...base, sources, artifacts, decisions, risks, summaries, evidenceSlices },
    ['evidenceSlices'],
  );
  if (full) return full;

  const conciseSlices = selectEvidenceSlices(evidenceSlices, Math.min(4, evidenceSlices.length));
  const concise = compactRecordPreservingArrays(
    {
      ...base,
      sources: sources.slice(0, 8),
      artifacts: artifacts.slice(0, 8),
      decisions: decisions.slice(0, 8),
      risks: risks.slice(0, 8),
      summaries: summaries.slice(0, 8),
      evidenceSlices: conciseSlices,
    },
    ['evidenceSlices'],
  );
  if (concise) return concise;

  return compactRecord({
    ...base,
    sources: sources.slice(0, 8),
    artifacts: artifacts.slice(0, 8),
    decisions: decisions.slice(0, 8),
    risks: risks.slice(0, 8),
    summaries: summaries.slice(0, 8),
    evidenceSlices: conciseSlices,
  });
}

function hasRecordValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as JsonRecord).length > 0;
  return true;
}

function selectEvidenceSlices<T>(values: ReadonlyArray<T>, maxItems: number): T[] {
  if (values.length <= maxItems) return [...values];
  if (maxItems <= 1) return values[0] === undefined ? [] : [values[0]];

  const selected = new Set<number>();
  const append = (index: number | undefined): void => {
    if (index === undefined || index < 0 || index >= values.length) return;
    if (selected.size >= maxItems) return;
    selected.add(index);
  };

  for (const index of diverseEvidenceSliceAnchorIndexes(values, maxItems)) {
    append(index);
  }
  for (const value of sampleArray(values, maxItems)) {
    append(values.indexOf(value));
  }

  return Array.from(selected)
    .sort((left, right) => left - right)
    .map((index) => values[index])
    .filter((value): value is T => value !== undefined);
}

function evidenceSliceExplicitAnchorIndexes(values: ReadonlyArray<unknown>): number[] {
  const indexes: number[] = [];
  values.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if ((value as JsonRecord).navigationAnchor === true) indexes.push(index);
  });
  return indexes;
}

function evidenceSliceRouteAnchorIndexes(values: ReadonlyArray<unknown>): number[] {
  const selected = new Set<number>();
  const surfaceVisits = new Map<string, { first: number; last: number }>();
  const append = (index: number | undefined): void => {
    if (index === undefined || index < 0 || index >= values.length) return;
    selected.add(index);
  };

  append(0);
  values.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const url = stringField(value as JsonRecord, 'url');
    const surfaceKey = agentRunNavigationSurfaceKey(url);
    if (!surfaceKey) return;
    const visit = surfaceVisits.get(surfaceKey);
    if (visit) {
      visit.last = index;
    } else {
      surfaceVisits.set(surfaceKey, { first: index, last: index });
    }
  });
  for (const visit of surfaceVisits.values()) {
    append(visit.first);
    append(visit.last);
  }
  append(values.length - 1);

  return Array.from(selected).sort((left, right) => left - right);
}

function diverseEvidenceSliceAnchorIndexes(
  values: ReadonlyArray<unknown>,
  limit: number,
): number[] {
  const anchorIndexes = Array.from(
    new Set([
      ...evidenceSliceExplicitAnchorIndexes(values),
      ...evidenceSliceRouteAnchorIndexes(values),
    ]),
  )
    .filter((index) => index >= 0 && index < values.length)
    .sort((left, right) => left - right);
  if (anchorIndexes.length <= limit) return anchorIndexes;
  const selected = new Set<number>();
  const append = (index: number | undefined): void => {
    if (index === undefined || selected.size >= limit) return;
    selected.add(index);
  };

  append(anchorIndexes[0]);
  append(anchorIndexes[anchorIndexes.length - 1]);
  const selectedFamilies = new Set(
    Array.from(selected)
      .map((index) => evidenceSliceFamilyKey(values[index]))
      .filter((familyKey): familyKey is string => Boolean(familyKey)),
  );

  while (selected.size < limit) {
    const candidates = anchorIndexes.filter((index) => !selected.has(index));
    if (candidates.length === 0) break;
    const unrepresentedFamilyCandidates = candidates.filter((index) => {
      const familyKey = evidenceSliceFamilyKey(values[index]);
      return familyKey && !selectedFamilies.has(familyKey);
    });
    const pool =
      unrepresentedFamilyCandidates.length > 0 ? unrepresentedFamilyCandidates : candidates;
    const next = pool.sort((left, right) => {
      const depthDelta = evidenceSliceDepth(values[right]) - evidenceSliceDepth(values[left]);
      if (depthDelta !== 0) return depthDelta;
      const distanceDelta =
        minDistanceToSelected(right, selected) - minDistanceToSelected(left, selected);
      if (distanceDelta !== 0) return distanceDelta;
      return left - right;
    })[0];
    if (next === undefined) break;
    append(next);
    const familyKey = evidenceSliceFamilyKey(values[next]);
    if (familyKey) selectedFamilies.add(familyKey);
  }

  return Array.from(selected).sort((left, right) => left - right);
}

function evidenceSliceUrl(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? stringField(value as JsonRecord, 'url')
    : undefined;
}

function evidenceSliceDepth(value: unknown): number {
  return agentRunNavigationSurfaceDepth(evidenceSliceUrl(value));
}

function evidenceSliceFamilyKey(value: unknown): string | undefined {
  return agentRunNavigationSurfaceFamilyKey(evidenceSliceUrl(value));
}

function minDistanceToSelected(index: number, selected: ReadonlySet<number>): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const selectedIndex of selected) {
    distance = Math.min(distance, Math.abs(index - selectedIndex));
  }
  return distance;
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
