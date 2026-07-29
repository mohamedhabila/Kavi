import type { Message } from '../../types/message';
import type {
  ToolContractIdentity,
  ToolEffectDigest,
  ToolEffectKind,
  ToolEffectState,
  ToolEffectTransportState,
  ToolEffectVerificationState,
  ToolExecutionState,
} from '../../types/toolEffectReceipt';
import {
  parseToolEffectReceiptEvidence,
  type EffectCompletionResource,
} from '../../engine/goals/effectCompletionEvidence';
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
import { runMemoryTransaction } from './access/transaction';
import {
  AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
  buildAgentRunFactProducerEventId,
} from './agentRunFactContributionIdentity';
import { upsertEntity } from './entities';
import { recordFactWithContribution } from './facts/mutations';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { requireExactMemoryScopeId } from './memoryScopeIdentity';
import { ensureFactSchema } from './schema';
import {
  classifyMemoryFactSensitivity,
  codeOwnedMemorySensitivityDeclaration,
} from './memorySensitivityPolicy';
import { isInternalAgentControlToolName } from './agentRunExperienceEvidencePolicy';
import {
  parseAgentRunTerminalEvidence,
  type AgentRunTerminalEvidence,
} from './agentRunTerminalEvidence';
import { promoteReceiptBackedProcedures } from './receiptBackedProcedurePromotion';

export interface AgentRunEvidenceMemoryInput {
  messages?: ReadonlyArray<Message>;
  evidence?: ReadonlyArray<string>;
  conversationId: string;
  threadId: string;
  taskId: string | null;
  sourceRunId?: string;
  sourceActorId?: string;
  parentRunId?: string;
  sourceTurnId: string;
  now: number;
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
  effectReceipts: AgentRunEffectReceiptEvidence[];
  terminalEvidence?: AgentRunTerminalEvidence;
}

export interface AgentRunEffectReceiptEvidence {
  receiptId: string;
  toolCallId: string;
  toolName: string;
  contractIdentity: ToolContractIdentity;
  executionRunId: string;
  transportState: ToolEffectTransportState;
  executionState?: ToolExecutionState;
  effectKind: ToolEffectKind;
  effectState: ToolEffectState;
  verificationState: ToolEffectVerificationState;
  requestDigest: ToolEffectDigest;
  resultDigest: ToolEffectDigest;
  resource: EffectCompletionResource;
  recordedAt: number;
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

function definedRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
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
    domain: bundle.domain,
    environment: bundle.environment,
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
  const exactSourceRunId = requireExactMemoryProvenanceId(
    sourceRunId,
    'memory_agent_run_source_run_id_invalid',
  );
  const existing = bundles.get(exactSourceRunId);
  if (existing) return existing;
  if (bundles.size >= MAX_RUNS_PER_TURN) return null;
  const created: AgentRunBundle = {
    sourceRunId: exactSourceRunId,
    tools: new Set(),
    sources: new Set(),
    artifacts: new Set(),
    decisions: new Set(),
    risks: new Set(),
    summaries: new Set(),
    steps: [],
    effectReceipts: [],
  };
  bundles.set(exactSourceRunId, created);
  return created;
}

function exactStringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveSourceRunId(record: JsonRecord, fallback?: string): string | undefined {
  return (
    exactStringField(record, 'sourceRunId') ??
    exactStringField(record, 'source_run_id') ??
    exactStringField(record, 'trajectory_id') ??
    exactStringField(record, 'run_id') ??
    exactStringField(record, 'runId') ??
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
  const toolName = stringField(record, 'toolName') ?? stringField(record, 'tool_name');
  if (isInternalAgentControlToolName(toolName)) return false;
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
    const receipt = parseToolEffectReceiptEvidence(entry);
    if (receipt) {
      // Agent-run identity and durable effect-execution identity are separate
      // code-owned namespaces. Foreground publication seals goal evidence to
      // the tracked agent run, while each receipt retains the execution run
      // that owns its journal entry. Key the memory bundle by the sealed agent
      // run when present; never rewrite or discard receipt execution provenance.
      const bundle = getBundle(bundles, fallbackSourceRunId ?? receipt.executionRunId);
      if (!bundle) continue;
      const normalized: AgentRunEffectReceiptEvidence = {
        receiptId: receipt.receiptId,
        toolCallId: receipt.toolCallId,
        toolName: receipt.toolName,
        contractIdentity: receipt.contractIdentity,
        executionRunId: receipt.executionRunId,
        transportState: receipt.transportState,
        ...(receipt.executionState ? { executionState: receipt.executionState } : {}),
        effectKind: receipt.effectKind,
        effectState: receipt.effectState,
        verificationState: receipt.verificationState,
        requestDigest: receipt.requestDigest,
        resultDigest: receipt.resultDigest,
        resource: receipt.resource,
        recordedAt: receipt.recordedAt,
      };
      const prior = bundle.effectReceipts.find(
        (candidate) => candidate.receiptId === normalized.receiptId,
      );
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
        throw new Error('memory_agent_run_receipt_conflict');
      }
      if (!prior) bundle.effectReceipts.push(normalized);
      bundle.tools.add(fitAgentRunText(normalized.toolName, 160));
      consumed.push(entry);
      continue;
    }
    const terminal = parseAgentRunTerminalEvidence(entry);
    if (terminal) {
      if (fallbackSourceRunId && terminal.sourceRunId !== fallbackSourceRunId) {
        throw new Error('memory_agent_run_terminal_run_mismatch');
      }
      const bundle = getBundle(bundles, terminal.sourceRunId);
      if (!bundle) continue;
      if (
        bundle.terminalEvidence &&
        JSON.stringify(bundle.terminalEvidence) !== JSON.stringify(terminal)
      ) {
        throw new Error('memory_agent_run_terminal_conflict');
      }
      bundle.terminalEvidence = terminal;
      bundle.goal = terminal.goal;
      bundle.status = terminal.runStatus;
      bundle.outcome = terminal.graphStatus;
      bundle.domain ??= 'mobile-assistant';
      bundle.environment ??= `kavi-${terminal.platform}`;
      consumed.push(entry);
      continue;
    }
    const record = parseJsonPayload(entry);
    if (!record) continue;
    if (ingestRecord(bundles, record, fallbackSourceRunId)) {
      consumed.push(entry);
    }
  }
  return consumed;
}

function requireExactAgentRunSourceScope(input: AgentRunEvidenceMemoryInput): void {
  requireExactMemoryScopeId(input.conversationId, 'memory_agent_run_conversation_scope_invalid');
  requireExactMemoryScopeId(input.threadId, 'memory_agent_run_thread_scope_invalid');
  if (input.taskId !== null) {
    requireExactMemoryScopeId(input.taskId, 'memory_agent_run_task_scope_invalid');
  }
  if (input.sourceRunId !== undefined) {
    requireExactMemoryProvenanceId(input.sourceRunId, 'memory_agent_run_source_run_id_invalid');
  }
}

function requireAgentRunPersistenceIdentity(input: AgentRunEvidenceMemoryInput): void {
  requireExactMemoryProvenanceId(input.sourceTurnId, 'memory_agent_run_source_turn_id_invalid');
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new Error('memory_agent_run_timestamp_invalid');
  }
}

function recordBundleFact(
  bundle: AgentRunBundle,
  input: AgentRunEvidenceMemoryInput,
  subjectId: string,
  kind: 'agent_run' | 'evidence_span',
  recordIndex: number,
  predicate: string,
  objectText: string,
  attributes: JsonRecord,
  confidence: number,
  importance: number,
  retrievability: number,
  stability: number,
  sourceAuthority: 'assistant_inferred' | 'tool_observed',
): string | null {
  const trimmed = objectText.trim();
  if (!trimmed) return null;
  const sensitivityDeclaration = codeOwnedMemorySensitivityDeclaration();
  if (
    classifyMemoryFactSensitivity({
      declaredSensitivity: sensitivityDeclaration.sensitivity,
      predicate,
      objectText: trimmed,
      attributes,
    }) === 'restricted'
  ) {
    return null;
  }
  const authorityMultiplier =
    kind !== 'agent_run' || bundleHasObservedSourceEvidence(bundle)
      ? 1
      : agentRunAuthorityMultiplier(bundle);
  const recorded = recordFactWithContribution(
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
      confidence: confidence * authorityMultiplier,
      importance,
      retrievability: retrievability * authorityMultiplier,
      stability,
      attributes,
      now: input.now,
    },
    {
      factClass: 'workflow',
      sourceAuthority,
    },
    {
      memoryConversationId: input.conversationId,
      sourceThreadId: input.threadId,
      taskId: input.taskId,
      producer: {
        producerId: AGENT_RUN_FACT_CONTRIBUTION_PRODUCER_ID,
        producerEventId: buildAgentRunFactProducerEventId({
          sourceRunId: bundle.sourceRunId,
          recordKind: kind,
          recordIndex,
        }),
      },
      sourceAliases: [
        { sourceKind: 'turn', sourceId: input.sourceTurnId },
        { sourceKind: 'run', sourceId: bundle.sourceRunId },
      ],
    },
    sensitivityDeclaration,
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
  const effectReceipts = [...bundle.effectReceipts]
    .sort((left, right) => {
      const order = bundle.terminalEvidence?.observedToolCallIds ?? [];
      const leftIndex = order.indexOf(left.toolCallId);
      const rightIndex = order.indexOf(right.toolCallId);
      if (leftIndex >= 0 || rightIndex >= 0) {
        if (leftIndex < 0) return 1;
        if (rightIndex < 0) return -1;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      }
      return left.recordedAt !== right.recordedAt
        ? left.recordedAt - right.recordedAt
        : left.receiptId.localeCompare(right.receiptId);
    })
    .slice(0, 32);
  const baseAttributes: JsonRecord = definedRecord({
    sourceRunId: bundle.sourceRunId,
    sourceActorId: input.sourceActorId,
    parentRunId: input.parentRunId,
    goal: bundle.goal,
    status: bundle.status,
    outcome: bundle.outcome,
    domain: bundle.domain,
    environment: bundle.environment,
    stepCount: bundle.steps.length,
    tools,
    terminalEvidence: bundle.terminalEvidence,
    effectReceipts,
  });

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
      terminalEvidence: bundle.terminalEvidence,
      effectReceipts,
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
    0,
    'agent_run',
    agentRunRecord,
    definedRecord({
      ...baseAttributes,
      evidenceType: 'agent_run',
      artifacts,
      decisions,
      risks,
      summaries,
      sources,
    }),
    0.82,
    0.8,
    0.88,
    0.72,
    'assistant_inferred',
  );
  if (agentRunId) factIds.push(agentRunId);

  const evidenceSpanSteps = boundedEvidenceSteps
    .filter(stepHasStructurallyDirectEvidence)
    .slice(0, MAX_EVIDENCE_SPAN_FACTS_PER_RUN);

  evidenceSpanSteps.forEach((step, index) => {
    const evidenceSpanId = recordBundleFact(
      bundle,
      input,
      subject.id,
      'evidence_span',
      index,
      'evidence_span',
      evidenceSpanRecordForStep(bundle, step, index),
      definedRecord({
        ...baseAttributes,
        evidenceType: 'evidence_span',
        sequence: index,
        stateIndex: step.stateIndex,
        status: step.status,
        toolName: step.toolName,
        url: step.url,
      }),
      0.9,
      0.86,
      0.94,
      0.66,
      'tool_observed',
    );
    if (evidenceSpanId) factIds.push(evidenceSpanId);
  });

  return factIds;
}

export function recordAgentRunEvidenceMemory(
  input: AgentRunEvidenceMemoryInput,
): AgentRunEvidenceMemoryResult {
  ensureFactSchema();
  requireExactAgentRunSourceScope(input);
  const bundles = new Map<string, AgentRunBundle>();
  const consumedEvidence = ingestEvidence(bundles, input.evidence ?? [], input.sourceRunId);
  // Code-routed run evidence owns run-level metadata. Transcript tool records
  // still contribute observed steps, but a step status must not replace the
  // terminal status supplied by the execution boundary.
  ingestMessages(bundles, input.messages ?? [], input.sourceRunId);
  if (bundles.size === 0) return { factIds: [], consumedEvidence };
  requireAgentRunPersistenceIdentity(input);
  const factIds = runMemoryTransaction(() => {
    const sourceFactIds = Array.from(bundles.values()).flatMap((bundle) =>
      persistBundle(bundle, input),
    );
    const learnedFactIds = promoteReceiptBackedProcedures({
      sourceFactIds,
      memoryConversationId: input.conversationId,
      sourceThreadId: input.threadId,
      taskId: input.taskId,
      sourceTurnId: input.sourceTurnId,
      now: input.now,
    });
    return [...sourceFactIds, ...learnedFactIds];
  });
  return { factIds, consumedEvidence };
}
