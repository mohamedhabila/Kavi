import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryTransaction } from '../access/transaction';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import {
  persistFactContributionSupersessionsInTransaction,
  type MemoryFactContributionWriteContext,
} from '../factContributionStore';
import {
  closedMemoryFactClass,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
  requireMemoryFactReviewState,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import {
  recordFactWithApplicability,
  recordFactWithContributionInTransaction,
  setFactSensitivityFloorInTransaction,
} from './mutations';
import { requireFactMutationScope, requireFactMutationTimestamp } from './mutationValidation';
import { requireFactScopeIdentity } from './scopeIdentity';
import {
  normalizeFactKind,
  rowToFact,
  type FactRow,
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

/** Product replacement that cannot commit without its immutable source contribution. */
export function replaceCurrentFactWithContribution(
  input: ReplaceCurrentFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
): ReplaceCurrentFactResult {
  return replaceCurrentFactInternal(input, applicability, context);
}

function replaceCurrentFactInternal(
  input: ReplaceCurrentFactInput,
  sealedApplicability?: SealedFactApplicabilityProvenance,
  contributionContext?: MemoryFactContributionWriteContext,
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
      if (current.valid_at > validAt) {
        throw new ExactReplacementConflict('stale_source_order');
      }

      const currentMemoryKind = normalizeFactKind(current.memory_kind);
      const replacementMemoryKind = input.memoryKind ?? currentMemoryKind;
      const replacementObjectEntityId =
        input.objectEntityId === undefined ? current.object_entity_id : input.objectEntityId;
      const hasExactCurrentContentIdentity =
        current.object_text.normalize('NFKC').trim() === objectText.normalize('NFKC') &&
        replacementMemoryKind === currentMemoryKind &&
        (replacementObjectEntityId ?? null) === current.object_entity_id;

      if (hasExactCurrentContentIdentity) {
        const duplicateInput = {
          ...input,
          predicate,
          objectText,
          objectEntityId: replacementObjectEntityId,
          memoryKind: replacementMemoryKind,
          supersedePrior: false,
          now,
        };
        const duplicateMaterializationInput = {
          ...duplicateInput,
          confidence: input.confidence ?? current.confidence,
          importance: input.importance ?? current.importance ?? 0.5,
          retrievability: input.retrievability ?? current.retrievability ?? 1,
          stability: input.stability ?? current.stability ?? 0.5,
          decayRate: input.decayRate ?? current.decay_rate ?? 0.03,
        };
        const currentFactClass = closedMemoryFactClass(current.fact_class);
        const currentSourceAuthority = closedMemorySourceAuthority(current.source_authority);
        if (!sealedApplicability && (!currentFactClass || !currentSourceAuthority)) {
          throw new Error('memory_fact_provenance_invalid');
        }
        const duplicateApplicability =
          sealedApplicability ??
          ({
            factClass: currentFactClass!,
            sourceAuthority: currentSourceAuthority!,
            ...(current.persona_id ? { personaId: current.persona_id } : {}),
          } as const);
        const duplicate = contributionContext
          ? recordFactWithContributionInTransaction(
              duplicateInput,
              duplicateApplicability,
              contributionContext,
              duplicateMaterializationInput,
            ).result
          : recordFactWithApplicability(duplicateMaterializationInput, duplicateApplicability);
        if (duplicate.status !== 'duplicate' || duplicate.fact.id !== current.id) {
          throw new ExactReplacementConflict('replacement_collision');
        }
        return duplicate;
      }

      const inheritedReviewState = requireMemoryFactReviewState(
        input.reviewState ?? current.review_state,
      );
      const inheritedSensitivity = closedMemoryFactSensitivity(current.sensitivity) ?? 'restricted';
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
      const replacementInput = {
        ...input,
        predicate,
        objectText,
        objectEntityId: replacementObjectEntityId,
        pinned: input.pinned ?? current.pinned !== 0,
        reviewState: inheritedReviewState,
        memoryKind: replacementMemoryKind,
        supersedePrior: false,
        now,
      };
      const contributed = contributionContext
        ? recordFactWithContributionInTransaction(
            replacementInput,
            replacementApplicability,
            contributionContext,
          )
        : null;
      const created = contributed
        ? contributed.result
        : recordFactWithApplicability(replacementInput, replacementApplicability);
      if (created.status !== 'created') {
        throw new ExactReplacementConflict('replacement_collision');
      }
      const protectedCreated = setFactSensitivityFloorInTransaction(
        created.fact.id,
        inheritedSensitivity,
      );
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
      if (contributed) {
        persistFactContributionSupersessionsInTransaction({
          contributionId: contributed.contributionId,
          successorFactId: protectedCreated.id,
          superseded: [superseded],
          projectionIntent: {
            pinnedInputExplicit: input.pinned !== undefined,
            reviewStateInputExplicit: input.reviewState !== undefined,
          },
        });
      }
      return { fact: protectedCreated, status: 'created' as const, superseded: [superseded] };
    });
  } catch (error) {
    if (error instanceof ExactReplacementConflict) {
      return { fact: null, status: 'conflict', superseded: [], conflict: error.code };
    }
    throw error;
  }
}
