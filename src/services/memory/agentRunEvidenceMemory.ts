import type { Message } from '../../types/message';
import {
  STEP_TEXT_LIMITS,
  boundedSteps,
  fitAgentRunText,
  observedAgentRunAffordances,
  observedAgentRunControlSequence,
  observedInputControlsPresent,
  observedAgentRunOutput,
  observedAgentRunText,
  type AgentRunStep,
} from './agentRunEvidenceCompaction';
import {
  compactAgentRunRecord,
  compactRecord,
  scalarField,
  stringField,
  type JsonRecord,
} from './agentRunEvidenceRecordCompaction';
import { upsertEntity } from './entities';
import { recordFactWithApplicability } from './facts/mutations';
import type { MemoryFactKind } from './facts/types';
import { ensureFactSchema } from './schema';

export interface AgentRunEvidenceMemoryInput {
  messages?: ReadonlyArray<Message>;
  evidence?: ReadonlyArray<string>;
  conversationId: string;
  threadId: string;
  taskId?: string;
  sourceRunId?: string;
  sourceActorId?: string;
  parentRunId?: string;
  sourceTurnId?: string;
  now?: number;
}

export interface AgentRunEvidenceMemoryResult {
  factIds: string[];
  consumedEvidence: string[];
}

interface AgentRunBundle {
  sourceRunId: string;
  goal?: string;
  outcome?: string;
  status?: string;
  domain?: string;
  environment?: string;
  tools: Set<string>;
  sources: Set<string>;
  artifacts: Set<string>;
  decisions: Set<string>;
  risks: Set<string>;
  summaries: Set<string>;
  steps: AgentRunStep[];
}

const MAX_RUNS_PER_TURN = 16;
const MAX_EVIDENCE_SLICES_PER_RUN = 12;
const MAX_EVIDENCE_SPAN_FACTS_PER_RUN = 8;
const SUCCESSFUL_RUN_SIGNALS = new Set(['complete', 'completed', 'success', 'succeeded']);
const UNSUCCESSFUL_RUN_SIGNALS = new Set([
  'cancelled',
  'canceled',
  'error',
  'failed',
  'failure',
  'incomplete',
]);
const UNSUCCESSFUL_RUN_AUTHORITY_MULTIPLIER = 0.72;

function parseJsonPayload(value: string): JsonRecord | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const jsonStart = trimmed.search(/[{\[]/);
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function evidenceSliceForRecord(step: AgentRunStep): JsonRecord {
  return Object.fromEntries(
    Object.entries({
      stateIndex: step.stateIndex,
      action: step.action,
      thought: step.thought,
      url: step.url,
      navigationAnchor: step.navigationAnchor,
      observedControlSequence: step.observedControlSequence,
      observedAffordances: step.observedAffordances,
      inputControlsPresent: step.inputControlsPresent,
      observation: step.observation,
      toolResult: step.toolResult,
      outcome: step.outcome,
      status: step.status,
      toolName: step.toolName,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function directlyObservedEvidenceSlice(step: AgentRunStep): JsonRecord {
  return Object.fromEntries(
    Object.entries({
      stateIndex: step.stateIndex,
      url: step.url,
      navigationAnchor: step.navigationAnchor,
      observedControlSequence: step.observedControlSequence,
      observedAffordances: step.observedAffordances,
      inputControlsPresent: step.inputControlsPresent,
      observation: step.observation,
      toolResult: step.toolResult,
      status: step.status,
      toolName: step.toolName,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function stepHasStructurallyDirectEvidence(step: AgentRunStep): boolean {
  if (step.observation || step.toolResult) return true;
  if ((step.observedControlSequence?.length ?? 0) > 0) return true;
  if ((step.observedAffordances?.length ?? 0) > 0) return true;
  return false;
}

function evidenceSpanRecordForStep(
  bundle: AgentRunBundle,
  step: AgentRunStep,
  sequence: number,
): string {
  return compactRecord({
    sourceRunId: bundle.sourceRunId,
    sequence,
    ...directlyObservedEvidenceSlice(step),
  });
}

function appendText(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) target.add(fitAgentRunText(trimmed));
}

function normalizedRunSignal(value: string | undefined): string | null {
  const signal = value?.trim().toLocaleLowerCase();
  return signal ? signal : null;
}

function agentRunAuthorityMultiplier(bundle: AgentRunBundle): number {
  const signals = [normalizedRunSignal(bundle.status), normalizedRunSignal(bundle.outcome)].filter(
    (signal): signal is string => Boolean(signal),
  );
  if (signals.some((signal) => UNSUCCESSFUL_RUN_SIGNALS.has(signal))) {
    return UNSUCCESSFUL_RUN_AUTHORITY_MULTIPLIER;
  }
  return signals.some((signal) => SUCCESSFUL_RUN_SIGNALS.has(signal)) ? 1 : 0.9;
}

function bundleHasObservedSourceEvidence(bundle: AgentRunBundle): boolean {
  return bundle.steps.some((step) => {
    if (step.observedControlSequence && step.observedControlSequence.length > 0) return true;
    if (step.observedAffordances && step.observedAffordances.length > 0) return true;
    return Boolean(step.observation || step.toolResult);
  });
}

function getBundle(
  bundles: Map<string, AgentRunBundle>,
  sourceRunId: string,
): AgentRunBundle | null {
  const trimmed = sourceRunId.trim();
  if (!trimmed) return null;
  const existing = bundles.get(trimmed);
  if (existing) return existing;
  if (bundles.size >= MAX_RUNS_PER_TURN) return null;
  const created: AgentRunBundle = {
    sourceRunId: trimmed,
    tools: new Set(),
    sources: new Set(),
    artifacts: new Set(),
    decisions: new Set(),
    risks: new Set(),
    summaries: new Set(),
    steps: [],
  };
  bundles.set(trimmed, created);
  return created;
}

function resolveSourceRunId(record: JsonRecord, fallback?: string): string | undefined {
  return (
    stringField(record, 'sourceRunId') ??
    stringField(record, 'source_run_id') ??
    stringField(record, 'trajectory_id') ??
    stringField(record, 'run_id') ??
    stringField(record, 'runId') ??
    fallback
  );
}

function mergeBundleMetadata(bundle: AgentRunBundle, record: JsonRecord): void {
  bundle.goal ??=
    stringField(record, 'goal') ??
    stringField(record, 'task') ??
    stringField(record, 'instruction');
  bundle.outcome ??=
    stringField(record, 'outcome') ??
    stringField(record, 'trajectoryOutcome') ??
    stringField(record, 'trajectory_outcome') ??
    stringField(record, 'result');
  bundle.status ??= stringField(record, 'status') ?? stringField(record, 'state');
  bundle.domain ??= stringField(record, 'domain');
  bundle.environment ??= stringField(record, 'environment');
  appendText(bundle.sources, record.source);
  appendText(bundle.sources, record.url);
  appendText(bundle.artifacts, record.artifact);
  appendText(bundle.decisions, record.decision);
  appendText(bundle.risks, record.risk);
  appendText(bundle.summaries, record.summary);
}

function hasAgentRunEvidence(record: JsonRecord): boolean {
  const evidenceFields = [
    'goal',
    'task',
    'instruction',
    'outcome',
    'trajectoryOutcome',
    'trajectory_outcome',
    'result',
    'status',
    'state',
    'domain',
    'environment',
    'source',
    'artifact',
    'decision',
    'risk',
    'summary',
    'action',
    'thought',
    'reasoning',
    'toolName',
    'tool_name',
    'toolResult',
    'tool_result',
    'observation',
    'accessibility_tree',
  ];
  return evidenceFields.some((field) => {
    const value = record[field];
    return (
      (typeof value === 'string' && value.trim().length > 0) ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  });
}

function appendStep(bundle: AgentRunBundle, record: JsonRecord): void {
  const toolName = stringField(record, 'toolName') ?? stringField(record, 'tool_name');
  const toolResult = stringField(record, 'toolResult') ?? stringField(record, 'tool_result');
  const outcome = stringField(record, 'outcome') ?? stringField(record, 'result');
  const observed = observedAgentRunText(record);
  const observation = observedAgentRunOutput(observed, [outcome, toolResult]);
  const observedControlSequence = observedAgentRunControlSequence(observed);
  const observedAffordances = observedAgentRunAffordances(observed);
  if (toolName) bundle.tools.add(fitAgentRunText(toolName, 160));
  const step: AgentRunStep = {
    stateIndex: scalarField(record, 'stateIndex') ?? scalarField(record, 'state_index'),
    action: stringField(record, 'action'),
    thought: stringField(record, 'thought') ?? stringField(record, 'reasoning'),
    url: stringField(record, 'url') ?? stringField(record, 'start_url'),
    observation,
    observedControlSequence,
    observedAffordances,
    inputControlsPresent: observedInputControlsPresent(observedAffordances),
    outcome,
    status: stringField(record, 'status'),
    toolName,
    toolResult,
  };
  const hasContent = Object.values(step).some(
    (value) => value !== undefined && value !== null && value !== '',
  );
  if (hasContent) {
    const normalized = Object.fromEntries(
      Object.entries(step)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [
          key,
          typeof value === 'string'
            ? fitAgentRunText(value, STEP_TEXT_LIMITS[key as keyof AgentRunStep])
            : value,
        ]),
    );
    const stateIndex = normalized.stateIndex;
    const existingIndex =
      stateIndex === undefined
        ? -1
        : bundle.steps.findIndex((existing) => existing.stateIndex === stateIndex);
    if (existingIndex >= 0) {
      bundle.steps[existingIndex] = { ...bundle.steps[existingIndex], ...normalized };
      return;
    }
    bundle.steps.push(normalized as AgentRunStep);
  }
}

function ingestRecord(
  bundles: Map<string, AgentRunBundle>,
  record: JsonRecord,
  fallbackSourceRunId?: string,
): boolean {
  if (!hasAgentRunEvidence(record)) return false;
  const sourceRunId = resolveSourceRunId(record, fallbackSourceRunId);
  if (!sourceRunId) return false;
  const bundle = getBundle(bundles, sourceRunId);
  if (!bundle) return false;
  mergeBundleMetadata(bundle, record);
  appendStep(bundle, record);
  return true;
}

function ingestMessages(
  bundles: Map<string, AgentRunBundle>,
  messages: ReadonlyArray<Message>,
  fallbackSourceRunId?: string,
): void {
  for (const message of messages) {
    const contentRecord = parseJsonPayload(message.content);
    if (contentRecord) ingestRecord(bundles, contentRecord, fallbackSourceRunId);
    for (const toolCall of message.toolCalls ?? []) {
      const argsRecord = parseJsonPayload(toolCall.arguments);
      const resultRecord = toolCall.result ? parseJsonPayload(toolCall.result) : null;
      const toolRecord: JsonRecord = {
        ...(argsRecord ?? {}),
        ...(resultRecord ?? {}),
        toolName: toolCall.name,
        toolResult: toolCall.result ?? toolCall.error,
        status: toolCall.status,
      };
      ingestRecord(bundles, toolRecord, fallbackSourceRunId);
    }
  }
}

function ingestEvidence(
  bundles: Map<string, AgentRunBundle>,
  evidence: ReadonlyArray<string>,
  fallbackSourceRunId?: string,
): string[] {
  const consumed: string[] = [];
  for (const entry of evidence) {
    const record = parseJsonPayload(entry);
    if (!record) continue;
    if (ingestRecord(bundles, record, fallbackSourceRunId)) {
      consumed.push(entry);
    }
  }
  return consumed;
}

function recordBundleFact(
  bundle: AgentRunBundle,
  input: AgentRunEvidenceMemoryInput,
  subjectId: string,
  kind: MemoryFactKind,
  predicate: string,
  objectText: string,
  attributes: JsonRecord,
  importance: number,
  retrievability: number,
): string | null {
  const trimmed = objectText.trim();
  if (!trimmed) return null;
  const authorityMultiplier = bundleHasObservedSourceEvidence(bundle)
    ? 1
    : agentRunAuthorityMultiplier(bundle);
  const recorded = recordFactWithApplicability(
    {
      subjectId,
      predicate,
      objectText: trimmed,
      memoryKind: kind,
      sourceRunId: bundle.sourceRunId,
      sourceActorId: input.sourceActorId,
      sourceTurnId: input.sourceTurnId,
      originConversationId: input.conversationId,
      originThreadId: input.threadId,
      originTaskId: input.taskId,
      scope: input.taskId ? 'session' : 'conversation',
      confidence: 0.82 * authorityMultiplier,
      importance,
      retrievability: retrievability * authorityMultiplier,
      stability: 0.72,
      attributes,
      now: input.now,
    },
    {
      factClass: 'workflow',
      sourceAuthority: 'assistant_inferred',
    },
  );
  return recorded.fact.id;
}

function persistBundle(bundle: AgentRunBundle, input: AgentRunEvidenceMemoryInput): string[] {
  const subject = upsertEntity({
    name: input.taskId ?? input.conversationId,
    type: 'project',
    now: input.now,
  });
  const factIds: string[] = [];
  const boundedEvidenceSteps = boundedSteps(bundle.steps, MAX_EVIDENCE_SLICES_PER_RUN);
  const evidenceSlices = boundedEvidenceSteps.map(evidenceSliceForRecord);
  const tools = Array.from(bundle.tools).slice(0, 16);
  const sources = Array.from(bundle.sources).slice(0, 12);
  const artifacts = Array.from(bundle.artifacts).slice(0, 12);
  const decisions = Array.from(bundle.decisions).slice(0, 12);
  const risks = Array.from(bundle.risks).slice(0, 12);
  const summaries = Array.from(bundle.summaries).slice(0, 12);
  const baseAttributes: JsonRecord = {
    sourceRunId: bundle.sourceRunId,
    sourceActorId: input.sourceActorId,
    parentRunId: input.parentRunId,
    goal: bundle.goal,
    status: bundle.status,
    outcome: bundle.outcome,
    stepCount: bundle.steps.length,
    tools,
  };

  const agentRunRecord = compactAgentRunRecord({
    base: {
      sourceRunId: bundle.sourceRunId,
      sourceActorId: input.sourceActorId,
      parentRunId: input.parentRunId,
      goal: bundle.goal,
      status: bundle.status,
      outcome: bundle.outcome,
      domain: bundle.domain,
      environment: bundle.environment,
      tools,
    },
    evidenceSlices,
    sources,
    artifacts,
    decisions,
    risks,
    summaries,
  });
  const agentRunId = recordBundleFact(
    bundle,
    input,
    subject.id,
    'agent_run',
    'agent_run',
    agentRunRecord,
    {
      ...baseAttributes,
      evidenceType: 'agent_run',
      artifacts,
      decisions,
      risks,
      summaries,
      sources,
    },
    0.8,
    0.88,
  );
  if (agentRunId) factIds.push(agentRunId);

  const evidenceSpanSteps = boundedEvidenceSteps
    .filter(stepHasStructurallyDirectEvidence)
    .slice(0, MAX_EVIDENCE_SPAN_FACTS_PER_RUN);

  evidenceSpanSteps.forEach((step, index) => {
    const recorded = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'evidence_span',
        objectText: evidenceSpanRecordForStep(bundle, step, index),
        memoryKind: 'evidence_span',
        sourceRunId: bundle.sourceRunId,
        sourceActorId: input.sourceActorId,
        sourceTurnId: input.sourceTurnId,
        originConversationId: input.conversationId,
        originThreadId: input.threadId,
        originTaskId: input.taskId,
        scope: input.taskId ? 'session' : 'conversation',
        confidence: 0.9,
        importance: 0.86,
        retrievability: 0.94,
        stability: 0.66,
        attributes: {
          ...baseAttributes,
          evidenceType: 'evidence_span',
          sequence: index,
          stateIndex: step.stateIndex,
          status: step.status,
          toolName: step.toolName,
          url: step.url,
        },
        now: input.now,
      },
      {
        factClass: 'workflow',
        sourceAuthority: 'tool_observed',
      },
    );
    factIds.push(recorded.fact.id);
  });

  return factIds;
}

export function recordAgentRunEvidenceMemory(
  input: AgentRunEvidenceMemoryInput,
): AgentRunEvidenceMemoryResult {
  ensureFactSchema();
  const bundles = new Map<string, AgentRunBundle>();
  const consumedEvidence = ingestEvidence(bundles, input.evidence ?? [], input.sourceRunId);
  // Code-routed run evidence owns run-level metadata. Transcript tool records
  // still contribute observed steps, but a step status must not replace the
  // terminal status supplied by the execution boundary.
  ingestMessages(bundles, input.messages ?? [], input.sourceRunId);
  const factIds = Array.from(bundles.values()).flatMap((bundle) => persistBundle(bundle, input));
  return { factIds, consumedEvidence };
}
