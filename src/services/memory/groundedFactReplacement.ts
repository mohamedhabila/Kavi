import type { ConsolidatorFact } from './consolidator';
import type { MemoryFact, MemoryFactScope } from './facts/types';

export type GroundedReplacementRejection =
  | 'not_replace_operation'
  | 'not_current_direct'
  | 'missing_current_user_message'
  | 'wrong_evidence_message'
  | 'missing_evidence_quote'
  | 'quote_not_in_current_user_message'
  | 'value_not_in_current_user_message'
  | 'no_compatible_current_fact'
  | 'ambiguous_current_fact'
  | 'project_identity_unavailable'
  | 'persona_identity_unavailable';

export type GroundedReplacementDecision =
  | {
      accepted: true;
      fact: ConsolidatorFact;
      target: MemoryFact;
    }
  | {
      accepted: false;
      reason: GroundedReplacementRejection;
    };

export interface GroundedReplacementContext {
  currentUserMessageId?: string;
  currentUserMessage: string;
  memoryConversationId: string;
  threadId: string;
  taskId?: string;
  currentFacts: readonly MemoryFact[];
}

function normalizeGroundingText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function normalizeId(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function proposedScope(fact: ConsolidatorFact): MemoryFactScope {
  return fact.scope ?? 'conversation';
}

function isCompatibleTarget(
  fact: MemoryFact,
  scope: MemoryFactScope,
  context: GroundedReplacementContext,
): boolean {
  if (fact.scope !== scope) return false;
  if (scope === 'global') return true;

  return (
    normalizeId(fact.originConversationId) === normalizeId(context.memoryConversationId) &&
    normalizeId(fact.originThreadId) === normalizeId(context.threadId) &&
    normalizeId(fact.originTaskId) === normalizeId(context.taskId)
  );
}

export function evaluateGroundedReplacement(
  proposal: ConsolidatorFact,
  context: GroundedReplacementContext,
): GroundedReplacementDecision {
  if (proposal.operation !== 'replace_current') {
    return { accepted: false, reason: 'not_replace_operation' };
  }
  if (proposal.assertionClass !== 'current_direct') {
    return { accepted: false, reason: 'not_current_direct' };
  }

  const currentUserMessageId = context.currentUserMessageId?.trim();
  if (!currentUserMessageId) {
    return { accepted: false, reason: 'missing_current_user_message' };
  }
  if (
    proposal.evidenceMessageIds?.length !== 1 ||
    proposal.evidenceMessageIds[0] !== currentUserMessageId
  ) {
    return { accepted: false, reason: 'wrong_evidence_message' };
  }

  const normalizedQuote = normalizeGroundingText(proposal.evidenceQuote ?? '');
  if (!normalizedQuote) {
    return { accepted: false, reason: 'missing_evidence_quote' };
  }
  const normalizedUserMessage = normalizeGroundingText(context.currentUserMessage);
  if (!normalizedUserMessage.includes(normalizedQuote)) {
    return { accepted: false, reason: 'quote_not_in_current_user_message' };
  }
  const normalizedValue = normalizeGroundingText(proposal.value);
  if (!normalizedValue || !normalizedQuote.includes(normalizedValue)) {
    return { accepted: false, reason: 'value_not_in_current_user_message' };
  }

  const scope = proposedScope(proposal);
  if (scope === 'project') {
    return { accepted: false, reason: 'project_identity_unavailable' };
  }
  if (scope === 'persona') {
    return { accepted: false, reason: 'persona_identity_unavailable' };
  }

  const compatible = context.currentFacts.filter((fact) =>
    isCompatibleTarget(fact, scope, context),
  );
  if (compatible.length === 0) {
    return { accepted: false, reason: 'no_compatible_current_fact' };
  }
  if (compatible.length !== 1) {
    return { accepted: false, reason: 'ambiguous_current_fact' };
  }

  const target = compatible[0]!;
  return {
    accepted: true,
    target,
    fact: {
      ...proposal,
      evidenceMessageIds: [currentUserMessageId],
      admittedWrite: {
        operation: 'replace_current',
        authority: 'grounded_user_statement',
        evidenceMessageId: currentUserMessageId,
        expectedCurrentFactId: target.id,
      },
    },
  };
}
