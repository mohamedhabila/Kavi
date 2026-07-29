import type { EntityType } from './entities';
import { upsertEntity } from './entities';
import { runMemoryTransaction } from './access/transaction';
import type { ConsolidatorFact } from './consolidator';
import { addFactEvidence } from './episodes/mutations';
import { resolveCurrentFactsForReplacement } from './facts/currentReplacementResolution';
import { replaceCurrentFactWithContribution } from './facts/exactReplacement';
import { recordFactWithContribution } from './facts/mutations';
import type {
  MemoryFactScope,
  RecordFactInput,
  RecordFactResult,
  ReplaceCurrentFactConflict,
} from './facts/types';
import { rowToFact } from './facts/types';
import {
  evaluateGroundedReplacement,
  type GroundedReplacementRejection,
} from './groundedFactReplacement';
import { CANONICAL_SELF_MEMORY_SUBJECT } from './memorySubjectIdentity';
import {
  classifyMemoryFactSensitivity,
  providerMemorySensitivityDeclaration,
} from './memorySensitivityPolicy';
import type { AuthorizedToolEffectExecutionClaim } from '../executionJournal/authorizedToolEffectExecutionClaim';
import type { MemoryFactContributionSourceAlias } from './factContributionCodec';
import { loadFactContributionReplayFromAliasCandidates } from './factContributionStore';
import {
  ExactReplacementReplayTargetChanged,
  loadExactReplacementReplayInTransaction,
} from './facts/exactReplacementReplay';
import {
  buildMemoryRememberProducerEventId,
  MEMORY_REMEMBER_FACT_PRODUCER_ID,
} from './memoryRememberContributionIdentity';
import {
  isExactMemoryRememberExecutionClaim,
  isExactMemoryRememberRequestEvidence,
} from './memoryRememberExecutionAuthority';
import {
  resolveBoundMemoryRememberSemanticEvidence,
  type BoundMemoryRememberSemanticEvidence,
  type MemoryRememberSemanticEvidenceBinding,
} from './memoryRememberSemanticEvidence';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { sha256HexUtf8 } from '../../utils/sha256';

export interface MemoryRememberPersistenceInput {
  semanticEvidence: BoundMemoryRememberSemanticEvidence;
  pinned?: boolean;
}

export interface MemoryRememberRequestEvidence {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  userMessageId: string;
  userMessageText: string;
}

export interface MemoryRememberPersistenceContext {
  personaId?: string;
  sourceRunId: string | null;
  requestEvidence: MemoryRememberRequestEvidence;
  executionClaim: AuthorizedToolEffectExecutionClaim;
}

export type MemoryRememberPersistenceResult =
  | { status: 'persisted'; result: RecordFactResult; grounded: boolean }
  | {
      status: 'grounding_required';
      reason: GroundedReplacementRejection | 'operation_mismatch';
    }
  | { status: 'restricted_content' }
  | { status: 'conflict'; conflict: ReplaceCurrentFactConflict };

interface CanonicalMemoryRememberInput {
  subject: string;
  subjectType: EntityType;
  predicate: string;
  value: string;
  confidence: number;
  pinned?: boolean;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceRunId: string | null;
  importance: number;
}

function buildRecordInput(
  input: CanonicalMemoryRememberInput,
  subjectId: string,
  now: number,
): RecordFactInput {
  return {
    subjectId,
    predicate: input.predicate,
    objectText: input.value,
    confidence: input.confidence,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    scope: input.scope,
    originConversationId: input.originConversationId,
    originThreadId: input.originThreadId,
    originTaskId: input.originTaskId,
    sourceRunId: input.sourceRunId,
    importance: input.importance,
    validAt: now,
    now,
  };
}

class MemoryRememberConflict extends Error {
  constructor(readonly conflict: ReplaceCurrentFactConflict) {
    super(`memory_remember_conflict:${conflict}`);
  }
}

function memoryWriteAttributes(
  fact: ConsolidatorFact,
  evidenceSourceSha256: string,
  source: MemoryRememberSemanticEvidenceBinding['source'],
): Record<string, unknown> {
  const admittedWrite = fact.admittedWrite!;
  return {
    memoryWrite: {
      operation: admittedWrite.operation,
      authority: admittedWrite.authority,
      evidenceMessageId: admittedWrite.evidenceMessageId,
      ...(admittedWrite.operation === 'replace_current'
        ? { expectedCurrentFactId: admittedWrite.expectedCurrentFactId }
        : {}),
      assertionClass: fact.assertionClass,
      evidenceQuote: fact.evidenceQuote,
      evidenceSourceSha256,
      evidenceSourceKind: source.kind,
      ...(source.kind === 'tool_observed'
        ? {
            sourceToolCallId: source.sourceToolCallId,
            sourceToolName: source.sourceToolName,
            sourceArgumentsSha256: source.sourceArgumentsSha256,
            sourceContractDigest: source.canonicalStaticContractDigest,
          }
        : {}),
    },
  };
}

function replayStableMemoryWriteAttributes(
  fact: ConsolidatorFact,
  evidenceSourceSha256: string,
  source: MemoryRememberSemanticEvidenceBinding['source'],
  priorAttributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const incoming = memoryWriteAttributes(fact, evidenceSourceSha256, source);
  if (!priorAttributes) return incoming;
  const priorMemoryWrite = priorAttributes.memoryWrite;
  if (
    !priorMemoryWrite ||
    typeof priorMemoryWrite !== 'object' ||
    Array.isArray(priorMemoryWrite)
  ) {
    throw new Error('memory_remember_replay_metadata_invalid');
  }
  const prior = priorMemoryWrite as Record<string, unknown>;
  if (prior.operation !== 'insert' && prior.operation !== 'replace_current') {
    throw new Error('memory_remember_replay_metadata_invalid');
  }
  if (prior.evidenceSourceSha256 !== evidenceSourceSha256) {
    throw new Error('memory_remember_replay_evidence_mismatch');
  }
  const priorDecision: Record<string, unknown> = { operation: prior.operation };
  if (prior.operation === 'replace_current') {
    if (typeof prior.expectedCurrentFactId !== 'string') {
      throw new Error('memory_remember_replay_metadata_invalid');
    }
    priorDecision.expectedCurrentFactId = prior.expectedCurrentFactId;
  }
  const current = incoming.memoryWrite as Record<string, unknown>;
  const stable = { ...current };
  delete stable.operation;
  delete stable.expectedCurrentFactId;
  return {
    memoryWrite: {
      ...stable,
      ...priorDecision,
    },
  };
}

export function persistMemoryRemember(
  input: MemoryRememberPersistenceInput,
  context: MemoryRememberPersistenceContext,
): MemoryRememberPersistenceResult {
  const semantic = resolveBoundMemoryRememberSemanticEvidence(input.semanticEvidence);
  if (
    !context ||
    !semantic ||
    !isExactMemoryRememberExecutionClaim(context.executionClaim) ||
    !isExactMemoryRememberRequestEvidence(context.requestEvidence) ||
    (context.sourceRunId !== null && !isExactMemoryProvenanceId(context.sourceRunId))
  ) {
    throw new Error('memory_remember_execution_authority_invalid');
  }
  const requestEvidence = context.requestEvidence;
  const semanticProposal = semantic.proposal;
  const source = semantic.source;
  const evidenceSourceSha256 = source.sourceContentSha256;
  if (
    semanticProposal.sourceMessageId !== source.sourceMessageId ||
    (source.kind === 'current_user' &&
      (source.sourceMessageId !== requestEvidence.userMessageId ||
        evidenceSourceSha256 !== sha256HexUtf8(requestEvidence.userMessageText)))
  ) {
    throw new Error('memory_remember_bound_evidence_changed');
  }
  const subject =
    semanticProposal.subjectRef.kind === 'self'
      ? CANONICAL_SELF_MEMORY_SUBJECT
      : semanticProposal.subjectRef.label;
  const scopedOrigins =
    semanticProposal.scope === 'global' || semanticProposal.scope === 'persona'
      ? {
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
        }
      : {
          originConversationId: requestEvidence.memoryConversationId,
          originThreadId: requestEvidence.sourceThreadId,
          originTaskId: semanticProposal.scope === 'session' ? requestEvidence.taskId : null,
        };
  const writeInput: CanonicalMemoryRememberInput = {
    subject,
    subjectType: semantic.subjectType,
    predicate: semanticProposal.predicate,
    value: semanticProposal.value,
    confidence: semanticProposal.confidence,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    scope: semanticProposal.scope,
    ...scopedOrigins,
    sourceRunId: context.sourceRunId,
    importance: semanticProposal.importance,
  };
  const sensitivityDeclaration = providerMemorySensitivityDeclaration(semanticProposal.sensitivity);
  if (
    classifyMemoryFactSensitivity({
      declaredSensitivity: sensitivityDeclaration.sensitivity,
      subject: writeInput.subject,
      predicate: writeInput.predicate,
      objectText: writeInput.value,
    }) === 'restricted'
  ) {
    return { status: 'restricted_content' };
  }
  const now = context.executionClaim.claimedAt;
  const resolutionContext = {
    memoryConversationId: requestEvidence.memoryConversationId,
    sourceThreadId: requestEvidence.sourceThreadId,
    taskId: requestEvidence.taskId,
    personaId: context.personaId,
  };
  const baseSourceAliases: MemoryFactContributionSourceAlias[] = [
    { sourceKind: 'message', sourceId: source.sourceMessageId },
  ];
  if (context.sourceRunId !== null) {
    baseSourceAliases.push({ sourceKind: 'run', sourceId: context.sourceRunId });
  }
  const replayContext = {
    memoryConversationId: requestEvidence.memoryConversationId,
    sourceThreadId: requestEvidence.sourceThreadId,
    taskId: requestEvidence.taskId,
    producer: {
      producerId: MEMORY_REMEMBER_FACT_PRODUCER_ID,
      producerEventId: buildMemoryRememberProducerEventId(context.executionClaim),
    },
  };
  const replay = loadFactContributionReplayFromAliasCandidates({
    context: replayContext,
    sourceAliasCandidates: [baseSourceAliases],
  });
  let replacementReplay = null;
  try {
    replacementReplay = replay ? loadExactReplacementReplayInTransaction(replay) : null;
  } catch (error) {
    if (error instanceof ExactReplacementReplayTargetChanged) {
      return { status: 'conflict', conflict: 'target_changed' };
    }
    throw error;
  }
  const effectivePredicate = replacementReplay
    ? replay!.payload.input.predicate
    : writeInput.predicate;
  const proposedResolution = replacementReplay
    ? { currentFacts: [rowToFact(replacementReplay.predecessor)], hasAnyCurrentFact: true }
    : resolveCurrentFactsForReplacement(
        { subject: writeInput.subject, predicate: effectivePredicate, scope: writeInput.scope },
        resolutionContext,
      );
  let admittedFact: ConsolidatorFact;
  let replacementTargetId: string | null = null;
  if (source.kind === 'current_user') {
    const proposal: ConsolidatorFact = {
      subject: writeInput.subject,
      predicate: effectivePredicate,
      value: writeInput.value,
      scope: writeInput.scope,
      importance: writeInput.importance,
      confidence: writeInput.confidence,
      sensitivityDeclaration,
      operation: 'replace_current',
      assertionClass: 'current_direct',
      evidenceMessageIds: [source.sourceMessageId],
      evidenceQuote: semantic.evidenceSpan,
    };
    const decision = evaluateGroundedReplacement(proposal, {
      currentUserMessageId: requestEvidence.userMessageId,
      currentUserMessage: requestEvidence.userMessageText,
      memoryConversationId: resolutionContext.memoryConversationId,
      threadId: resolutionContext.sourceThreadId,
      taskId: resolutionContext.taskId,
      personaId: resolutionContext.personaId,
      currentFacts: proposedResolution.currentFacts,
      hasAnyCurrentFact: proposedResolution.hasAnyCurrentFact,
    });

    if (!decision.accepted) {
      return { status: 'grounding_required', reason: decision.reason };
    }
    const sameValueRecord =
      semanticProposal.operation === 'record' &&
      decision.operation === 'replace_current' &&
      decision.target.objectText === writeInput.value;
    if (
      !replay &&
      ((semanticProposal.operation === 'record' &&
        decision.operation !== 'insert' &&
        !sameValueRecord) ||
        (semanticProposal.operation === 'replace_current' &&
          decision.operation !== 'replace_current'))
    ) {
      return { status: 'grounding_required', reason: 'operation_mismatch' };
    }
    admittedFact = sameValueRecord
      ? {
          ...decision.fact,
          operation: 'insert',
          admittedWrite: {
            operation: 'insert',
            authority: 'grounded_user_statement',
            evidenceMessageId: source.sourceMessageId,
          },
        }
      : decision.fact;
    replacementTargetId =
      replay?.payload.operation.kind === 'exact_replacement'
        ? replay.payload.operation.expectedCurrentFactId
        : replay
          ? null
          : decision.operation === 'replace_current' && !sameValueRecord
            ? decision.target.id
            : null;
  } else {
    if (
      semanticProposal.operation !== 'record' ||
      replacementReplay ||
      replay?.payload.operation.kind === 'exact_replacement' ||
      (writeInput.scope === 'session' && requestEvidence.taskId === null) ||
      proposedResolution.currentFacts.some((fact) => fact.objectText !== writeInput.value)
    ) {
      return {
        status: 'grounding_required',
        reason:
          writeInput.scope === 'session' && requestEvidence.taskId === null
            ? 'session_identity_unavailable'
            : 'operation_mismatch',
      };
    }
    admittedFact = {
      subject: writeInput.subject,
      predicate: effectivePredicate,
      value: writeInput.value,
      scope: writeInput.scope,
      importance: writeInput.importance,
      confidence: writeInput.confidence,
      sensitivityDeclaration,
      operation: 'insert',
      assertionClass: 'quoted',
      evidenceMessageIds: [source.sourceMessageId],
      evidenceQuote: semantic.evidenceSpan,
      admittedWrite: {
        operation: 'insert',
        authority: 'verified_tool_observation',
        evidenceMessageId: source.sourceMessageId,
      },
    };
  }
  const sourceAliases: MemoryFactContributionSourceAlias[] = replay
    ? [...replay.sourceAliases]
    : [...baseSourceAliases];
  const applicability = {
    factClass:
      source.kind === 'current_user' && semanticProposal.subjectRef.kind === 'self'
        ? ('subjective_user' as const)
        : ('objective' as const),
    sourceAuthority:
      source.kind === 'current_user' ? ('grounded_user' as const) : ('tool_observed' as const),
    ...(writeInput.scope === 'persona' ? { personaId: context.personaId } : {}),
  };
  const contributionContext = {
    ...replayContext,
    sourceAliases,
  };

  try {
    return runMemoryTransaction((): MemoryRememberPersistenceResult => {
      const subject = upsertEntity({
        name: writeInput.subject,
        type: writeInput.subjectType,
        now,
      });
      const recordInput = {
        ...buildRecordInput(writeInput, subject.id, now),
        sourceMessageId: source.sourceMessageId,
        attributes: replayStableMemoryWriteAttributes(
          admittedFact,
          evidenceSourceSha256,
          source,
          replay?.payload.input.attributes,
        ),
      };
      const result = replacementTargetId
        ? replaceCurrentFactWithContribution(
            { ...recordInput, expectedCurrentFactId: replacementTargetId },
            applicability,
            contributionContext,
            sensitivityDeclaration,
          )
        : recordFactWithContribution(
            { ...recordInput, supersedePrior: false },
            applicability,
            contributionContext,
            sensitivityDeclaration,
          );
      if (result.status === 'conflict') {
        throw new MemoryRememberConflict(result.conflict);
      }
      addFactEvidence({
        factId: result.fact.id,
        messageId: source.sourceMessageId,
        role: source.kind === 'current_user' ? 'user' : 'tool',
        quote: admittedFact.evidenceQuote,
        now,
      });
      return { status: 'persisted', result, grounded: true };
    });
  } catch (error) {
    if (error instanceof MemoryRememberConflict) {
      return { status: 'conflict', conflict: error.conflict };
    }
    throw error;
  }
}
