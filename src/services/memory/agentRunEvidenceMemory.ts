import type { Message } from '../../types/message';
import { boundedSteps, type AgentRunStep } from './agentRunEvidenceCompaction';
import {
  compactAgentRunRecord,
  compactRecord,
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
import { promoteReceiptBackedProcedures } from './receiptBackedProcedurePromotion';
import {
  agentRunAuthorityMultiplier,
  bundleHasObservedSourceEvidence,
  ingestEvidence,
  ingestMessages,
  type AgentRunBundle,
} from './agentRunEvidenceCapture';

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

const MAX_EVIDENCE_SLICES_PER_RUN = 12;
const MAX_EVIDENCE_SPAN_FACTS_PER_RUN = 8;

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
