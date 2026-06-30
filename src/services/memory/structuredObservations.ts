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
import { buildUiActionResultMemory } from './uiActionResultMemory';
import { compactUiInventoryPayload } from './uiInventoryMemory';
import {
  collectProcedureTrace,
  recordProcedureTraces,
  type ProcedureTrace,
  type ProcedurePreviousObservation,
} from './structuredProcedureTrace';
import type { UiActionTrailEntry } from './uiActionResultMemory';

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

interface PreviousObservationContext extends ProcedurePreviousObservation {
  action: string | null;
  thought: string | null;
  stateIndex?: string;
  recentActionTrail?: UiActionTrailEntry[];
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
    const previousObservations = new Map<string, PreviousObservationContext>();

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
        const previousObservation = previousObservationForPayload(
          parsed.payload,
          context,
          previousObservations,
        );
        factIds.push(...recordObservationPayload(parsed.payload, context, previousObservation));
        rememberObservation(parsed.payload, context, previousObservations);
        collectProcedureTrace(procedureTraces, parsed.payload, context, previousObservation);
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
    const previousObservations = new Map<string, PreviousObservationContext>();

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
      const previousObservation = previousObservationForPayload(
        parsed.payload,
        baseContext,
        previousObservations,
      );
      const recorded = recordObservationPayload(parsed.payload, baseContext, previousObservation);
      rememberObservation(parsed.payload, baseContext, previousObservations);
      collectProcedureTrace(procedureTraces, parsed.payload, baseContext, previousObservation);
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

function observationTemporalKey(payload: JsonRecord, context: ObservationContext): string | null {
  const sourceRunId = stringField(payload, 'trajectory_id') ?? context.sourceRunId;
  if (sourceRunId) return `run:${sourceRunId}`;
  const surfaceId = resolveSurfaceId(payload, context);
  return surfaceId ? `surface:${surfaceId}` : null;
}

function previousObservationForPayload(
  payload: JsonRecord,
  context: ObservationContext,
  previousObservations: ReadonlyMap<string, PreviousObservationContext>,
): PreviousObservationContext | null {
  if (!hasObservationFields(payload)) return null;
  const key = observationTemporalKey(payload, context);
  return key ? (previousObservations.get(key) ?? null) : null;
}

function rememberObservation(
  payload: JsonRecord,
  context: ObservationContext,
  previousObservations: Map<string, PreviousObservationContext>,
): void {
  if (!hasObservationFields(payload)) return;
  const key = observationTemporalKey(payload, context);
  if (!key) return;
  const stateIndex = scalarField(payload, 'state_index') ?? scalarField(payload, 'step');
  const accessibilityTree = stringField(payload, 'accessibility_tree');
  const current: UiActionTrailEntry = {
    action: stringField(payload, 'action'),
    thought: stringField(payload, 'thought'),
    ...(stateIndex ? { stateIndex } : {}),
  };
  const previous: PreviousObservationContext = {
    action: current.action,
    thought: current.thought,
    ...(stateIndex ? { stateIndex } : {}),
    accessibilityTree,
    recentActionTrail: [
      ...(previousObservations.get(key)?.recentActionTrail ?? []),
      current,
    ]
      .filter((entry) => entry.action || entry.thought || entry.stateIndex)
      .slice(-8),
  };
  if (!previous.action && !previous.thought && !previous.stateIndex && !previous.accessibilityTree) {
    return;
  }
  previousObservations.set(key, previous);
}

function recordObservationPayload(
  payload: JsonRecord,
  context: ObservationContext,
  previousObservation: PreviousObservationContext | null = null,
): string[] {
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
        previousObservation,
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
  previousObservation: PreviousObservationContext | null;
}): string[] {
  const factIds: string[] = [];
  const summary = extractUiStateSummary(input.nodes);
  let inventoryPayload: JsonRecord | null = null;
  if (summary.nodeCount > 0) {
    inventoryPayload = compactUiInventoryPayload({
      summary,
      goal: input.goal,
      trajectoryOutcome: input.trajectoryOutcome,
      domain: stringField(input.payload, 'domain'),
      environment: stringField(input.payload, 'environment'),
      url: input.url,
      sourceRunId: input.sourceRunId,
      stateIndex: input.stateIndex,
    });
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

    const actionResult = buildUiActionResultMemory({
      action: input.action,
      thought: input.thought,
      goal: input.goal,
      trajectoryOutcome: input.trajectoryOutcome,
      url: input.url,
      sourceRunId: input.sourceRunId,
      stateIndex: input.stateIndex,
      previousAction: input.previousObservation?.action,
      previousThought: input.previousObservation?.thought,
      previousStateIndex: input.previousObservation?.stateIndex,
      recentActionTrail: input.previousObservation?.recentActionTrail,
      inventoryPayload,
      maxTextChars: MAX_TEXT_CHARS,
    });
    if (actionResult) {
      const actionResultFactId = recordTypedFact({
        kind: 'outcome',
        subjectName: input.surfaceId,
        predicate: 'ui_action_result',
        objectText: actionResult.objectText,
        attributes: {
          surfaceId: input.surfaceId,
          ...actionResult.attributes,
        },
        context: input.context,
        retrievability: 0.88,
        stability: 0.68,
      });
      if (actionResultFactId) factIds.push(actionResultFactId);
    }
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
        surfaceLabels: summary.surfaceLabels,
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        surfaceLabels: summary.surfaceLabels,
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
        surfaceLabels: summary.surfaceLabels,
        ...baseUiPayload(input),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        surfaceLabels: summary.surfaceLabels,
        label: field.label,
        role: field.role,
        name: field.controlName,
        value: field.value,
        displayText: field.displayText,
        options: field.options,
        symbolMarkers: field.symbolMarkers,
        controlIndex: field.controlIndex,
        nodeId: field.nodeId,
        required: field.required,
        checked: field.checked,
        selected: field.selected,
        disabled: field.disabled,
        expanded: field.expanded,
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
  maxTextChars?: number;
  supersedePrior?: boolean;
}): string | null {
  const objectText = fitObjectTextForStorage(input.objectText, input.maxTextChars ?? MAX_TEXT_CHARS);
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
    supersedePrior: input.supersedePrior,
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
