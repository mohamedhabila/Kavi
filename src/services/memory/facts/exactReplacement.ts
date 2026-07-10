import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from '../access/transaction';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../store';
import {
  closedMemoryFactClass,
  closedMemorySourceAuthority,
  requireMemoryFactReviewState,
  requireMemoryFactSensitivity,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import { recordFactWithApplicability } from './mutations';
import { requireFactMutationScope, requireFactMutationTimestamp } from './mutationValidation';
import { replaceFactRetrievalTerms } from './retrievalIndex';
import { requireFactScopeIdentity } from './scopeIdentity';
import { hasPersistedSourceEvidence } from './sourceEvidence';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
  serializeCurrentLocalSimilarityVector,
} from '../localSimilarity';
import {
  clamp01,
  normalizeFactKind,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type ReplaceCurrentFactConflict,
  type ReplaceCurrentFactInput,
  type ReplaceCurrentFactResult,
} from './types';

class ExactReplacementConflict extends Error {
  constructor(readonly code: ReplaceCurrentFactConflict) {
    super(code);
  }
}

function replacementScopeMatches(
  row: FactRow,
  input: ReplaceCurrentFactInput,
  personaId: string | null,
): boolean {
  const scope = requireFactMutationScope(input.scope);
  if (row.scope !== scope) return false;
  if (scope === 'global') {
    return (
      row.persona_id === null &&
      row.origin_conversation_id === null &&
      row.origin_thread_id === null &&
      row.origin_task_id === null
    );
  }
  if (scope === 'persona') {
    return (
      row.persona_id === personaId &&
      isExactMemoryScopeId(row.persona_id) &&
      row.origin_conversation_id === null &&
      row.origin_thread_id === null &&
      row.origin_task_id === null
    );
  }
  if (row.persona_id !== null || row.origin_conversation_id !== input.originConversationId) {
    return false;
  }
  if (scope === 'conversation' || scope === 'project') {
    return (
      row.origin_task_id === null &&
      (row.origin_thread_id === null || isExactMemoryScopeId(row.origin_thread_id))
    );
  }
  return (
    row.origin_thread_id === input.originThreadId &&
    row.origin_task_id === input.originTaskId &&
    isExactMemoryScopeId(row.origin_task_id)
  );
}

function reinforceExactDuplicate(
  row: FactRow,
  input: ReplaceCurrentFactInput,
  now: number,
): MemoryFact {
  const db = getSchemaReadyMemoryDb();
  const confidence = clamp01(input.confidence ?? row.confidence);
  const importance = clamp01(input.importance ?? row.importance ?? 0.5);
  const retrievability = clamp01(input.retrievability ?? row.retrievability ?? 1);
  const stability = clamp01(input.stability ?? row.stability ?? 0.5);
  const decayRate = Math.max(0, input.decayRate ?? row.decay_rate ?? 0.03);
  const attributes = { ...safeParseObject(row.attributes), ...(input.attributes ?? {}) };
  const localSimilarity = createCurrentLocalSimilarityVector(
    buildFactLocalSimilarityText({
      predicate: row.predicate,
      objectText: row.object_text,
      sourceSummary: row.source_summary,
    }),
  );
  const serializedLocalSimilarity = serializeCurrentLocalSimilarityVector(localSimilarity);
  db.runSync(
    `UPDATE memory_facts
       SET attributes = ?, updated_at = ?, confidence = MAX(confidence, ?),
           importance = MAX(importance, ?), retrievability = MAX(retrievability, ?),
           stability = MAX(stability, ?), decay_rate = MIN(decay_rate, ?),
           repeated_mention_count = repeated_mention_count + 1,
           last_reinforced_at = ?, last_accessed_at = ?,
           local_similarity_model = ?, local_similarity_dimensions = ?,
           local_similarity_vector = ?, local_similarity_updated_at = ?
     WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
    JSON.stringify(attributes),
    now,
    confidence,
    importance,
    retrievability,
    stability,
    decayRate,
    now,
    now,
    localSimilarity.model,
    localSimilarity.dimensions,
    serializedLocalSimilarity,
    now,
    row.id,
  );
  const fact = rowToFact({
    ...row,
    attributes: JSON.stringify(attributes),
    updated_at: now,
    confidence: Math.max(row.confidence, confidence),
    importance: Math.max(row.importance ?? 0.5, importance),
    retrievability: Math.max(row.retrievability ?? 1, retrievability),
    stability: Math.max(row.stability ?? 0.5, stability),
    decay_rate: Math.min(row.decay_rate ?? 0.03, decayRate),
    repeated_mention_count: (row.repeated_mention_count ?? 0) + 1,
    last_reinforced_at: now,
    last_accessed_at: now,
    local_similarity_model: localSimilarity.model,
    local_similarity_dimensions: localSimilarity.dimensions,
    local_similarity_vector: serializedLocalSimilarity,
    local_similarity_updated_at: now,
  });
  replaceFactRetrievalTerms(fact);
  runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(row.origin_conversation_id));
  return fact;
}

/**
 * Atomically replace one exact current fact. The expected target is rechecked
 * inside the write transaction; a changed or incompatible target is never
 * broadened into an insert or subject/predicate-wide invalidation.
 */
export function replaceCurrentFact(input: ReplaceCurrentFactInput): ReplaceCurrentFactResult {
  return replaceCurrentFactInternal(input);
}

/** Product-code boundary for a replacement with newly admitted provenance. */
export function replaceCurrentFactWithApplicability(
  input: ReplaceCurrentFactInput,
  applicability: SealedFactApplicabilityProvenance,
): ReplaceCurrentFactResult {
  return replaceCurrentFactInternal(input, applicability);
}

function replaceCurrentFactInternal(
  input: ReplaceCurrentFactInput,
  sealedApplicability?: SealedFactApplicabilityProvenance,
): ReplaceCurrentFactResult {
  const expectedCurrentFactId = input.expectedCurrentFactId.trim();
  if (!expectedCurrentFactId) {
    return { fact: null, status: 'conflict', superseded: [], conflict: 'target_missing' };
  }
  const predicate = input.predicate.trim();
  const objectText = input.objectText.trim();
  if (!input.subjectId) throw new Error('replaceCurrentFact: subjectId required');
  if (!predicate) throw new Error('replaceCurrentFact: predicate required');
  if (!objectText) throw new Error('replaceCurrentFact: objectText required');
  const now = requireFactMutationTimestamp(
    input.now ?? Date.now(),
    'memory_fact_mutation_clock_invalid',
  );
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
  const scope = requireFactMutationScope(input.scope);
  requireFactScopeIdentity(input, scope);

  try {
    return runMemoryTransaction(() => {
      const db = getSchemaReadyMemoryDb();
      const current = db.getFirstSync<FactRow>(
        `SELECT * FROM memory_facts
          WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL
          LIMIT 1`,
        expectedCurrentFactId,
      );
      if (!current) throw new ExactReplacementConflict('target_changed');
      if (current.memory_owner_id !== getLocalMemoryVaultOwnerId(db)) {
        throw new ExactReplacementConflict('target_scope_mismatch');
      }
      if (
        current.subject_id !== input.subjectId ||
        current.predicate.trim().toLowerCase() !== predicate.toLowerCase()
      ) {
        throw new ExactReplacementConflict('target_changed');
      }
      if (
        !replacementScopeMatches(
          current,
          input,
          sealedApplicability?.personaId ?? current.persona_id ?? null,
        )
      ) {
        throw new ExactReplacementConflict('target_scope_mismatch');
      }

      if (current.object_text.normalize('NFKC').trim() === objectText.normalize('NFKC')) {
        if (sealedApplicability) {
          return recordFactWithApplicability(
            {
              ...input,
              predicate,
              objectText,
              supersedePrior: false,
              now,
            },
            sealedApplicability,
          );
        }
        if (hasPersistedSourceEvidence(current.id, input.sourceMessageId)) {
          return {
            fact: rowToFact(current),
            status: 'duplicate' as const,
            superseded: [],
          };
        }
        return {
          fact: reinforceExactDuplicate(current, input, now),
          status: 'duplicate' as const,
          superseded: [],
        };
      }

      const inheritedReviewState = requireMemoryFactReviewState(
        input.reviewState ?? current.review_state,
      );
      const inheritedSensitivity = requireMemoryFactSensitivity(
        input.sensitivity ?? current.sensitivity,
      );
      const inheritedFactClass = closedMemoryFactClass(current.fact_class);
      const inheritedSourceAuthority = closedMemorySourceAuthority(current.source_authority);
      if (!sealedApplicability && (!inheritedFactClass || !inheritedSourceAuthority)) {
        throw new Error('memory_fact_provenance_invalid');
      }
      const replacementApplicability =
        sealedApplicability ??
        ({
          factClass: inheritedFactClass!,
          sourceAuthority: inheritedSourceAuthority!,
          ...(current.persona_id ? { personaId: current.persona_id } : {}),
        } as const);
      const created = recordFactWithApplicability(
        {
          ...input,
          predicate,
          objectText,
          pinned: input.pinned ?? current.pinned !== 0,
          sensitivity: inheritedSensitivity,
          reviewState: inheritedReviewState,
          memoryKind: input.memoryKind ?? normalizeFactKind(current.memory_kind),
          supersedePrior: false,
          now,
        },
        replacementApplicability,
      );
      if (created.status !== 'created') {
        throw new ExactReplacementConflict('replacement_collision');
      }
      const invalidated = db.runSync(
        `UPDATE memory_facts
           SET invalid_at = ?, updated_at = ?
         WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
        now,
        now,
        expectedCurrentFactId,
      );
      if ((invalidated.changes ?? 0) !== 1) {
        throw new ExactReplacementConflict('target_changed');
      }
      const superseded = rowToFact({ ...current, invalid_at: now, updated_at: now });
      return { fact: created.fact, status: 'created' as const, superseded: [superseded] };
    });
  } catch (error) {
    if (error instanceof ExactReplacementConflict) {
      return { fact: null, status: 'conflict', superseded: [], conflict: error.code };
    }
    throw error;
  }
}
