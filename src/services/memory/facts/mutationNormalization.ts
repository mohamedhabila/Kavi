import {
  resolveFactApplicabilityProvenance,
  requireMemoryFactReviewState,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import { requireFactMutationScope, requireFactMutationTimestamp } from './mutationValidation';
import { requireFactScopeIdentity } from './scopeIdentity';
import { clamp01, normalizeDecayPolicy, normalizeFactKind, type RecordFactInput } from './types';
import {
  MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
  type MemoryFactContributionPayloadV1,
} from '../factContributionCodec';

/** Resolve every default exactly once before a fact mutation or contribution write. */
export function normalizeRecordFactMutation(
  input: RecordFactInput,
  sealedApplicability?: SealedFactApplicabilityProvenance,
): MemoryFactContributionPayloadV1 {
  const now = requireFactMutationTimestamp(
    input.now ?? Date.now(),
    'memory_fact_mutation_clock_invalid',
  );
  if (!input.subjectId) throw new Error('recordFact: subjectId required');
  const predicate = input.predicate.trim();
  const objectText = input.objectText.trim();
  if (!predicate) throw new Error('recordFact: predicate required');
  if (!objectText) throw new Error('recordFact: objectText required');

  const scope = requireFactMutationScope(input.scope);
  requireFactScopeIdentity(input, scope);
  const validAt = requireFactMutationTimestamp(
    input.validAt ?? now,
    'memory_fact_valid_at_invalid',
  );
  const expiresAt =
    input.expiresAt === null || input.expiresAt === undefined
      ? null
      : requireFactMutationTimestamp(input.expiresAt, 'memory_fact_expires_at_invalid');
  if (expiresAt !== null && expiresAt <= validAt) {
    throw new Error('memory_fact_validity_order_invalid');
  }
  const memoryKind = normalizeFactKind(input.memoryKind);
  const applicability = resolveFactApplicabilityProvenance({
    scope,
    memoryKind,
    ...(sealedApplicability ? { sealed: sealedApplicability } : {}),
  });

  return {
    version: MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
    applicability,
    input: {
      subjectId: input.subjectId,
      predicate,
      objectText,
      objectEntityId: input.objectEntityId ?? null,
      attributes: input.attributes ?? {},
      confidence: clamp01(input.confidence ?? 1),
      sourceMessageId: input.sourceMessageId ?? null,
      sourceRunId: input.sourceRunId ?? null,
      scope,
      originConversationId: input.originConversationId ?? null,
      originThreadId: input.originThreadId ?? null,
      originTaskId: input.originTaskId ?? null,
      sourceTurnId: input.sourceTurnId ?? null,
      sourceSummary: input.sourceSummary ?? null,
      importance: clamp01(input.importance ?? 0.5),
      decayPolicy: normalizeDecayPolicy(input.decayPolicy),
      expiresAt,
      validAt,
      pinned: input.pinned ?? false,
      sourceActorId: input.sourceActorId ?? null,
      retrievability: clamp01(input.retrievability ?? 1),
      stability: clamp01(input.stability ?? 0.5),
      decayRate: Math.max(0, input.decayRate ?? 0.03),
      reviewState: requireMemoryFactReviewState(input.reviewState ?? 'auto'),
      memoryKind,
      supersedePrior: input.supersedePrior === true,
      now,
    },
  };
}
