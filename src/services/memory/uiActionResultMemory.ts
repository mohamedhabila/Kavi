type JsonRecord = Record<string, unknown>;

type ActionResultEvidenceBudget = {
  textChars: number;
  actionTrail: number;
  actionTrailTextChars: number;
  surfaceLabels: number;
  visibleTextSnippets: number;
  fieldLabels: number;
  fields: number;
  sections: number;
  actionControls: number;
  controlNames: number;
};

const ACTION_RESULT_EVIDENCE_BUDGETS: ActionResultEvidenceBudget[] = [
  {
    textChars: 900,
    actionTrail: 8,
    actionTrailTextChars: 240,
    surfaceLabels: 16,
    visibleTextSnippets: 16,
    fieldLabels: 12,
    fields: 4,
    sections: 4,
    actionControls: 24,
    controlNames: 80,
  },
  {
    textChars: 700,
    actionTrail: 8,
    actionTrailTextChars: 220,
    surfaceLabels: 12,
    visibleTextSnippets: 12,
    fieldLabels: 8,
    fields: 3,
    sections: 3,
    actionControls: 16,
    controlNames: 48,
  },
  {
    textChars: 520,
    actionTrail: 6,
    actionTrailTextChars: 200,
    surfaceLabels: 8,
    visibleTextSnippets: 8,
    fieldLabels: 6,
    fields: 2,
    sections: 2,
    actionControls: 10,
    controlNames: 32,
  },
  {
    textChars: 360,
    actionTrail: 6,
    actionTrailTextChars: 180,
    surfaceLabels: 6,
    visibleTextSnippets: 6,
    fieldLabels: 4,
    fields: 1,
    sections: 1,
    actionControls: 6,
    controlNames: 24,
  },
  {
    textChars: 260,
    actionTrail: 6,
    actionTrailTextChars: 160,
    surfaceLabels: 4,
    visibleTextSnippets: 4,
    fieldLabels: 0,
    fields: 0,
    sections: 0,
    actionControls: 4,
    controlNames: 0,
  },
];

export interface UiActionTrailEntry {
  action: string | null;
  thought: string | null;
  stateIndex?: string;
}

export interface UiActionResultMemoryInput {
  action: string | null;
  thought: string | null;
  goal: string | null;
  trajectoryOutcome: string | null;
  url: string | null;
  sourceRunId?: string;
  stateIndex?: string;
  previousAction?: string | null;
  previousThought?: string | null;
  previousStateIndex?: string;
  recentActionTrail?: ReadonlyArray<UiActionTrailEntry>;
  inventoryPayload: JsonRecord;
  maxTextChars: number;
}

export interface UiActionResultMemoryPayload {
  objectText: string;
  attributes: JsonRecord;
}

export function buildUiActionResultMemory(
  input: UiActionResultMemoryInput,
): UiActionResultMemoryPayload | null {
  if (!input.action) return null;
  const objectText = compactActionResultForStorage(input);
  return {
    objectText,
    attributes: {
      url: input.url,
      action: input.action,
      thought: input.thought,
      goal: input.goal,
      trajectoryOutcome: input.trajectoryOutcome,
      sourceRunId: input.sourceRunId,
      stateIndex: input.stateIndex,
      previousAction: input.previousAction,
      previousThought: input.previousThought,
      previousStateIndex: input.previousStateIndex,
    },
  };
}

function compactActionResultForStorage(input: UiActionResultMemoryInput): string {
  for (const budget of ACTION_RESULT_EVIDENCE_BUDGETS) {
    const compact = JSON.stringify(buildActionResultPayload(input, budget));
    if (compact.length <= input.maxTextChars) return compact;
  }
  return JSON.stringify(
    dropEmpty({
      action: fitText(input.action ?? '', 180),
      thought: fitText(input.thought ?? '', 180),
      url: fitText(input.url ?? '', 220),
      sourceRunId: input.sourceRunId,
      stateIndex: input.stateIndex,
      previousAction: fitText(input.previousAction ?? '', 180),
      previousThought: fitText(input.previousThought ?? '', 180),
      previousStateIndex: input.previousStateIndex,
      recentActionTrail: limitActionTrail(input.recentActionTrail, 8, 180),
    }),
  );
}

function buildActionResultPayload(
  input: UiActionResultMemoryInput,
  budget: ActionResultEvidenceBudget,
): JsonRecord {
  const priorityControlIds = extractActionControlIds([
    input.action,
    input.previousAction,
    ...(input.recentActionTrail ?? []).map((entry) => entry.action),
  ]);
  return dropEmpty({
    action: fitText(input.action ?? '', budget.textChars),
    thought: fitText(input.thought ?? '', budget.textChars),
    url: fitText(input.url ?? '', 360),
    sourceRunId: input.sourceRunId,
    stateIndex: input.stateIndex,
    previousAction: fitText(input.previousAction ?? '', budget.textChars),
    previousThought: fitText(input.previousThought ?? '', budget.textChars),
    previousStateIndex: input.previousStateIndex,
    surfaceLabels: limitStringArray(input.inventoryPayload.surfaceLabels, budget.surfaceLabels, 160),
    visibleTextSnippets: limitVisibleTextSnippets(
      input.inventoryPayload.visibleTextSnippets,
      budget.visibleTextSnippets,
    ),
    recentActionTrail: limitActionTrail(
      input.recentActionTrail,
      budget.actionTrail,
      budget.actionTrailTextChars,
    ),
    fieldLabels: limitStringArray(input.inventoryPayload.fieldLabels, budget.fieldLabels, 140),
    fields: limitFields(input.inventoryPayload.fields, budget.fields),
    sections: limitSections(input.inventoryPayload.sections, budget.sections),
    actionControls: limitControls(
      input.inventoryPayload.actionControls,
      budget.actionControls,
      priorityControlIds,
    ),
    controlNames: limitStringArrayBalanced(
      input.inventoryPayload.controlNames,
      budget.controlNames,
      160,
    ),
  });
}

function limitActionTrail(
  value: ReadonlyArray<UiActionTrailEntry> | undefined,
  limit: number,
  maxTextChars: number,
): JsonRecord[] {
  if (!value || limit <= 0) return [];
  return value
    .slice(-limit)
    .map((entry) =>
      dropEmpty({
        stateIndex: entry.stateIndex,
        action: fitBalancedText(entry.action ?? '', maxTextChars),
        thought: fitBalancedText(entry.thought ?? '', maxTextChars),
      }),
    )
    .filter((entry) => Object.keys(entry).length > 0);
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxChars <= 0) return '';
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 1) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function fitBalancedText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxChars <= 0) return '';
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 8) return fitText(trimmed, maxChars);
  const headChars = Math.ceil((maxChars - 1) * 0.55);
  const tailChars = Math.floor((maxChars - 1) * 0.45);
  return `${trimmed.slice(0, headChars).trimEnd()}…${trimmed.slice(-tailChars).trimStart()}`;
}

function limitStringArray(value: unknown, limit: number, maxEntryChars: number): string[] {
  if (limit <= 0 || !Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => fitText(entry, maxEntryChars))
    .slice(0, limit);
}

function limitStringArrayBalanced(value: unknown, limit: number, maxEntryChars: number): string[] {
  const entries = limitStringArray(value, Number.MAX_SAFE_INTEGER, maxEntryChars);
  return limitBalanced(entries, limit);
}

function limitVisibleTextSnippets(value: unknown, limit: number): JsonRecord[] {
  if (limit <= 0 || !Array.isArray(value)) return [];
  return value
    .map((entry) => pickRecord(entry, ['index', 'text', 'contextLabels'], { text: 520 }))
    .filter(Boolean)
    .slice(0, limit) as JsonRecord[];
}

function limitFields(value: unknown, limit: number): JsonRecord[] {
  if (limit <= 0 || !Array.isArray(value)) return [];
  return value
    .map((entry) =>
      pickRecord(entry, ['order', 'label', 'role', 'controlName', 'value', 'symbolMarkers'], {
        label: 160,
        controlName: 160,
        value: 220,
      }),
    )
    .filter(Boolean)
    .slice(0, limit) as JsonRecord[];
}

function limitSections(value: unknown, limit: number): JsonRecord[] {
  if (limit <= 0 || !Array.isArray(value)) return [];
  return value
    .map((entry) =>
      pickRecord(
        entry,
        [
          'label',
          'landmarkRole',
          'structuralPath',
          'controlNames',
          'textSnippets',
          'controlCount',
          'firstControlIndex',
        ],
        {
          label: 180,
          landmarkRole: 80,
        },
      ),
    )
    .filter(Boolean)
    .slice(0, limit) as JsonRecord[];
}

function limitControls(
  value: unknown,
  limit: number,
  priorityControlIds: ReadonlySet<string>,
): JsonRecord[] {
  if (limit <= 0 || !Array.isArray(value)) return [];
  const controls = value
    .map((entry) =>
      pickRecord(entry, ['index', 'nodeId', 'role', 'name', 'expanded', 'contextLabels'], {
        nodeId: 80,
        role: 80,
        name: 180,
        expanded: 40,
      }),
    )
    .filter(Boolean)
    .map((entry) => entry as JsonRecord);
  if (controls.length <= limit) return controls;
  const prioritized: JsonRecord[] = [];
  const rest: JsonRecord[] = [];
  for (const control of controls) {
    const ids = [control.nodeId, control.index].map((value) => String(value ?? '').trim());
    if (ids.some((id) => id && priorityControlIds.has(id))) {
      prioritized.push(control);
    } else {
      rest.push(control);
    }
  }
  const remaining = Math.max(0, limit - prioritized.length);
  return [...prioritized, ...limitBalanced(rest, remaining)].slice(0, limit);
}

function pickRecord(
  value: unknown,
  fields: ReadonlyArray<string>,
  textLimits: Record<string, number>,
): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as JsonRecord;
  const output: JsonRecord = {};
  for (const field of fields) {
    const entry = input[field];
    if (entry === undefined || entry === null || entry === '') continue;
    if (typeof entry === 'string') {
      output[field] = fitText(entry, textLimits[field] ?? 160);
      continue;
    }
    if (Array.isArray(entry)) {
      const limited = limitNestedArray(entry, field);
      if (limited.length > 0) output[field] = limited;
      continue;
    }
    output[field] = entry;
  }
  return Object.keys(output).length > 0 ? output : null;
}

function limitNestedArray(value: unknown[], field: string): unknown[] {
  if (field === 'contextLabels' || field === 'controlNames' || field === 'textSnippets') {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => fitText(entry, 160))
      .slice(0, 12);
  }
  if (field === 'symbolMarkers') {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => fitText(entry, 80))
      .slice(0, 8);
  }
  if (field === 'structuralPath') {
    return value
      .map((entry) =>
        pickRecord(entry, ['role', 'label'], {
          role: 80,
          label: 160,
        }),
      )
      .filter(Boolean)
      .slice(0, 8);
  }
  return value.slice(0, 8);
}

function limitBalanced<T>(values: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (values.length <= limit) return values;
  const headCount = Math.ceil(limit / 2);
  const tailCount = Math.floor(limit / 2);
  return [...values.slice(0, headCount), ...values.slice(-tailCount)];
}

function extractActionControlIds(actions: ReadonlyArray<string | null | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const action of actions) {
    if (!action) continue;
    for (const match of action.matchAll(/['"]([^'"]{1,80})['"]/gu)) {
      const id = match[1]?.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

function dropEmpty(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}
