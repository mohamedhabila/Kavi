// ---------------------------------------------------------------------------
// Kavi — Structured observation memory
// ---------------------------------------------------------------------------
// Converts structured tool/app observations into typed memory facts. This is
// intentionally metadata-driven: JSON payload fields, tool-call status, URL/app
// identifiers, and accessibility tree roles/attributes. It does not infer
// product meaning from English phrases.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { upsertEntity } from './entities';
import { recordFact } from './facts/mutations';
import type { MemoryFactKind, RecordFactInput } from './facts/types';
import { ensureFactSchema } from './schema';
import {
  compactField,
  compactUiInventory,
  extractUiStateSummary,
  parseAccessibilityTree,
  type AccessibilityNode,
} from './uiState';

const MAX_TEXT_CHARS = 4_000;
const MAX_AFFORDANCE_FACTS_PER_PAYLOAD = 96;
const MAX_FIELD_FACTS_PER_PAYLOAD = 96;
const MAX_FILTER_STATE_FACTS_PER_PAYLOAD = 96;
const UI_INVENTORY_ARRAY_COMPACT_ORDER = [
  'controls',
  'controlNames',
  'roleCounts',
  'tables',
  'labelValues',
  'searchControls',
  'textEntryControls',
  'fields',
  'fieldLabels',
] as const;

type JsonRecord = Record<string, unknown>;

interface ObservationContext {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  sourceRunId?: string;
  sourceMessageId?: string;
  sourceTurnId?: string;
  toolName?: string;
  toolStatus?: string;
  now?: number;
}

interface StructuredObservationResult {
  factIds: string[];
  consumedEvidence: string[];
}

interface ParsedPayload {
  payload: JsonRecord;
  sourceLabel: string;
}

export function recordStructuredObservationsFromMessages(input: {
  messages: ReadonlyArray<Message>;
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  sourceRunId?: string;
  sourceTurnId?: string;
  now?: number;
}): StructuredObservationResult {
  ensureFactSchema();
  const factIds: string[] = [];
  const consumedEvidence: string[] = [];

  for (const message of input.messages) {
    const toolNames = message.toolCalls?.map((toolCall) => toolCall.name).filter(Boolean) ?? [];
    const toolName = toolNames[0] ?? message.toolCallId ?? undefined;
    const toolStatus =
      message.toolCalls?.find((toolCall) => toolCall.status)?.status ??
      (message.isError ? 'failed' : undefined);
    const context: ObservationContext = {
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      sourceMessageId: message.id,
      sourceTurnId: input.sourceTurnId,
      toolName,
      toolStatus,
      now: input.now,
    };

    for (const parsed of payloadsFromMessage(message)) {
      factIds.push(...recordObservationPayload(parsed.payload, context));
    }
  }

  return { factIds, consumedEvidence };
}

export function recordStructuredObservationsFromEvidence(input: {
  evidence: ReadonlyArray<string>;
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  sourceRunId?: string;
  sourceTurnId?: string;
  now?: number;
}): StructuredObservationResult {
  ensureFactSchema();
  const factIds: string[] = [];
  const consumedEvidence: string[] = [];

  for (const evidence of input.evidence) {
    const parsed = parseEvidencePayload(evidence);
    if (!parsed) continue;
    const recorded = recordObservationPayload(parsed.payload, {
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      sourceTurnId: input.sourceTurnId,
      sourceMessageId: parsed.sourceLabel,
      now: input.now,
    });
    if (recorded.length > 0) {
      factIds.push(...recorded);
      consumedEvidence.push(evidence);
    }
  }

  return { factIds, consumedEvidence };
}

function payloadsFromMessage(message: Message): ParsedPayload[] {
  const out: ParsedPayload[] = [];
  const contentPayload = parseJsonPayload(message.content);
  if (contentPayload) out.push({ payload: contentPayload, sourceLabel: message.id });
  for (const toolCall of message.toolCalls ?? []) {
    const argumentPayload = parseJsonPayload(toolCall.arguments);
    if (argumentPayload) {
      out.push({ payload: argumentPayload, sourceLabel: `${message.id}:${toolCall.id}:args` });
    }
    const resultPayload = toolCall.result ? parseJsonPayload(toolCall.result) : null;
    if (resultPayload) {
      out.push({ payload: resultPayload, sourceLabel: `${message.id}:${toolCall.id}:result` });
    }
  }
  return out;
}

function parseEvidencePayload(evidence: string): ParsedPayload | null {
  const trimmed = evidence.trim();
  if (!trimmed) return null;
  const direct = parseJsonPayload(trimmed);
  if (direct) return { payload: direct, sourceLabel: 'evidence' };
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex <= 0) return null;
  const payload = parseJsonPayload(trimmed.slice(colonIndex + 1));
  return payload ? { payload, sourceLabel: trimmed.slice(0, colonIndex) } : null;
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

function recordObservationPayload(payload: JsonRecord, context: ObservationContext): string[] {
  if (!hasObservationFields(payload)) return [];
  const surfaceId = resolveSurfaceId(payload, context);
  const url = stringField(payload, 'url');
  const sourceRunId = stringField(payload, 'trajectory_id') ?? context.sourceRunId;
  const stateIndex = scalarField(payload, 'state_index') ?? scalarField(payload, 'step');
  const action = stringField(payload, 'action');
  const thought = stringField(payload, 'thought');
  const goal = stringField(payload, 'goal');
  const trajectoryOutcome = stringField(payload, 'trajectory_outcome');
  const status = stringField(payload, 'status') ?? context.toolStatus ?? null;
  const explicitOutcome = stringField(payload, 'outcome');
  const outcome = explicitOutcome ?? status;
  const accessibilityTree = stringField(payload, 'accessibility_tree');
  const factIds: string[] = [];

  if (surfaceId && accessibilityTree) {
    const nodes = parseAccessibilityTree(accessibilityTree);
    factIds.push(
      ...recordUiMemories({
        payload,
        context,
        surfaceId,
        url,
        sourceRunId,
        stateIndex,
        action,
        thought,
        goal,
        trajectoryOutcome,
        outcome,
        nodes,
      }),
    );
  }

  const statusIsInformative = Boolean(status && status !== 'completed');
  if (surfaceId && (explicitOutcome || statusIsInformative)) {
    const recorded = recordTypedFact({
      kind: 'outcome',
      subjectName: surfaceId,
      predicate: 'tool_outcome',
      objectText: compactJson({
        outcome,
        status,
        action,
        thought,
        goal,
        url,
        sourceRunId,
        stateIndex,
      }),
      attributes: {
        surfaceId,
        url,
        outcome,
        status,
        action,
        thought,
        goal,
        sourceRunId,
        stateIndex,
      },
      context,
      retrievability: 0.82,
      stability: outcome ? 0.8 : 0.55,
    });
    if (recorded) factIds.push(recorded);
  }

  return factIds;
}

function hasObservationFields(payload: JsonRecord): boolean {
  return Boolean(
    stringField(payload, 'accessibility_tree') ||
    stringField(payload, 'url') ||
    stringField(payload, 'start_url') ||
    stringField(payload, 'surface_id') ||
    stringField(payload, 'surfaceId') ||
    stringField(payload, 'app_id') ||
    stringField(payload, 'appId') ||
    stringField(payload, 'package') ||
    stringField(payload, 'bundle_id') ||
    stringField(payload, 'action') ||
    stringField(payload, 'thought') ||
    stringField(payload, 'status') ||
    stringField(payload, 'outcome'),
  );
}

function recordUiMemories(input: {
  payload: JsonRecord;
  context: ObservationContext;
  surfaceId: string;
  url: string | null;
  sourceRunId?: string;
  stateIndex?: string;
  action: string | null;
  thought: string | null;
  goal: string | null;
  trajectoryOutcome: string | null;
  outcome: string | null;
  nodes: AccessibilityNode[];
}): string[] {
  const factIds: string[] = [];
  const summary = extractUiStateSummary(input.nodes);
  if (summary.nodeCount > 0) {
    const inventoryPayload = compactUiInventoryPayload(summary, input);
    const inventoryFactId = recordTypedFact({
      kind: 'ui_inventory',
      subjectName: input.surfaceId,
      predicate: 'ui_inventory',
      objectText: compactJsonForStorage(inventoryPayload, MAX_TEXT_CHARS),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        nodeCount: summary.nodeCount,
        controlCount: summary.controlCount,
        textEntryCount: summary.textEntryCount,
        searchControlCount: summary.searchControlCount,
      },
      context: input.context,
      retrievability: 0.96,
      stability: 0.75,
    });
    if (inventoryFactId) factIds.push(inventoryFactId);
  }

  for (const control of summary.controls.slice(0, MAX_AFFORDANCE_FACTS_PER_PAYLOAD)) {
    const affordanceId = recordTypedFact({
      kind: 'ui_affordance',
      subjectName: input.surfaceId,
      predicate: 'ui_affordance',
      objectText: compactJson({
        ...compactFieldLikeControl(control),
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        index: control.index,
        nodeId: control.nodeId,
        role: control.role,
        name: control.name,
        label: control.label,
        value: control.value,
        options: control.options,
        checked: control.checked,
        selected: control.selected,
        disabled: control.disabled,
        expanded: control.expanded,
        contextLabels: control.contextLabels,
      },
      context: input.context,
      retrievability: 0.94,
      stability: 0.72,
    });
    if (affordanceId) factIds.push(affordanceId);
  }

  for (const field of summary.fields.slice(0, MAX_FIELD_FACTS_PER_PAYLOAD)) {
    const fieldId = recordTypedFact({
      kind: 'ui_field',
      subjectName: input.surfaceId,
      predicate: 'ui_field',
      objectText: compactJson({
        ...compactField(field),
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        label: field.label,
        role: field.role,
        name: field.controlName,
        value: field.value,
        options: field.options,
        controlIndex: field.controlIndex,
        nodeId: field.nodeId,
        required: field.required,
      },
      context: input.context,
      retrievability: 0.9,
      stability: 0.72,
    });
    if (fieldId) factIds.push(fieldId);
  }

  for (const labelValue of summary.labelValues.slice(0, MAX_FILTER_STATE_FACTS_PER_PAYLOAD)) {
    const filterId = recordTypedFact({
      kind: 'ui_filter_state',
      subjectName: input.surfaceId,
      predicate: 'ui_label_value',
      objectText: compactJson({
        label: labelValue.label,
        value: labelValue.value,
        sourceIndex: labelValue.sourceIndex,
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        label: labelValue.label,
        value: labelValue.value,
        sourceIndex: labelValue.sourceIndex,
      },
      context: input.context,
      retrievability: 0.88,
      stability: 0.7,
    });
    if (filterId) factIds.push(filterId);
  }

  return factIds;
}

function compactFieldLikeControl(control: ReturnType<typeof extractUiStateSummary>['controls'][number]): JsonRecord {
  return dropEmpty({
    index: control.index,
    nodeId: control.nodeId,
    role: control.role,
    name: control.name,
    label: control.label,
    value: control.value,
    options: control.options.length > 0 ? control.options : undefined,
    checked: control.checked,
    selected: control.selected,
    disabled: control.disabled || undefined,
    expanded: control.expanded,
    contextLabels: control.contextLabels.length > 0 ? control.contextLabels : undefined,
  });
}

function compactUiInventoryPayload(
  summary: ReturnType<typeof extractUiStateSummary>,
  input: Parameters<typeof recordUiMemories>[0],
): JsonRecord {
  const inventory = compactUiInventory(summary);
  return dropEmpty({
    fieldLabels: inventory.fieldLabels,
    fields: inventory.fields,
    textEntryControls: inventory.textEntryControls,
    searchControls: inventory.searchControls,
    labelValues: inventory.labelValues,
    tables: inventory.tables,
    controlNames: inventory.controlNames,
    roleCounts: inventory.roleCounts,
    controls: inventory.controls,
    nodeCount: inventory.nodeCount,
    controlCount: inventory.controlCount,
    textEntryCount: inventory.textEntryCount,
    searchControlCount: inventory.searchControlCount,
    ...baseUiPayload(input),
  });
}

function baseUiPayload(input: Parameters<typeof recordUiMemories>[0]): JsonRecord {
  return {
    url: input.url,
    sourceRunId: input.sourceRunId,
    stateIndex: input.stateIndex,
  };
}

function recordTypedFact(input: {
  kind: MemoryFactKind;
  subjectName: string;
  predicate: string;
  objectText: string;
  attributes: Record<string, unknown>;
  context: ObservationContext;
  retrievability: number;
  stability: number;
}): string | null {
  const objectText = fitObjectTextForStorage(input.objectText, MAX_TEXT_CHARS);
  if (!objectText) return null;
  const subject = upsertEntity({
    name: input.subjectName,
    type: 'project',
    attributes: {
      surfaceId: input.subjectName,
      kind: 'memory_surface',
    },
    now: input.context.now,
  });
  const factInput: RecordFactInput = {
    subjectId: subject.id,
    predicate: input.predicate,
    objectText,
    attributes: input.attributes,
    confidence: 0.92,
    scope: input.context.taskId ? 'session' : 'conversation',
    originConversationId: input.context.conversationId ?? null,
    originThreadId: input.context.threadId ?? input.context.conversationId ?? null,
    originTaskId: input.context.taskId ?? null,
    taskId: input.context.taskId ?? null,
    sourceRunId: input.context.sourceRunId ?? null,
    sourceMessageId: input.context.sourceMessageId ?? null,
    sourceTurnId: input.context.sourceTurnId ?? null,
    sourceActorId: input.context.toolName ?? 'tool',
    sourceSummary: input.context.toolName ?? null,
    importance: input.kind === 'outcome' ? 0.78 : 0.72,
    memoryKind: input.kind,
    retrievability: input.retrievability,
    stability: input.stability,
    decayRate: 0.01,
    reviewState: 'auto',
    now: input.context.now,
  };
  const recorded = recordFact(factInput);
  return recorded.fact.id;
}

function resolveSurfaceId(payload: JsonRecord, context: ObservationContext): string | null {
  const explicit =
    stringField(payload, 'surface_id') ??
    stringField(payload, 'surfaceId') ??
    stringField(payload, 'app_id') ??
    stringField(payload, 'appId') ??
    stringField(payload, 'package') ??
    stringField(payload, 'bundle_id');
  if (explicit) return `surface:${explicit}`;
  const url = stringField(payload, 'url') ?? stringField(payload, 'start_url');
  const urlSurface = url ? surfaceFromUrl(url) : null;
  if (urlSurface) return `surface:${urlSurface}`;
  return context.toolName ? `tool:${context.toolName}` : null;
}

function surfaceFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return null;
  }
}

function stringField(payload: JsonRecord, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function scalarField(payload: JsonRecord, key: string): string | undefined {
  const value = payload[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function fitObjectTextForStorage(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const parsed = parseJsonPayload(trimmed);
  if (parsed) return compactJsonForStorage(parsed, maxChars);
  return fitText(trimmed, maxChars);
}

function compactJsonForStorage(value: JsonRecord, maxChars: number): string {
  const compact = compactJson(value);
  if (compact.length <= maxChars) return compact;

  if (isUiInventoryPayload(value)) {
    return compactUiInventoryForStorage(value, maxChars);
  }

  return compactGenericJsonForStorage(value, maxChars);
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
    omitKeys(value, ['controls', 'controlNames']),
    omitKeys(value, ['controls', 'controlNames', 'roleCounts']),
    limitInventoryArrays(value, {
      fieldLabels: 48,
      fields: 24,
      textEntryControls: 24,
      searchControls: 12,
      labelValues: 24,
      tables: 4,
      controlNames: 24,
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
      controlNames: 0,
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
      controlNames: 0,
      controls: 0,
      roleCounts: 0,
    }),
  ];

  for (const stage of stages) {
    const compact = compactJson(stage);
    if (compact.length <= maxChars) return compact;
  }

  const minimal = dropEmpty({
    fieldLabels: limitStringArray(value.fieldLabels, 16, 96),
    fields: limitArray(value.fields, 4),
    textEntryControls: limitArray(value.textEntryControls, 4),
    searchControls: limitArray(value.searchControls, 2),
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
    controlNames: limitArray(value.controlNames, limits.controlNames),
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
  return dropEmpty(
    Object.fromEntries(Object.entries(value).filter(([key]) => !omit.has(key))),
  );
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
