import type { EntityType } from './entities';
import { upsertEntity } from './entities';
import { runMemoryTransaction } from './access/transaction';
import type { ConsolidatorFact } from './consolidator';
import { addFactEvidence } from './episodes/mutations';
import { resolveCurrentFactsForReplacement } from './facts/currentReplacementResolution';
import { replaceCurrentFactWithApplicability } from './facts/exactReplacement';
import { recordFactWithApplicability } from './facts/mutations';
import type {
  MemoryFactScope,
  RecordFactInput,
  RecordFactResult,
  ReplaceCurrentFactConflict,
} from './facts/types';
import {
  evaluateGroundedReplacement,
  type GroundedReplacementRejection,
} from './groundedFactReplacement';
import { assertMemoryPersistenceSourcesAreWritable } from './withdrawalFence';

export interface MemoryRememberPersistenceInput {
  subject: string;
  subjectType: EntityType;
  predicate: string;
  value: string;
  confidence?: number;
  pinned: boolean;
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
}

export interface MemoryRememberPersistenceContext {
  personaId?: string;
  requestEvidence?: MemoryRememberRequestEvidence;
}

export type MemoryRememberPersistenceResult =
  | { status: 'persisted'; result: RecordFactResult; grounded: boolean }
  | {
      status: 'grounding_required';
      reason: GroundedReplacementRejection | 'scope_mismatch' | 'subject_not_grounded';
    }
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

function normalizedGroundingText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function isCanonicalSelfSubject(subject: string): boolean {
  return normalizedGroundingText(subject).toLowerCase() === 'user';
}

function hasRequiredSubjectGrounding(
  input: MemoryRememberPersistenceInput,
  evidence: MemoryRememberRequestEvidence | undefined,
): boolean {
  if (!evidence || isCanonicalSelfSubject(input.subject)) return true;
  const subject = normalizedGroundingText(input.subject);
  return Boolean(subject) && normalizedGroundingText(evidence.userMessageText).includes(subject);
}

function buildRecordInput(
  input: MemoryRememberPersistenceInput,
  subjectId: string,
): RecordFactInput {
  return {
    subjectId,
    predicate: input.predicate,
    objectText: input.value,
    confidence: input.confidence,
    pinned: input.pinned,
    scope: input.scope,
    ...(input.originConversationId !== undefined
      ? { originConversationId: input.originConversationId }
      : {}),
    ...(input.originThreadId !== undefined ? { originThreadId: input.originThreadId } : {}),
    ...(input.originTaskId !== undefined ? { originTaskId: input.originTaskId } : {}),
    ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceSummary !== undefined ? { sourceSummary: input.sourceSummary } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
  };
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

export function persistMemoryRemember(
  input: MemoryRememberPersistenceInput,
  context: MemoryRememberPersistenceContext,
): MemoryRememberPersistenceResult {
  const evidence = context.requestEvidence;
  const resolutionContext = {
    memoryConversationId: evidence?.memoryConversationId ?? input.originConversationId ?? '',
    sourceThreadId: evidence?.sourceThreadId ?? input.originThreadId ?? '',
    taskId: evidence?.taskId ?? input.originTaskId ?? null,
    personaId: context.personaId,
  };
  const resolution = resolveCurrentFactsForReplacement(
    { subject: input.subject, predicate: input.predicate, scope: input.scope },
    resolutionContext,
  );
  const proposal: ConsolidatorFact = {
    subject: input.subject,
    predicate: input.predicate,
    value: input.value,
    scope: input.scope,
    operation: 'replace_current',
    assertionClass: 'current_direct',
    evidenceMessageIds: evidence ? [evidence.userMessageId] : [],
    evidenceQuote: input.value,
  };
  const decision = hasRequiredSubjectGrounding(input, evidence)
    ? evaluateGroundedReplacement(proposal, {
        currentUserMessageId: evidence?.userMessageId,
        currentUserMessage: evidence?.userMessageText ?? '',
        memoryConversationId: resolutionContext.memoryConversationId,
        threadId: resolutionContext.sourceThreadId,
        taskId: resolutionContext.taskId,
        personaId: resolutionContext.personaId,
        currentFacts: resolution.currentFacts,
        hasAnyCurrentFact: resolution.hasAnyCurrentFact,
      })
    : ({ accepted: false, reason: 'subject_not_grounded' } as const);

  if (!decision.accepted) {
    if (evidence || resolution.currentFacts.length > 0) {
      return { status: 'grounding_required', reason: decision.reason };
    }
    const result = runMemoryTransaction(() => {
      const subject = upsertEntity({ name: input.subject, type: input.subjectType });
      return recordFactWithApplicability(
        { ...buildRecordInput(input, subject.id), sourceMessageId: null, supersedePrior: false },
        {
          factClass: 'unknown',
          sourceAuthority: 'assistant_inferred',
          ...(input.scope === 'persona' ? { personaId: context.personaId } : {}),
        },
      );
    });
    return { status: 'persisted', result, grounded: false };
  }

  if (!evidence || !evidenceOwnsWriteScope(input, evidence)) {
    return { status: 'grounding_required', reason: 'scope_mismatch' };
  }
  return runMemoryTransaction((): MemoryRememberPersistenceResult => {
    assertMemoryPersistenceSourcesAreWritable(
      {
        memoryConversationId: evidence.memoryConversationId,
        sourceThreadId: evidence.sourceThreadId,
        taskId: evidence.taskId,
      },
      [{ sourceKind: 'message', sourceId: evidence.userMessageId }],
    );
    const subject = upsertEntity({ name: input.subject, type: input.subjectType });
    const recordInput = {
      ...buildRecordInput(input, subject.id),
      sourceMessageId: evidence.userMessageId,
      attributes: memoryWriteAttributes(decision.fact),
    };
    const result =
      decision.operation === 'replace_current'
        ? replaceCurrentFactWithApplicability(
            { ...recordInput, expectedCurrentFactId: decision.target.id },
            {
              factClass: 'subjective_user',
              sourceAuthority: 'grounded_user',
              ...(input.scope === 'persona' ? { personaId: context.personaId } : {}),
            },
          )
        : recordFactWithApplicability(
            { ...recordInput, supersedePrior: false },
            {
              factClass: 'subjective_user',
              sourceAuthority: 'grounded_user',
              ...(input.scope === 'persona' ? { personaId: context.personaId } : {}),
            },
          );
    if (result.status === 'conflict') {
      return { status: 'conflict', conflict: result.conflict };
    }
    addFactEvidence({
      factId: result.fact.id,
      messageId: evidence.userMessageId,
      role: 'user',
      quote: decision.fact.evidenceQuote,
    });
    return { status: 'persisted', result, grounded: true };
  });
}
