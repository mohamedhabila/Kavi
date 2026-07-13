import type { EntityType } from './entities';
import { upsertEntity } from './entities';
import { runMemoryTransaction } from './access/transaction';
import type { ConsolidatorFact } from './consolidator';
import { addFactEvidence } from './episodes/mutations';
import {
  resolveCurrentFactsForReplacement,
  resolvePriorUserSelfCorrectionFacts,
} from './facts/currentReplacementResolution';
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
import { assertMemoryPersistenceSourcesAreWritable } from './withdrawalFence';
import {
  deriveExactSelfCorrectionEvidence,
  deriveExactNamedSubjectClaimEvidence,
  deriveExactSelfClaimEvidence,
} from './exactSelfClaimEvidence';
import { hasPotentialSelfCorrectionAnchor } from './exactSelfCorrectionStructure';
import { isCanonicalSelfMemorySubject } from './memorySubjectIdentity';
import { classifyMemoryFactSensitivity } from './memorySensitivityPolicy';
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

export interface MemoryRememberPersistenceInput {
  subject: string;
  subjectType: EntityType;
  predicate: string;
  value: string;
  confidence?: number;
  pinned?: boolean;
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  sourceRunId?: string | null;
  sourceSummary?: string | null;
  importance?: number;
}

export interface MemoryRememberRequestEvidence {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  userMessageId: string;
  userMessageText: string;
  /** Code-owned immediately preceding user message in this conversation. */
  priorUserMessageId?: string;
}

export interface MemoryRememberPersistenceContext {
  personaId?: string;
  requestEvidence: MemoryRememberRequestEvidence;
  executionClaim: AuthorizedToolEffectExecutionClaim;
}

export type MemoryRememberPersistenceResult =
  | { status: 'persisted'; result: RecordFactResult; grounded: boolean }
  | {
      status: 'grounding_required';
      reason: GroundedReplacementRejection | 'scope_mismatch' | 'subject_not_grounded';
    }
  | { status: 'restricted_content' }
  | { status: 'conflict'; conflict: ReplaceCurrentFactConflict };

function evidenceOwnsWriteScope(
  input: MemoryRememberPersistenceInput,
  evidence: MemoryRememberRequestEvidence,
): boolean {
  if (input.scope === 'global' || input.scope === 'persona') return true;
  if (
    input.originConversationId !== evidence.memoryConversationId ||
    input.originThreadId !== evidence.sourceThreadId
  ) {
    return false;
  }
  return input.scope !== 'session' || input.originTaskId === evidence.taskId;
}

function buildRecordInput(
  input: MemoryRememberPersistenceInput,
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
    ...(input.originConversationId !== undefined
      ? { originConversationId: input.originConversationId }
      : {}),
    ...(input.originThreadId !== undefined ? { originThreadId: input.originThreadId } : {}),
    ...(input.originTaskId !== undefined ? { originTaskId: input.originTaskId } : {}),
    ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceSummary !== undefined ? { sourceSummary: input.sourceSummary } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
    validAt: now,
    now,
  };
}

class MemoryRememberConflict extends Error {
  constructor(readonly conflict: ReplaceCurrentFactConflict) {
    super(`memory_remember_conflict:${conflict}`);
  }
}

function memoryWriteAttributes(fact: ConsolidatorFact): Record<string, unknown> {
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
    },
  };
}

function replayStableMemoryWriteAttributes(
  fact: ConsolidatorFact,
  priorAttributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const incoming = memoryWriteAttributes(fact);
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
  if (
    !context ||
    !isExactMemoryRememberExecutionClaim(context.executionClaim) ||
    !isExactMemoryRememberRequestEvidence(context.requestEvidence)
  ) {
    throw new Error('memory_remember_execution_authority_invalid');
  }
  if (
    classifyMemoryFactSensitivity({
      subject: input.subject,
      subjectType: input.subjectType,
      predicate: input.predicate,
      objectText: input.value,
      sourceSummary: input.sourceSummary,
      memoryKind: 'semantic_fact',
    }) === 'restricted'
  ) {
    return { status: 'restricted_content' };
  }
  const evidence = context.requestEvidence;
  const now = context.executionClaim.claimedAt;
  const resolutionContext = {
    memoryConversationId: evidence.memoryConversationId,
    sourceThreadId: evidence.sourceThreadId,
    taskId: evidence.taskId,
    personaId: context.personaId,
  };
  const baseSourceAliases: MemoryFactContributionSourceAlias[] = [
    { sourceKind: 'message', sourceId: evidence.userMessageId },
  ];
  if (input.sourceRunId !== null && input.sourceRunId !== undefined) {
    baseSourceAliases.push({ sourceKind: 'run', sourceId: input.sourceRunId });
  }
  const replayContext = {
    memoryConversationId: evidence.memoryConversationId,
    sourceThreadId: evidence.sourceThreadId,
    taskId: evidence.taskId,
    producer: {
      producerId: MEMORY_REMEMBER_FACT_PRODUCER_ID,
      producerEventId: buildMemoryRememberProducerEventId(context.executionClaim),
    },
  };
  const replay = loadFactContributionReplayFromAliasCandidates({
    context: replayContext,
    sourceAliasCandidates: evidence.priorUserMessageId
      ? [
          baseSourceAliases,
          [...baseSourceAliases, { sourceKind: 'message', sourceId: evidence.priorUserMessageId }],
        ]
      : [baseSourceAliases],
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
  const effectivePredicate = replacementReplay ? replay!.payload.input.predicate : input.predicate;
  const proposedResolution = replacementReplay
    ? { currentFacts: [rowToFact(replacementReplay.predecessor)], hasAnyCurrentFact: true }
    : resolveCurrentFactsForReplacement(
        { subject: input.subject, predicate: effectivePredicate, scope: input.scope },
        resolutionContext,
      );
  const directClaim = isCanonicalSelfMemorySubject(input.subject)
    ? deriveExactSelfClaimEvidence({
        userMessageText: evidence.userMessageText,
        predicate: effectivePredicate,
        value: input.value,
      })
    : deriveExactNamedSubjectClaimEvidence({
        userMessageText: evidence.userMessageText,
        subject: input.subject,
        predicate: effectivePredicate,
        value: input.value,
      });
  const proposedPredicateCorrection =
    isCanonicalSelfMemorySubject(input.subject) && proposedResolution.currentFacts.length === 1
      ? deriveExactSelfCorrectionEvidence({
          userMessageText: evidence.userMessageText,
          predicate: effectivePredicate,
          value: input.value,
          currentValue: proposedResolution.currentFacts[0]!.objectText,
        })
      : null;
  const exactPredicateCorrection =
    proposedPredicateCorrection &&
    (proposedPredicateCorrection.correctionTarget === 'direct_property' || replacementReplay)
      ? proposedPredicateCorrection
      : null;
  const priorMessageFacts =
    evidence.priorUserMessageId &&
    !exactPredicateCorrection &&
    isCanonicalSelfMemorySubject(input.subject)
      ? resolvePriorUserSelfCorrectionFacts(
          {
            subject: input.subject,
            sourceMessageId: evidence.priorUserMessageId,
            scope: input.scope,
          },
          resolutionContext,
        )
      : [];
  const priorMessageCorrectionCandidates = priorMessageFacts.flatMap((fact) => {
    const claim = deriveExactSelfCorrectionEvidence({
      userMessageText: evidence.userMessageText,
      predicate: fact.predicate,
      value: input.value,
      currentValue: fact.objectText,
    });
    return claim ? [{ fact, claim }] : [];
  });
  const priorMessageCorrection =
    priorMessageCorrectionCandidates.length === 1 ? priorMessageCorrectionCandidates[0]! : null;
  const proposedCorrectionIntent = priorMessageFacts.some((fact) =>
    hasPotentialSelfCorrectionAnchor({
      text: evidence.userMessageText,
      value: input.value,
      currentValue: fact.objectText,
    }),
  );
  const exactPredicateCorrectionIntent =
    isCanonicalSelfMemorySubject(input.subject) &&
    proposedResolution.currentFacts.length === 1 &&
    hasPotentialSelfCorrectionAnchor({
      text: evidence.userMessageText,
      value: input.value,
      currentValue: proposedResolution.currentFacts[0]!.objectText,
    });
  const priorMessageCorrectionIsUnresolved =
    priorMessageCorrectionCandidates.length > 1 ||
    (!exactPredicateCorrection &&
      !priorMessageCorrection &&
      (proposedCorrectionIntent || exactPredicateCorrectionIntent));
  const predicate = priorMessageCorrection?.fact.predicate ?? effectivePredicate;
  const resolution = priorMessageCorrection
    ? { currentFacts: [priorMessageCorrection.fact], hasAnyCurrentFact: true }
    : proposedResolution;
  const exactClaim = priorMessageCorrectionIsUnresolved
    ? null
    : (exactPredicateCorrection ?? priorMessageCorrection?.claim ?? directClaim ?? null);
  const writeInput = predicate === input.predicate ? input : { ...input, predicate };
  const proposal: ConsolidatorFact = {
    subject: input.subject,
    predicate,
    value: input.value,
    scope: input.scope,
    operation: 'replace_current',
    assertionClass: 'current_direct',
    evidenceMessageIds: [evidence.userMessageId],
    evidenceQuote: exactClaim?.evidenceQuote ?? input.value,
  };
  const decision = exactClaim
    ? evaluateGroundedReplacement(proposal, {
        currentUserMessageId: evidence.userMessageId,
        currentUserMessage: evidence.userMessageText,
        memoryConversationId: resolutionContext.memoryConversationId,
        threadId: resolutionContext.sourceThreadId,
        taskId: resolutionContext.taskId,
        personaId: resolutionContext.personaId,
        currentFacts: resolution.currentFacts,
        hasAnyCurrentFact: resolution.hasAnyCurrentFact,
      })
    : ({ accepted: false, reason: 'subject_not_grounded' } as const);

  if (!decision.accepted) {
    return { status: 'grounding_required', reason: decision.reason };
  }

  if (!evidenceOwnsWriteScope(input, evidence)) {
    return { status: 'grounding_required', reason: 'scope_mismatch' };
  }
  const sourceAliases: MemoryFactContributionSourceAlias[] = replay
    ? [...replay.sourceAliases]
    : [...baseSourceAliases];
  if (!replay && priorMessageCorrection && evidence.priorUserMessageId) {
    sourceAliases.push({ sourceKind: 'message', sourceId: evidence.priorUserMessageId });
  }
  const applicability = {
    factClass: 'subjective_user' as const,
    sourceAuthority: 'grounded_user' as const,
    ...(writeInput.scope === 'persona' ? { personaId: context.personaId } : {}),
  };
  const contributionContext = {
    ...replayContext,
    sourceAliases,
  };

  try {
    return runMemoryTransaction((): MemoryRememberPersistenceResult => {
      assertMemoryPersistenceSourcesAreWritable(
        {
          memoryConversationId: evidence.memoryConversationId,
          sourceThreadId: evidence.sourceThreadId,
          taskId: evidence.taskId,
        },
        sourceAliases,
      );
      const subject = upsertEntity({
        name: writeInput.subject,
        type: writeInput.subjectType,
        now,
      });
      const recordInput = {
        ...buildRecordInput(writeInput, subject.id, now),
        sourceMessageId: evidence.userMessageId,
        attributes: replayStableMemoryWriteAttributes(
          decision.fact,
          replay?.payload.input.attributes,
        ),
      };
      const result =
        decision.operation === 'replace_current'
          ? replaceCurrentFactWithContribution(
              { ...recordInput, expectedCurrentFactId: decision.target.id },
              applicability,
              contributionContext,
            )
          : recordFactWithContribution(
              { ...recordInput, supersedePrior: false },
              applicability,
              contributionContext,
            );
      if (result.status === 'conflict') {
        throw new MemoryRememberConflict(result.conflict);
      }
      addFactEvidence({
        factId: result.fact.id,
        messageId: evidence.userMessageId,
        role: 'user',
        quote: decision.fact.evidenceQuote,
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
