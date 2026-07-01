import { upsertEntity } from './entities';
import { recordFact } from './facts/mutations';
import type { RecordFactInput } from './facts/types';
import { compactJson } from './structuredObservationCompaction';
import { parseAccessibilityTree, type AccessibilityNode } from './accessibilityTree';
import { isInteractiveUiNode } from './uiInteractivity';

const MAX_PROCEDURE_TEXT_CHARS = 7_500;
const MAX_PROCEDURE_GOAL_CHARS = 600;
const MAX_PROCEDURE_URL_CHARS = 260;
const MAX_PROCEDURE_ACTION_CHARS = 220;
const MAX_PROCEDURE_THOUGHT_CHARS = 320;
const MAX_PROCEDURE_TARGET_CHARS = 160;
const MAX_PROCEDURE_TARGET_PEER_NAMES = 8;
const MAX_PROCEDURE_STEPS_FOR_STORAGE = 36;
const NON_ENVIRONMENT_PROCEDURE_ACTIONS = new Set(['send_msg_to_user']);
const TARGET_PEER_CONTEXT_ROLES = new Set(['listitem', 'menuitem', 'option']);

type JsonRecord = Record<string, unknown>;

export interface ProcedureObservationContext {
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

export interface ProcedurePreviousObservation {
  accessibilityTree?: string | null;
}

export interface ProcedureTrace {
  context: ProcedureObservationContext;
  sourceRunId: string;
  subjectName: string;
  goal: string | null;
  trajectoryOutcome: string | null;
  domain: string | null;
  environment: string | null;
  steps: JsonRecord[];
}

interface ProcedureStoragePlan {
  maxSteps: number;
  urlChars: number;
  actionChars: number;
  thoughtChars: number;
  goalChars: number;
}

interface ProcedureStoragePayload {
  objectText: string;
  storedStepCount: number;
}

const PROCEDURE_STORAGE_PLANS: readonly ProcedureStoragePlan[] = [
  { maxSteps: 36, urlChars: 260, actionChars: 220, thoughtChars: 320, goalChars: 600 },
  { maxSteps: 28, urlChars: 220, actionChars: 180, thoughtChars: 240, goalChars: 480 },
  { maxSteps: 20, urlChars: 180, actionChars: 160, thoughtChars: 180, goalChars: 360 },
  { maxSteps: 14, urlChars: 160, actionChars: 140, thoughtChars: 140, goalChars: 260 },
  { maxSteps: 10, urlChars: 140, actionChars: 120, thoughtChars: 110, goalChars: 200 },
  { maxSteps: 8, urlChars: 120, actionChars: 110, thoughtChars: 90, goalChars: 160 },
  { maxSteps: 6, urlChars: 100, actionChars: 90, thoughtChars: 70, goalChars: 120 },
];

export function collectProcedureTrace(
  traces: Map<string, ProcedureTrace>,
  payload: JsonRecord,
  context: ProcedureObservationContext,
  previousObservation?: ProcedurePreviousObservation | null,
): void {
  if (!hasObservationFields(payload)) return;
  const sourceRunId = stringField(payload, 'trajectory_id') ?? context.sourceRunId;
  if (!sourceRunId) return;
  const stateIndex = scalarField(payload, 'state_index') ?? scalarField(payload, 'step');
  const action = stringField(payload, 'action');
  if (action && isNonEnvironmentProcedureAction(action)) return;
  const step = dropEmpty({
    stateIndex,
    url: stringField(payload, 'url'),
    action,
    targetControl: action ? targetControlForAction(payload, action, previousObservation) : null,
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
  existing.goal ??= stringField(payload, 'goal');
  existing.trajectoryOutcome ??= stringField(payload, 'trajectory_outcome');
  existing.domain ??= stringField(payload, 'domain');
  existing.environment ??= stringField(payload, 'environment');
  existing.steps.push(step);
  traces.set(sourceRunId, existing);
}

export function recordProcedureTraces(traces: ReadonlyMap<string, ProcedureTrace>): string[] {
  const factIds: string[] = [];
  for (const trace of traces.values()) {
    const orderedSteps = [...trace.steps].sort((left, right) => {
      const leftIndex = stateIndexNumber(left);
      const rightIndex = stateIndexNumber(right);
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return 0;
    });
    const compactSteps = orderedSteps
      .map((step) => compactProcedureStep(step, PROCEDURE_STORAGE_PLANS[0]))
      .filter((step) => Object.keys(step).length > 0);
    if (compactSteps.length === 0) continue;
    const payload = compactProcedurePayloadForStorage(trace, orderedSteps, compactSteps.length);
    const recorded = recordProcedureFact({
      subjectName: trace.subjectName,
      objectText: payload.objectText,
      attributes: dropEmpty({
        sourceRunId: trace.sourceRunId,
        goal: trace.goal,
        trajectoryOutcome: trace.trajectoryOutcome,
        domain: trace.domain,
        environment: trace.environment,
        stepCount: compactSteps.length,
        storedStepCount: payload.storedStepCount,
        startUrl: compactSteps[0]?.url,
        finalUrl: compactSteps[compactSteps.length - 1]?.url,
      }),
      context: trace.context,
    });
    if (recorded) factIds.push(recorded);
  }
  return factIds;
}

function compactProcedurePayloadForStorage(
  trace: ProcedureTrace,
  orderedSteps: JsonRecord[],
  stepCount: number,
): ProcedureStoragePayload {
  for (const plan of PROCEDURE_STORAGE_PLANS) {
    const compactSteps = orderedSteps
      .map((step) => compactProcedureStep(step, plan))
      .filter((step) => Object.keys(step).length > 0);
    const storedSteps = capProcedureStepsForStorage(compactSteps, plan.maxSteps);
    const objectText = compactJson(procedurePayload(trace, stepCount, storedSteps, plan.goalChars));
    if (objectText.length <= MAX_PROCEDURE_TEXT_CHARS) {
      return { objectText, storedStepCount: storedSteps.length };
    }
  }

  const fallbackPlan = PROCEDURE_STORAGE_PLANS[PROCEDURE_STORAGE_PLANS.length - 1];
  const fallbackSteps = orderedSteps
    .map((step) => compactMinimalProcedureStep(step, fallbackPlan))
    .filter((step) => Object.keys(step).length > 0);
  const storedSteps = capProcedureStepsForStorage(fallbackSteps, 4);
  const objectText = compactJson(procedurePayload(trace, stepCount, storedSteps, 80));
  return { objectText, storedStepCount: storedSteps.length };
}

function procedurePayload(
  trace: ProcedureTrace,
  stepCount: number,
  storedSteps: JsonRecord[],
  goalChars: number,
): JsonRecord {
  return dropEmpty({
    sourceRunId: trace.sourceRunId,
    goal: fitProcedureText(trace.goal, Math.min(goalChars, MAX_PROCEDURE_GOAL_CHARS)),
    trajectoryOutcome: trace.trajectoryOutcome,
    domain: trace.domain,
    environment: trace.environment,
    stepCount,
    storedStepCount: storedSteps.length,
    steps: storedSteps,
  });
}

function recordProcedureFact(input: {
  subjectName: string;
  objectText: string;
  attributes: Record<string, unknown>;
  context: ProcedureObservationContext;
}): string | null {
  const objectText = input.objectText.trim();
  if (!objectText) return null;
  if (objectText.length > MAX_PROCEDURE_TEXT_CHARS) return null;
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
    predicate: 'procedure_trace',
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
    importance: 0.72,
    memoryKind: 'procedure',
    retrievability: 0.9,
    stability: 0.7,
    decayRate: 0.01,
    reviewState: 'auto',
    supersedePrior: true,
    now: input.context.now,
  };
  const recorded = recordFact(factInput);
  return recorded.fact.id;
}

function compactProcedureStep(step: JsonRecord, plan: ProcedureStoragePlan): JsonRecord {
  return dropEmpty({
    stateIndex: scalarField(step, 'stateIndex'),
    url: fitProcedureText(stringField(step, 'url'), Math.min(plan.urlChars, MAX_PROCEDURE_URL_CHARS)),
    action: fitProcedureText(
      stringField(step, 'action'),
      Math.min(plan.actionChars, MAX_PROCEDURE_ACTION_CHARS),
    ),
    targetControl: compactProcedureTargetControl(step.targetControl),
    thought: fitProcedureText(
      stringField(step, 'thought'),
      Math.min(plan.thoughtChars, MAX_PROCEDURE_THOUGHT_CHARS),
    ),
    outcome: stringField(step, 'outcome'),
  });
}

function compactMinimalProcedureStep(step: JsonRecord, plan: ProcedureStoragePlan): JsonRecord {
  return dropEmpty({
    stateIndex: scalarField(step, 'stateIndex'),
    url: fitProcedureText(stringField(step, 'url'), plan.urlChars),
    action: fitProcedureText(stringField(step, 'action'), plan.actionChars),
    targetControl: compactProcedureTargetControl(step.targetControl),
  });
}

function targetControlForAction(
  payload: JsonRecord,
  action: string,
  previousObservation?: ProcedurePreviousObservation | null,
): JsonRecord | null {
  const targetRef = firstActionTargetRef(action);
  if (!targetRef) return null;
  const previousAccessibilityTree = previousObservation?.accessibilityTree?.trim() || null;
  const currentAccessibilityTree = stringField(payload, 'accessibility_tree');
  const previousTarget = previousAccessibilityTree
    ? targetControlFromTree(previousAccessibilityTree, targetRef)
    : null;
  return previousTarget ?? (currentAccessibilityTree ? targetControlFromTree(currentAccessibilityTree, targetRef) : null);
}

function targetControlFromTree(accessibilityTree: string, targetRef: string): JsonRecord | null {
  const nodes = parseAccessibilityTree(accessibilityTree);
  const byNodeId = nodes.find((node) => node.nodeId === targetRef);
  if (byNodeId) return compactTargetNode(nodes, byNodeId);
  const byName = nodes.find(
    (node) => node.name?.trim() === targetRef && isInteractiveUiNode(node),
  );
  return byName ? compactTargetNode(nodes, byName) : null;
}

function firstActionTargetRef(action: string): string | null {
  const callArgs = action.match(/^[A-Za-z_][A-Za-z0-9_]*\s*\((.*)\)\s*$/s)?.[1];
  if (!callArgs) return null;
  const quoted = callArgs.match(/^\s*(['"])(.*?)\1/s);
  if (quoted?.[2]?.trim()) return quoted[2].trim();
  const firstArg = callArgs.split(',')[0]?.trim();
  return firstArg && /^[A-Za-z0-9_.:-]+$/.test(firstArg) ? firstArg : null;
}

function compactTargetNode(nodes: AccessibilityNode[], node: AccessibilityNode): JsonRecord {
  return dropEmpty({
    nodeId: node.nodeId,
    role: fitProcedureText(node.role, 80),
    name: fitProcedureText(accessibleNodeName(nodes, node), MAX_PROCEDURE_TARGET_CHARS),
    peerNames: TARGET_PEER_CONTEXT_ROLES.has(node.role.toLocaleLowerCase())
      ? peerControlNames(nodes, node)
      : undefined,
  });
}

function compactProcedureTargetControl(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = value as JsonRecord;
  const peerNames = Array.isArray(target.peerNames)
    ? target.peerNames
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => fitProcedureText(entry, MAX_PROCEDURE_TARGET_CHARS))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, MAX_PROCEDURE_TARGET_PEER_NAMES)
    : undefined;
  return dropEmpty({
    nodeId: fitProcedureText(stringField(target, 'nodeId'), 80),
    role: fitProcedureText(stringField(target, 'role'), 80),
    name: fitProcedureText(stringField(target, 'name'), MAX_PROCEDURE_TARGET_CHARS),
    peerNames,
  });
}

function accessibleNodeName(nodes: AccessibilityNode[], node: AccessibilityNode): string | null {
  const ownName = node.name?.trim();
  if (ownName) return ownName;
  return descendantText(nodes, node);
}

function peerControlNames(nodes: AccessibilityNode[], node: AccessibilityNode): string[] {
  const parent = parentNode(nodes, node);
  if (!parent) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const end = subtreeEndIndex(nodes, parent.index);
  for (let index = parent.index + 1; index < end; index += 1) {
    const sibling = nodes[index];
    if (sibling.indent !== node.indent || !isPeerTargetNode(node, sibling)) continue;
    const name = accessibleNodeName(nodes, sibling);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_PROCEDURE_TARGET_PEER_NAMES) break;
  }
  return out.length > 1 ? out : [];
}

function isPeerTargetNode(target: AccessibilityNode, candidate: AccessibilityNode): boolean {
  return candidate.role === target.role || isInteractiveUiNode(candidate);
}

function descendantText(nodes: AccessibilityNode[], node: AccessibilityNode): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  const end = subtreeEndIndex(nodes, node.index);
  for (let index = node.index + 1; index < end; index += 1) {
    const child = nodes[index];
    if (isInteractiveUiNode(child)) continue;
    const name = child.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    parts.push(name);
    if (parts.length >= 4) break;
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function parentNode(nodes: AccessibilityNode[], node: AccessibilityNode): AccessibilityNode | null {
  for (let index = node.index - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (candidate.indent < node.indent) return candidate;
  }
  return null;
}

function subtreeEndIndex(nodes: AccessibilityNode[], startIndex: number): number {
  const root = nodes[startIndex];
  if (!root) return startIndex;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    if (nodes[index].indent <= root.indent) return index;
  }
  return nodes.length;
}

function capProcedureStepsForStorage(steps: JsonRecord[], maxSteps: number): JsonRecord[] {
  const cappedMax = Math.min(maxSteps, MAX_PROCEDURE_STEPS_FOR_STORAGE);
  if (steps.length <= cappedMax) return steps;
  const headCount = Math.ceil(cappedMax / 2);
  const tailCount = Math.floor(cappedMax / 2);
  const capped: JsonRecord[] = [];
  const seen = new Set<string>();
  const addStep = (step: JsonRecord): void => {
    const stateIndex = scalarField(step, 'stateIndex') ?? '';
    const action = stringField(step, 'action') ?? '';
    const url = stringField(step, 'url') ?? '';
    const key = `${stateIndex}:${action}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    capped.push(step);
  };
  steps.slice(0, headCount).forEach(addStep);
  steps.slice(-tailCount).forEach(addStep);
  return capped;
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

function fitProcedureText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars).trimEnd();
}

function isNonEnvironmentProcedureAction(action: string): boolean {
  const callName = action.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/)?.[1];
  return Boolean(callName && NON_ENVIRONMENT_PROCEDURE_ACTIONS.has(callName));
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
