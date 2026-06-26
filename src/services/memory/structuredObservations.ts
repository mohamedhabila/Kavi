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

const MAX_ACCESSIBILITY_NODES_PER_PAYLOAD = 48;
const MAX_AFFORDANCE_FACTS_PER_PAYLOAD = 4;
const MAX_SCHEMA_NODES_PER_PAYLOAD = 48;
const MAX_TEXT_CHARS = 1400;

const ACTIONABLE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

const ACTIONABLE_ATTRIBUTES = new Set([
  'checked',
  'clickable',
  'disabled',
  'editable',
  'expanded',
  'pressed',
  'selected',
]);

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

interface AccessibilityNode {
  index: number;
  nodeId: string | null;
  role: string;
  name: string | null;
  attributes: string[];
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
  const inventoryNodes = input.nodes.slice(0, MAX_SCHEMA_NODES_PER_PAYLOAD);
  if (inventoryNodes.length > 0) {
    const schemaFactId = recordTypedFact({
      kind: 'surface_schema',
      subjectName: input.surfaceId,
      predicate: 'surface_inventory',
      objectText: compactJson({
        url: input.url,
        goal: input.goal,
        action: input.action,
        thought: input.thought,
        trajectoryOutcome: input.trajectoryOutcome,
        outcome: input.outcome,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        nodes: inventoryNodes.map((node) => ({
          role: node.role,
          name: node.name,
          attributes: node.attributes,
        })),
      }),
      attributes: {
        surfaceId: input.surfaceId,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        nodeCount: input.nodes.length,
        action: input.action,
        thought: input.thought,
        goal: input.goal,
        trajectoryOutcome: input.trajectoryOutcome,
        outcome: input.outcome,
      },
      context: input.context,
      retrievability: 0.94,
      stability: 0.7,
    });
    if (schemaFactId) factIds.push(schemaFactId);
  }

  const actionableNodes = input.nodes
    .filter(isActionableAccessibilityNode)
    .slice(0, MAX_AFFORDANCE_FACTS_PER_PAYLOAD);
  for (const node of actionableNodes) {
    const affordanceId = recordTypedFact({
      kind: 'ui_affordance',
      subjectName: input.surfaceId,
      predicate: 'ui_affordance',
      objectText: compactJson({
        role: node.role,
        name: node.name,
        attributes: node.attributes,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
      }),
      attributes: {
        surfaceId: input.surfaceId,
        role: node.role,
        name: node.name,
        attributes: node.attributes,
        url: input.url,
        sourceRunId: input.sourceRunId,
        stateIndex: input.stateIndex,
        nodeId: node.nodeId,
        action: input.action,
        outcome: input.outcome,
      },
      context: input.context,
      retrievability: 0.78,
      stability: 0.6,
    });
    if (affordanceId) factIds.push(affordanceId);
  }

  return factIds;
}

function isActionableAccessibilityNode(node: AccessibilityNode): boolean {
  const role = node.role.toLocaleLowerCase();
  if (ACTIONABLE_ROLES.has(role)) return true;
  return node.attributes.some((attribute) =>
    ACTIONABLE_ATTRIBUTES.has(attribute.split('=')[0]?.trim().toLocaleLowerCase() ?? ''),
  );
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
  const objectText = fitText(input.objectText, MAX_TEXT_CHARS);
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

function parseAccessibilityTree(tree: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  const lines = tree.split(/\r?\n/);
  for (const rawLine of lines) {
    if (nodes.length >= MAX_ACCESSIBILITY_NODES_PER_PAYLOAD) break;
    const parsed = parseAccessibilityLine(rawLine, nodes.length);
    if (parsed) nodes.push(parsed);
  }
  return nodes;
}

function parseAccessibilityLine(rawLine: string, index: number): AccessibilityNode | null {
  const line = rawLine.trim();
  if (!line) return null;
  const withoutId = line.replace(/^\[(\d+)\]\s*/, '');
  const idMatch = line.match(/^\[(\d+)\]/);
  const firstQuote = firstQuoteIndex(withoutId);
  const roleRaw =
    firstQuote >= 0 ? withoutId.slice(0, firstQuote).trim() : withoutId.split(',')[0]?.trim();
  const roleHead = roleRaw ?? '';
  const role = roleHead.replace(/\s+/g, '_');
  if (!role) return null;
  const name = firstQuote >= 0 ? readQuotedValue(withoutId, firstQuote) : null;
  const afterName =
    firstQuote >= 0 && name
      ? withoutId.slice(firstQuote + name.length + 2)
      : withoutId.slice(roleHead.length);
  const attributes = afterName
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 12);
  return {
    index,
    nodeId: idMatch?.[1] ?? null,
    role: fitText(role, 80),
    name: name ? fitText(name, 240) : null,
    attributes,
  };
}

function firstQuoteIndex(value: string): number {
  const single = value.indexOf("'");
  const double = value.indexOf('"');
  if (single < 0) return double;
  if (double < 0) return single;
  return Math.min(single, double);
}

function readQuotedValue(value: string, quoteIndex: number): string | null {
  const quote = value[quoteIndex];
  const end = value.indexOf(quote, quoteIndex + 1);
  if (end <= quoteIndex) return null;
  return value.slice(quoteIndex + 1, end);
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

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
