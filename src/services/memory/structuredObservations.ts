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
import { runMemoryTransaction } from './access/transaction';
import { recordFact } from './facts/mutations';
import type { MemoryFactKind, RecordFactInput } from './facts/types';
import { ensureFactSchema } from './schema';
import {
  compactField,
  compactControl,
  compactUiInventory,
  extractUiStateSummary,
  parseAccessibilityTree,
  type AccessibilityNode,
} from './uiState';
import { compactLabelValue } from './uiLabelValues';
import {
  compactJson,
  compactJsonForStorage,
  fitObjectTextForStorage,
} from './structuredObservationCompaction';

const MAX_TEXT_CHARS = 4_000;
const MAX_FIELD_FACTS_PER_PAYLOAD = 96;
const MAX_FILTER_STATE_FACTS_PER_PAYLOAD = 96;
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

interface ProcedureTrace {
  context: ObservationContext;
  sourceRunId: string;
  subjectName: string;
  goal: string | null;
  trajectoryOutcome: string | null;
  domain: string | null;
  environment: string | null;
  steps: JsonRecord[];
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
  return runMemoryTransaction(() => {
    const factIds: string[] = [];
    const consumedEvidence: string[] = [];
    const procedureTraces = new Map<string, ProcedureTrace>();

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
        collectProcedureTrace(procedureTraces, parsed.payload, context);
      }
    }
    factIds.push(...recordProcedureTraces(procedureTraces));

    return { factIds, consumedEvidence };
  });
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
  return runMemoryTransaction(() => {
    const factIds: string[] = [];
    const consumedEvidence: string[] = [];
    const procedureTraces = new Map<string, ProcedureTrace>();

    for (const evidence of input.evidence) {
      const parsed = parseEvidencePayload(evidence);
      if (!parsed) continue;
      const baseContext: ObservationContext = {
        conversationId: input.conversationId,
        threadId: input.threadId,
        taskId: input.taskId,
        sourceRunId: input.sourceRunId,
        sourceTurnId: input.sourceTurnId,
        sourceMessageId: parsed.sourceLabel,
        now: input.now,
      };
      const recorded = recordObservationPayload(parsed.payload, baseContext);
      collectProcedureTrace(procedureTraces, parsed.payload, baseContext);
      if (recorded.length > 0) {
        factIds.push(...recorded);
        consumedEvidence.push(evidence);
      }
    }
    factIds.push(...recordProcedureTraces(procedureTraces));

    return { factIds, consumedEvidence };
  });
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

function collectProcedureTrace(
  traces: Map<string, ProcedureTrace>,
  payload: JsonRecord,
  context: ObservationContext,
): void {
  if (!hasObservationFields(payload)) return;
  const sourceRunId = stringField(payload, 'trajectory_id') ?? context.sourceRunId;
  if (!sourceRunId) return;
  const surfaceId = resolveSurfaceId(payload, context) ?? `workflow:${sourceRunId}`;
  const stateIndex = scalarField(payload, 'state_index') ?? scalarField(payload, 'step');
  const step = dropEmpty({
    stateIndex,
    url: stringField(payload, 'url'),
    action: stringField(payload, 'action'),
    thought: stringField(payload, 'thought'),
    outcome: stringField(payload, 'outcome') ?? stringField(payload, 'status') ?? context.toolStatus,
  });
  if (Object.keys(step).length === 0) return;

  const existing =
    traces.get(sourceRunId) ??
    {
      context: {
        ...context,
        sourceRunId,
      },
      sourceRunId,
      subjectName: `workflow:${sourceRunId}`,
      goal: stringField(payload, 'goal'),
      trajectoryOutcome: stringField(payload, 'trajectory_outcome'),
      domain: stringField(payload, 'domain'),
      environment: stringField(payload, 'environment'),
      steps: [],
    };
  if (existing.subjectName.startsWith('workflow:') && surfaceId) {
    existing.subjectName = surfaceId;
  }
  existing.goal ??= stringField(payload, 'goal');
  existing.trajectoryOutcome ??= stringField(payload, 'trajectory_outcome');
  existing.domain ??= stringField(payload, 'domain');
  existing.environment ??= stringField(payload, 'environment');
  existing.steps.push(step);
  traces.set(sourceRunId, existing);
}

function stateIndexNumber(step: JsonRecord): number {
  const value = step.stateIndex;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

function recordProcedureTraces(traces: ReadonlyMap<string, ProcedureTrace>): string[] {
  const factIds: string[] = [];
  for (const trace of traces.values()) {
    const orderedSteps = [...trace.steps].sort((left, right) => {
      const leftIndex = stateIndexNumber(left);
      const rightIndex = stateIndexNumber(right);
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return 0;
    });
    if (orderedSteps.length === 0) continue;
    const recorded = recordTypedFact({
      kind: 'procedure',
      subjectName: trace.subjectName,
      predicate: 'procedure_trace',
      objectText: compactJsonForStorage(
        dropEmpty({
          sourceRunId: trace.sourceRunId,
          goal: trace.goal,
          trajectoryOutcome: trace.trajectoryOutcome,
          domain: trace.domain,
          environment: trace.environment,
          stepCount: orderedSteps.length,
          steps: orderedSteps,
        }),
        MAX_TEXT_CHARS,
      ),
      attributes: dropEmpty({
        sourceRunId: trace.sourceRunId,
        goal: trace.goal,
        trajectoryOutcome: trace.trajectoryOutcome,
        domain: trace.domain,
        environment: trace.environment,
        stepCount: orderedSteps.length,
        startUrl: orderedSteps[0]?.url,
        finalUrl: orderedSteps[orderedSteps.length - 1]?.url,
      }),
      context: trace.context,
      retrievability: 0.9,
      stability: 0.7,
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
      retrievability: 0.86,
      stability: 0.75,
    });
    if (inventoryFactId) factIds.push(inventoryFactId);
  }

  const fieldControlIndexes = new Set(summary.fields.map((field) => field.controlIndex));
  for (const control of summary.popupControls.slice(0, MAX_FIELD_FACTS_PER_PAYLOAD)) {
    if (control.options.length === 0 || fieldControlIndexes.has(control.index)) continue;
    const popupId = recordTypedFact({
      kind: 'ui_field',
      subjectName: input.surfaceId,
      predicate: 'ui_popup_options',
      objectText: compactJson({
        ...compactControl(control),
        controlName: control.name,
        controlIndex: control.index,
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        label: control.label,
        role: control.role,
        name: control.name,
        value: control.value,
        options: control.options,
        controlIndex: control.index,
        nodeId: control.nodeId,
        expanded: control.expanded,
        contextLabels: control.contextLabels,
      },
      context: input.context,
      retrievability: 0.94,
      stability: 0.72,
    });
    if (popupId) factIds.push(popupId);
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
      retrievability: 0.93,
      stability: 0.72,
    });
    if (fieldId) factIds.push(fieldId);
  }

  for (const labelValue of summary.labelValues.slice(0, MAX_FILTER_STATE_FACTS_PER_PAYLOAD)) {
    const compactedLabelValue = compactLabelValue(labelValue);
    const filterId = recordTypedFact({
      kind: 'ui_filter_state',
      subjectName: input.surfaceId,
      predicate: 'ui_label_value',
      objectText: compactJson({
        ...compactedLabelValue,
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
        contextLabels: labelValue.contextLabels,
        nearbyTextBefore: labelValue.nearbyTextBefore,
      },
      context: input.context,
      retrievability: 0.9,
      stability: 0.7,
    });
    if (filterId) factIds.push(filterId);
  }

  return factIds;
}

function compactUiInventoryPayload(
  summary: ReturnType<typeof extractUiStateSummary>,
  input: Parameters<typeof recordUiMemories>[0],
): JsonRecord {
  const inventory = compactUiInventory(summary);
  return dropEmpty({
    fieldLabels: inventory.fieldLabels,
    fields: inventory.fields,
    sections: inventory.sections,
    textEntryControls: inventory.textEntryControls,
    searchControls: inventory.searchControls,
    popupControls: inventory.popupControls,
    labelValues: inventory.labelValues,
    tables: inventory.tables,
    controlNames: inventory.controlNames,
    roleCounts: inventory.roleCounts,
    controls: inventory.controls,
    nodeCount: inventory.nodeCount,
    controlCount: inventory.controlCount,
    textEntryCount: inventory.textEntryCount,
    searchControlCount: inventory.searchControlCount,
    url: input.url,
    sourceRunId: input.sourceRunId,
    stateIndex: input.stateIndex,
    ...sourceContextPayload(input),
  });
}

function baseUiPayload(input: Parameters<typeof recordUiMemories>[0]): JsonRecord {
  return {
    url: input.url,
    sourceRunId: input.sourceRunId,
    stateIndex: input.stateIndex,
  };
}

function sourceContextPayload(input: Parameters<typeof recordUiMemories>[0]): JsonRecord {
  const domain = stringField(input.payload, 'domain');
  const environment = stringField(input.payload, 'environment');
  return {
    goal: input.goal,
    trajectoryOutcome: input.trajectoryOutcome,
    ...(domain ? { domain } : {}),
    ...(environment ? { environment } : {}),
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

function dropEmpty(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}
