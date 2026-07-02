import type { Message } from '../../types/message';
import { upsertEntity } from './entities';
import { recordFact } from './facts/mutations';
import type { MemoryFactKind } from './facts/types';
import { ensureFactSchema } from './schema';

type JsonRecord = Record<string, unknown>;

export interface AgentRunEvidenceMemoryInput {
  messages?: ReadonlyArray<Message>;
  evidence?: ReadonlyArray<string>;
  conversationId: string;
  threadId?: string;
  taskId?: string;
  sourceRunId?: string;
  sourceTurnId?: string;
  now?: number;
}

export interface AgentRunEvidenceMemoryResult {
  factIds: string[];
  consumedEvidence: string[];
}

interface AgentRunStep {
  stateIndex?: string | number;
  action?: string;
  thought?: string;
  url?: string;
  outcome?: string;
  status?: string;
  toolName?: string;
  toolResult?: string;
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

const MAX_TEXT_CHARS = 900;
const MAX_RECORD_CHARS = 6_000;
const MAX_STEPS_PER_RUN = 24;
const MAX_RUNS_PER_TURN = 16;

function fitText(value: string, maxChars = MAX_TEXT_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scalarField(record: JsonRecord, field: string): string | number | undefined {
  const value = record[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined;
}

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

function compactRecord(value: JsonRecord): string {
  const json = JSON.stringify(value);
  return json.length <= MAX_RECORD_CHARS
    ? json
    : `${json.slice(0, MAX_RECORD_CHARS - 1).trimEnd()}\u2026`;
}

function appendText(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) target.add(fitText(trimmed));
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
    stringField(record, 'goal') ?? stringField(record, 'task') ?? stringField(record, 'instruction');
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
  if (bundle.steps.length >= MAX_STEPS_PER_RUN) return;
  const toolName = stringField(record, 'toolName') ?? stringField(record, 'tool_name');
  const toolResult = stringField(record, 'toolResult') ?? stringField(record, 'tool_result');
  if (toolName) bundle.tools.add(fitText(toolName, 160));
  const step: AgentRunStep = {
    stateIndex: scalarField(record, 'stateIndex') ?? scalarField(record, 'state_index'),
    action: stringField(record, 'action'),
    thought: stringField(record, 'thought') ?? stringField(record, 'reasoning'),
    url: stringField(record, 'url') ?? stringField(record, 'start_url'),
    outcome:
      stringField(record, 'outcome') ??
      stringField(record, 'result') ??
      stringField(record, 'observation'),
    status: stringField(record, 'status'),
    toolName,
    toolResult,
  };
  const hasContent = Object.values(step).some(
    (value) => value !== undefined && value !== null && value !== '',
  );
  if (hasContent) {
    bundle.steps.push(
      Object.fromEntries(
        Object.entries(step)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => [
            key,
            typeof value === 'string' ? fitText(value) : value,
          ]),
      ) as AgentRunStep,
    );
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

function boundedSteps(steps: ReadonlyArray<AgentRunStep>): AgentRunStep[] {
  if (steps.length <= 14) return [...steps];
  return [...steps.slice(0, 4), ...steps.slice(-10)];
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
  const recorded = recordFact({
    subjectId,
    predicate,
    objectText: trimmed,
    memoryKind: kind,
    sourceRunId: bundle.sourceRunId,
    sourceTurnId: input.sourceTurnId,
    originConversationId: input.conversationId,
    originThreadId: input.threadId ?? input.conversationId,
    originTaskId: input.taskId,
    taskId: input.taskId,
    scope: input.taskId ? 'session' : 'conversation',
    confidence: 0.82,
    importance,
    retrievability,
    stability: 0.72,
    attributes,
    now: input.now,
  });
  return recorded.fact.id;
}

function persistBundle(bundle: AgentRunBundle, input: AgentRunEvidenceMemoryInput): string[] {
  const subject = upsertEntity({
    name: input.taskId ?? input.conversationId,
    type: 'project',
    now: input.now,
  });
  const factIds: string[] = [];
  const steps = boundedSteps(bundle.steps);
  const tools = Array.from(bundle.tools).slice(0, 16);
  const sources = Array.from(bundle.sources).slice(0, 12);
  const artifacts = Array.from(bundle.artifacts).slice(0, 12);
  const decisions = Array.from(bundle.decisions).slice(0, 12);
  const risks = Array.from(bundle.risks).slice(0, 12);
  const summaries = Array.from(bundle.summaries).slice(0, 12);
  const baseAttributes: JsonRecord = {
    sourceRunId: bundle.sourceRunId,
    goal: bundle.goal,
    status: bundle.status,
    outcome: bundle.outcome,
    stepCount: bundle.steps.length,
    tools,
  };

  const procedureRecord = compactRecord({
    sourceRunId: bundle.sourceRunId,
    goal: bundle.goal,
    status: bundle.status,
    outcome: bundle.outcome,
    domain: bundle.domain,
    environment: bundle.environment,
    tools,
    sources,
    steps,
  });
  const procedureId = recordBundleFact(
    bundle,
    input,
    subject.id,
    'procedure',
    'agent_run_trace',
    procedureRecord,
    { ...baseAttributes, evidenceType: 'agent_run_trace' },
    0.74,
    0.82,
  );
  if (procedureId) factIds.push(procedureId);

  const evidenceRecord = compactRecord({
    sourceRunId: bundle.sourceRunId,
    goal: bundle.goal,
    status: bundle.status,
    outcome: bundle.outcome,
    tools,
    sources,
    artifacts,
    decisions,
    risks,
    summaries,
    lastSteps: steps.slice(-6),
  });
  const evidenceId = recordBundleFact(
    bundle,
    input,
    subject.id,
    'outcome',
    'agent_run_result',
    evidenceRecord,
    {
      ...baseAttributes,
      evidenceType: 'agent_run_result',
      artifacts,
      decisions,
      risks,
      summaries,
      sources,
    },
    0.8,
    0.88,
  );
  if (evidenceId) factIds.push(evidenceId);

  return factIds;
}

export function recordAgentRunEvidenceMemory(
  input: AgentRunEvidenceMemoryInput,
): AgentRunEvidenceMemoryResult {
  ensureFactSchema();
  const bundles = new Map<string, AgentRunBundle>();
  ingestMessages(bundles, input.messages ?? [], input.sourceRunId);
  const consumedEvidence = ingestEvidence(bundles, input.evidence ?? [], input.sourceRunId);
  const factIds = Array.from(bundles.values()).flatMap((bundle) => persistBundle(bundle, input));
  return { factIds, consumedEvidence };
}
