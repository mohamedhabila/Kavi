import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryTransaction } from '../access/transaction';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from '../memorySensitivityPolicy';
import {
  loadFactContributionReplay,
  type MemoryFactContributionWriteContext,
} from '../factContributionStore';
import { assertMemoryFactContributionReplayPayload } from '../factContributionReplay';
import {
  closedMemoryFactClass,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
  requireMemoryFactReviewState,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import { recordFactWithApplicability, recordFactWithContributionInTransaction } from './mutations';
import {
  FactContributionMaterializationConflict,
  setFactSensitivityFloorInTransaction,
} from './factContributionMaterialization';
import { requireFactMutationScope, requireFactMutationTimestamp } from './mutationValidation';
import { requireFactScopeIdentity } from './scopeIdentity';
import { normalizeRecordFactMutation } from './mutationNormalization';
import {
  canonicalizeExactReplacementPredecessorInTransaction,
  ExactReplacementReplayTargetChanged,
  finalizeExactReplacementReplayInTransaction,
  loadExactReplacementReplayInTransaction,
} from './exactReplacementReplay';
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

function requireReplacementTarget(
  row: FactRow,
  input: ReplaceCurrentFactInput,
  predicate: string,
  validAt: number,
  personaId: string | null,
): void {
  if (row.memory_owner_id !== getLocalMemoryVaultOwnerId(getSchemaReadyMemoryDb())) {
    throw new ExactReplacementConflict('target_scope_mismatch');
  }
  if (
    row.subject_id !== input.subjectId ||
    row.predicate.trim().toLowerCase() !== predicate.toLowerCase()
  ) {
    throw new ExactReplacementConflict('target_changed');
  }
  if (!replacementScopeMatches(row, input, personaId)) {
    throw new ExactReplacementConflict('target_scope_mismatch');
  }
  if (row.valid_at > validAt) {
    throw new ExactReplacementConflict('stale_source_order');
  }
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
      const contributionReplay = contributionContext
        ? loadFactContributionReplay(contributionContext)
        : null;
      const replacementReplay = contributionReplay
        ? loadExactReplacementReplayInTransaction(contributionReplay)
        : null;
      if (replacementReplay) {
        if (!sealedApplicability || !contributionContext || !contributionReplay) {
          throw new Error('memory_fact_provenance_invalid');
        }
        if (
          expectedCurrentFactId !== replacementReplay.predecessor.id &&
          expectedCurrentFactId !== replacementReplay.successor.id
        ) {
          throw new ExactReplacementConflict('target_changed');
        }
        requireReplacementTarget(
          replacementReplay.predecessor,
          input,
          predicate,
          validAt,
          sealedApplicability.personaId ?? replacementReplay.predecessor.persona_id ?? null,
        );
        const replayMemoryKind =
          input.memoryKind ?? normalizeFactKind(replacementReplay.predecessor.memory_kind);
        const replayObjectEntityId =
          input.objectEntityId === undefined
            ? replacementReplay.predecessor.object_entity_id
            : input.objectEntityId;
        const replayInput = {
          ...input,
          predicate,
          objectText,
          objectEntityId: replayObjectEntityId,
          memoryKind: replayMemoryKind,
          supersedePrior: false,
          now,
        };
        const replayPayload = normalizeRecordFactMutation(replayInput, sealedApplicability);
        assertMemoryFactContributionReplayPayload(contributionReplay, replayPayload);
        if (
          replacementReplay.pinnedInputExplicit !== (input.pinned !== undefined) ||
          replacementReplay.reviewStateInputExplicit !== (input.reviewState !== undefined)
        ) {
          throw new Error('memory_fact_contribution_replay_mismatch');
        }
        return finalizeExactReplacementReplayInTransaction({
          replay: contributionReplay,
          state: replacementReplay,
          payload: replayPayload,
          context: contributionContext,
        });
      }

      let current = db.getFirstSync<FactRow>(
        `SELECT * FROM memory_facts
          WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL
          LIMIT 1`,
        expectedCurrentFactId,
      );
      if (!current) throw new ExactReplacementConflict('target_changed');
      requireReplacementTarget(
        current,
        input,
        predicate,
        validAt,
        sealedApplicability?.personaId ?? current.persona_id ?? null,
      );

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
              {
                materializationInput: duplicateMaterializationInput,
                expectedStatus: 'duplicate',
              },
            ).result
          : recordFactWithApplicability(duplicateMaterializationInput, duplicateApplicability);
        if (duplicate.status !== 'duplicate' || duplicate.fact.id !== current.id) {
          throw new ExactReplacementConflict('replacement_collision');
        }
        return duplicate;
      }

      current = canonicalizeExactReplacementPredecessorInTransaction(current);

      const inheritedReviewState = requireMemoryFactReviewState(
        input.reviewState ?? current.review_state,
      );
      const inheritedSensitivity =
        current.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
          ? (closedMemoryFactSensitivity(current.sensitivity) ?? 'restricted')
          : 'restricted';
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
      const causalReplacementInput = {
        ...replacementInput,
        pinned: input.pinned,
        reviewState: input.reviewState,
      };
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
      const created = contributionContext
        ? recordFactWithContributionInTransaction(
            causalReplacementInput,
            replacementApplicability,
            contributionContext,
            {
              materializationInput: replacementInput,
              superseded: [superseded],
              sensitivityFloor: inheritedSensitivity,
              expectedStatus: 'created',
            },
          ).result
        : recordFactWithApplicability(replacementInput, replacementApplicability);
      if (created.status !== 'created') {
        throw new ExactReplacementConflict('replacement_collision');
      }
      const protectedCreated = contributionContext
        ? created.fact
        : setFactSensitivityFloorInTransaction(created.fact.id, inheritedSensitivity);
      return { fact: protectedCreated, status: 'created' as const, superseded: [superseded] };
    });
  } catch (error) {
    if (error instanceof FactContributionMaterializationConflict) {
      return {
        fact: null,
        status: 'conflict',
        superseded: [],
        conflict: 'replacement_collision',
      };
    }
    if (error instanceof ExactReplacementReplayTargetChanged) {
      return { fact: null, status: 'conflict', superseded: [], conflict: 'target_changed' };
    }
    if (error instanceof ExactReplacementConflict) {
      return { fact: null, status: 'conflict', superseded: [], conflict: error.code };
    }
    throw error;
  }
}
