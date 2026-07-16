import { sha256HexUtf8 } from '../../utils/sha256';
import { fitAgentRunText } from './agentRunEvidenceCompaction';
import { compactRecord } from './agentRunEvidenceRecordCompaction';
import { upsertEntity } from './entities';
import { RestrictedMemoryFactPersistenceError } from './facts/errors';
import { recordFactWithContribution } from './facts/mutations';
import { getFactById, listFacts } from './facts/queries';
import {
  codeOwnedMemorySensitivityDeclaration,
  classifyMemoryFactSensitivity,
} from './memorySensitivityPolicy';
import {
  buildReceiptBackedProcedureLearningArtifact,
  digestReceiptBackedToolContractIdentity,
  projectReceiptBackedProcedureObservation,
  type LearnedReceiptBackedProcedure,
} from './receiptBackedProcedureLearning';

export const RECEIPT_BACKED_PROCEDURE_PREDICATE = 'receipt_backed_procedure' as const;
export const RECEIPT_BACKED_PROCEDURE_FACT_PRODUCER_ID =
  'receipt_backed_procedure_learning_v1' as const;

const MAX_SOURCE_FACTS = 2_000;
const MAX_RENDERED_TASK_EXAMPLES = 3;
const MAX_RENDERED_TASK_EXAMPLE_CHARS = 420;

export interface ReceiptBackedProcedurePromotionInput {
  sourceFactIds: ReadonlyArray<string>;
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  sourceTurnId: string;
  now: number;
}

function learnedFactRecord(record: LearnedReceiptBackedProcedure, sourceRunId: string): string {
  return compactRecord({
    sourceRunId,
    goal: record.taskExamples
      .slice(0, MAX_RENDERED_TASK_EXAMPLES)
      .map((example) => fitAgentRunText(example, MAX_RENDERED_TASK_EXAMPLE_CHARS))
      .join(' | '),
    status: 'verified',
    outcome: 'receipt-backed reusable procedure',
    domain: record.domainId,
    environment: record.environmentId,
    tools: record.contract.orderedSteps.map((step) => step.toolName),
    procedureId: record.contract.procedureId,
    taskExamples: record.taskExamples
      .slice(0, MAX_RENDERED_TASK_EXAMPLES)
      .map((example) => fitAgentRunText(example, MAX_RENDERED_TASK_EXAMPLE_CHARS)),
    evidenceSlices: record.contract.orderedSteps.map((step) => ({
      sequence: step.sequence,
      toolName: step.toolName,
      status: step.settlement,
      effectKind: step.effectKind,
    })),
    supportRunCount: record.evidence.runIds.length,
  });
}

function producerEventId(record: LearnedReceiptBackedProcedure, sourceRunId: string): string {
  const digest = sha256HexUtf8(
    JSON.stringify([
      sourceRunId,
      record.id,
      record.evidence.runIds,
      record.evidence.factIds,
      record.evidence.receiptIds,
    ]),
  );
  return `receipt_backed_procedure_fact_event_v1_${digest}`;
}

function recordLearnedProcedure(params: {
  record: LearnedReceiptBackedProcedure;
  sourceRunId: string;
  input: ReceiptBackedProcedurePromotionInput;
}): string | null {
  const { record, sourceRunId, input } = params;
  const objectText = learnedFactRecord(record, sourceRunId);
  const persistedContract = {
    version: record.contract.version,
    procedureId: record.contract.procedureId,
    platform: record.contract.platform,
    orderedSteps: record.contract.orderedSteps.map((step) => ({
      sequence: step.sequence,
      toolName: step.toolName,
      contractIdentityDigest: digestReceiptBackedToolContractIdentity(step.contractIdentity),
      effectKind: step.effectKind,
      settlement: step.settlement,
    })),
    replayPolicy: record.contract.replayPolicy,
    invalidationPolicy: record.contract.invalidationPolicy,
  };
  const attributes = {
    experienceLearningVersion: 1,
    procedureId: record.contract.procedureId,
    domain: record.domainId,
    environment: record.environmentId,
    preconditionIds: record.preconditionIds,
    taskExamples: record.taskExamples,
    commonQueryTerms: record.commonQueryTerms,
    supportRunIds: record.evidence.runIds,
    supportFactIds: record.evidence.factIds,
    supportRunCount: record.evidence.runIds.length,
    contract: persistedContract,
  };
  const sensitivityDeclaration = codeOwnedMemorySensitivityDeclaration();
  if (
    classifyMemoryFactSensitivity({
      declaredSensitivity: sensitivityDeclaration.sensitivity,
      predicate: RECEIPT_BACKED_PROCEDURE_PREDICATE,
      objectText,
      attributes,
    }) === 'restricted'
  ) {
    return null;
  }
  const subject = upsertEntity({
    name: record.contract.procedureId,
    type: 'project',
    now: input.now,
  });
  try {
    const result = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: RECEIPT_BACKED_PROCEDURE_PREDICATE,
        objectText,
        attributes,
        sourceRunId,
        sourceTurnId: input.sourceTurnId,
        scope: 'global',
        confidence: record.confidence,
        importance: 0.88,
        retrievability: 0.94,
        stability: 0.9,
        decayPolicy: 'slow',
        reviewState: 'verified',
        memoryKind: 'agent_run',
        supersedePrior: true,
        now: input.now,
      },
      {
        factClass: 'workflow',
        sourceAuthority: 'tool_observed',
      },
      {
        memoryConversationId: input.memoryConversationId,
        sourceThreadId: input.sourceThreadId,
        taskId: input.taskId,
        producer: {
          producerId: RECEIPT_BACKED_PROCEDURE_FACT_PRODUCER_ID,
          producerEventId: producerEventId(record, sourceRunId),
        },
        sourceAliases: [
          { sourceKind: 'turn', sourceId: input.sourceTurnId },
          { sourceKind: 'run', sourceId: sourceRunId },
        ],
      },
      sensitivityDeclaration,
    );
    return result.fact.id;
  } catch (error) {
    if (error instanceof RestrictedMemoryFactPersistenceError) return null;
    throw error;
  }
}

/**
 * Rebuilds only the procedure groups touched by this turn. Raw run facts stay
 * authoritative; the promoted global fact is a rebuildable semantic index.
 */
export function promoteReceiptBackedProcedures(
  input: ReceiptBackedProcedurePromotionInput,
): string[] {
  const currentObservations = input.sourceFactIds.flatMap((factId) => {
    const fact = getFactById(factId);
    const observation = fact ? projectReceiptBackedProcedureObservation(fact) : null;
    return observation && fact?.memoryOwnerId ? [{ fact, observation }] : [];
  });
  if (currentObservations.length === 0) return [];

  const promoted: string[] = [];
  for (const current of currentObservations) {
    const ownerFacts = listFacts({
      memoryKind: 'agent_run',
      limit: MAX_SOURCE_FACTS,
      asOf: input.now,
    }).filter((fact) => fact.memoryOwnerId === current.fact.memoryOwnerId);
    const artifact = buildReceiptBackedProcedureLearningArtifact(ownerFacts).artifact;
    const learned = artifact.records.find(
      (record) => record.contract.procedureId === current.observation.contract.procedureId,
    );
    if (!learned || !learned.evidence.runIds.includes(current.observation.runId)) continue;
    const factId = recordLearnedProcedure({
      record: learned,
      sourceRunId: current.observation.runId,
      input,
    });
    if (factId) promoted.push(factId);
  }
  return Array.from(new Set(promoted));
}
