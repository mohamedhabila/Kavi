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
  fitAgentRunText,
  observedAgentRunAffordances,
  observedAgentRunControlSequence,
  observedInputControlsPresent,
  observedAgentRunOutput,
  observedAgentRunText,
  type AgentRunStep,
} from './agentRunEvidenceCompaction';
import { scalarField, stringField, type JsonRecord } from './agentRunEvidenceRecordCompaction';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isInternalAgentControlToolName } from './agentRunExperienceEvidencePolicy';
import {
  parseAgentRunTerminalEvidence,
  type AgentRunTerminalEvidence,
} from './agentRunTerminalEvidence';

// ---------------------------------------------------------------------------
// Evidence capture
// ---------------------------------------------------------------------------
// Ingests raw transcript messages and code-routed evidence strings (tool
// effect receipts, agent-run terminal evidence, free-form JSON payloads) into
// per-source-run bundles. Projection/persistence of those bundles into memory
// facts lives in `agentRunEvidenceMemory.ts`.
// ---------------------------------------------------------------------------

export interface AgentRunBundle {
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

function appendText(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) target.add(fitAgentRunText(trimmed));
}

function normalizedRunSignal(value: string | undefined): string | null {
  const signal = value?.trim().toLocaleLowerCase();
  return signal ? signal : null;
}

export function agentRunAuthorityMultiplier(bundle: AgentRunBundle): number {
  const signals = [normalizedRunSignal(bundle.status), normalizedRunSignal(bundle.outcome)].filter(
    (signal): signal is string => Boolean(signal),
  );
  if (signals.some((signal) => UNSUCCESSFUL_RUN_SIGNALS.has(signal))) {
    return UNSUCCESSFUL_RUN_AUTHORITY_MULTIPLIER;
  }
  return signals.some((signal) => SUCCESSFUL_RUN_SIGNALS.has(signal)) ? 1 : 0.9;
}

export function bundleHasObservedSourceEvidence(bundle: AgentRunBundle): boolean {
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

export function ingestMessages(
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

export function ingestEvidence(
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
