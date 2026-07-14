import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { newId, safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from '../access/transaction';
import { MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES } from '../factContributionChildCommitments';
import {
  persistFactContributionInTransaction,
  type MemoryFactContributionWriteReceipt,
  type MemoryFactContributionWriteContext,
} from '../factContributionStore';
import { loadVerifiedFactContributionReplay } from '../factContributionReplay';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { overlayFactExplicitProjectionInTransaction } from '../factExplicitOverrideState';
import {
  classifyMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from '../memorySensitivityPolicy';
import { replaceFactRetrievalTerms } from './retrievalIndex';
import { buildFactContentHash, hasExactFactContentIdentity } from './contentIdentity';
import {
  mergeDuplicateProvenance,
  mergeDuplicateReviewState,
  mergeDuplicateSensitivity,
} from './duplicateMetadata';
import {
  normalizeExactReplacementFactMutation,
  normalizeRecordFactMutation,
} from './mutationNormalization';
import { hasPersistedSourceEvidence } from './sourceEvidence';
import { buildSupersedePriorQuery } from './supersessionQuery';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
  serializeCurrentLocalSimilarityVector,
} from '../localSimilarity';
import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import {
  FactContributionMaterializationConflict,
  setFactSensitivityFloorInTransaction,
  type RecordFactWithContributionOptions,
} from './factContributionMaterialization';
import {
  rowToFact,
  type FactRow,
  type MemoryFact,
  type RecordFactInput,
  type RecordFactResult,
} from './types';
import type { MemoryFactContributionPayloadV1 } from '../factContributionCodec';

function hasExactSupersessionScopeIdentity(
  fact: FactRow,
  input: RecordFactInput,
  scope: NonNullable<RecordFactInput['scope']>,
  memoryOwnerId: string,
  personaId: string | null,
): boolean {
  if (fact.memory_owner_id !== memoryOwnerId || fact.scope !== scope) return false;
  if (scope === 'global') {
    return (
      fact.persona_id === null &&
      fact.origin_conversation_id === null &&
      fact.origin_thread_id === null &&
      fact.origin_task_id === null
    );
  }
  if (scope === 'persona') {
    return (
      fact.persona_id === personaId &&
      fact.origin_conversation_id === null &&
      fact.origin_thread_id === null &&
      fact.origin_task_id === null
    );
  }
  if (fact.persona_id !== null || fact.origin_conversation_id !== input.originConversationId) {
    return false;
  }
  if (scope === 'conversation' || scope === 'project') {
    return (
      fact.origin_task_id === null &&
      (fact.origin_thread_id === null || isExactMemoryScopeId(fact.origin_thread_id))
    );
  }
  return (
    fact.origin_thread_id === input.originThreadId &&
    fact.origin_task_id === input.originTaskId &&
    isExactMemoryScopeId(fact.origin_task_id)
  );
}

/**
 * Record (or dedupe) a fact. When `supersedePrior` is true any currently-valid
 * fact with the same (subject_id, predicate) is invalidated at `now` first.
 * Supersession is exact to the persisted owner and scope identity. A write can
 * never invalidate facts from another scope, persona, root, thread, or task.
 * Uses `content_hash` only to narrow active-row candidates; exact persisted
 * identity decides idempotency so a hash collision cannot merge two facts.
 */
export function recordFact(input: RecordFactInput): RecordFactResult {
  return runMemoryTransaction(() => recordFactInTransaction(input));
}

/** Product-code boundary for provenance that must never come from generic fact input. */
export function recordFactWithApplicability(
  input: RecordFactInput,
  applicability: SealedFactApplicabilityProvenance,
): RecordFactResult {
  return runMemoryTransaction(() => recordFactInTransaction(input, applicability));
}

/** Product fact write that cannot commit without its immutable source contribution. */
export function recordFactWithContribution(
  input: RecordFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
): RecordFactResult {
  return runMemoryTransaction(
    () => recordFactWithContributionInTransaction(input, applicability, context).result,
  );
}

/** Persist one causal event after applying its complete transaction-owned materialization plan. */
export function recordFactWithContributionInTransaction(
  input: RecordFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
  options: RecordFactWithContributionOptions = {},
): {
  result: RecordFactResult;
  contributionId: string;
  contributionStatus: MemoryFactContributionWriteReceipt['status'];
} {
  const payload = normalizeRecordFactMutation(input, applicability);
  return recordNormalizedFactWithContributionInTransaction(
    input,
    applicability,
    context,
    payload,
    options,
  );
}

/** Persist one exact replacement against its immutable original predecessor target. */
export function recordExactReplacementFactWithContributionInTransaction(
  input: RecordFactInput,
  expectedCurrentFactId: string,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
  options: RecordFactWithContributionOptions = {},
): {
  result: RecordFactResult;
  contributionId: string;
  contributionStatus: MemoryFactContributionWriteReceipt['status'];
} {
  const payload = normalizeExactReplacementFactMutation(
    input,
    expectedCurrentFactId,
    applicability,
  );
  return recordNormalizedFactWithContributionInTransaction(
    input,
    applicability,
    context,
    payload,
    options,
  );
}

function recordNormalizedFactWithContributionInTransaction(
  input: RecordFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
  payload: MemoryFactContributionPayloadV1,
  options: RecordFactWithContributionOptions,
): {
  result: RecordFactResult;
  contributionId: string;
  contributionStatus: MemoryFactContributionWriteReceipt['status'];
} {
  const replay = loadVerifiedFactContributionReplay({ context, payload });
  const materializationInput = options.materializationInput ?? input;
  const materializationPayload =
    materializationInput === input
      ? payload
      : payload.operation.kind === 'exact_replacement'
        ? normalizeExactReplacementFactMutation(
            materializationInput,
            payload.operation.expectedCurrentFactId,
            applicability,
          )
        : normalizeRecordFactMutation(materializationInput, applicability);
  const recorded = recordNormalizedFactInTransaction(materializationPayload, true, replay?.factId);
  if (options.expectedStatus !== undefined && recorded.status !== options.expectedStatus) {
    throw new FactContributionMaterializationConflict();
  }
  const fact =
    options.sensitivityFloor === undefined
      ? recorded.fact
      : setFactSensitivityFloorInTransaction(recorded.fact.id, options.sensitivityFloor);
  const result: RecordFactResult = {
    ...recorded,
    fact,
    superseded: options.superseded ? [...options.superseded] : recorded.superseded,
  };
  const contribution = persistFactContributionInTransaction({
    fact: result.fact,
    payload,
    context,
    supersession: {
      superseded: result.superseded,
      pinnedInputExplicit: input.pinned !== undefined,
      reviewStateInputExplicit: input.reviewState !== undefined,
    },
  });
  return {
    result,
    contributionId: contribution.id,
    contributionStatus: contribution.status,
  };
}

function recordFactInTransaction(
  input: RecordFactInput,
  sealedApplicability?: SealedFactApplicabilityProvenance,
): RecordFactResult {
  return recordNormalizedFactInTransaction(
    normalizeRecordFactMutation(input, sealedApplicability),
    sealedApplicability !== undefined,
  );
}

function recordNormalizedFactInTransaction(
  payload: MemoryFactContributionPayloadV1,
  incomingIsSealed: boolean,
  expectedReplayFactId?: string,
): RecordFactResult {
  const db = getSchemaReadyMemoryDb();
  const input = payload.input;
  const provenance = payload.applicability;
  const {
    confidence,
    decayPolicy,
    decayRate,
    expiresAt,
    importance,
    memoryKind,
    now,
    objectText,
    predicate,
    retrievability,
    reviewState,
    scope,
    stability,
    validAt,
  } = input;
  const subject = db.getFirstSync<{ canonical_name: string; type: string }>(
    'SELECT canonical_name, type FROM memory_entities WHERE id = ? LIMIT 1',
    input.subjectId,
  );
  const sensitivity = classifyMemoryFactSensitivity({
    subject: subject?.canonical_name,
    subjectType: subject?.type,
    predicate,
    objectText,
    attributes: input.attributes,
    sourceSummary: input.sourceSummary,
    memoryKind,
  });
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const normalizedInput = {
    ...input,
    predicate,
    objectText,
    memoryOwnerId,
    personaId: provenance.personaId,
  };
  const hash = buildFactContentHash(normalizedInput);
  const existing = db
    .getAllSync<FactRow>(
      `SELECT * FROM memory_facts
       WHERE content_hash = ? AND memory_owner_id = ?
         AND invalid_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      hash,
      memoryOwnerId,
    )
    .find((row) =>
      hasExactFactContentIdentity(
        {
          memoryKind: row.memory_kind,
          scope: row.scope,
          originConversationId: row.origin_conversation_id,
          originThreadId: row.origin_thread_id,
          originTaskId: row.origin_task_id,
          memoryOwnerId: row.memory_owner_id,
          personaId: row.persona_id,
          subjectId: row.subject_id,
          predicate: row.predicate,
          objectText: row.object_text,
          objectEntityId: row.object_entity_id,
        },
        {
          ...normalizedInput,
          memoryKind,
          scope,
        },
      ),
    );
  if (expectedReplayFactId !== undefined && existing?.id !== expectedReplayFactId) {
    throw new Error('memory_fact_contribution_replay_target_changed');
  }
  if (existing) {
    const sourceTurnId = input.sourceTurnId?.trim();
    const sourceMessageId = input.sourceMessageId?.trim();
    const isSourceReplay =
      expectedReplayFactId !== undefined ||
      Boolean(
        (sourceTurnId && existing.source_turn_id === sourceTurnId) ||
        (sourceMessageId && hasPersistedSourceEvidence(existing.id, sourceMessageId)) ||
        (!sourceTurnId &&
          sourceMessageId &&
          !existing.source_turn_id &&
          existing.source_message_id === sourceMessageId),
      );
    const existingReviewState = closedMemoryFactReviewState(existing.review_state) ?? 'rejected';
    const existingSensitivity = closedMemoryFactSensitivity(existing.sensitivity) ?? 'restricted';
    const existingFactClass = closedMemoryFactClass(existing.fact_class) ?? 'unknown';
    const existingSourceAuthority =
      closedMemorySourceAuthority(existing.source_authority) ?? 'unknown';
    const nextReviewState = mergeDuplicateReviewState(existingReviewState, reviewState);
    const merged = { ...safeParseObject(existing.attributes), ...(input.attributes ?? {}) };
    const duplicateSensitivity = classifyMemoryFactSensitivity({
      subject: subject?.canonical_name,
      subjectType: subject?.type,
      predicate: existing.predicate,
      objectText: existing.object_text,
      attributes: merged,
      sourceSummary: [existing.source_summary, input.sourceSummary]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n'),
      memoryKind,
    });
    const nextSensitivity = mergeDuplicateSensitivity(existingSensitivity, duplicateSensitivity);
    const nextProvenance = mergeDuplicateProvenance({
      existingFactClass,
      existingSourceAuthority,
      incoming: provenance,
      incomingIsSealed,
    });
    const effectiveProjection = overlayFactExplicitProjectionInTransaction({
      factId: existing.id,
      derivedPinned: existing.pinned !== 0,
      derivedReviewState: nextReviewState,
      derivedSensitivity: nextSensitivity,
    });
    const metadataChanged =
      existing.pinned !== (effectiveProjection.pinned ? 1 : 0) ||
      effectiveProjection.reviewState !== existing.review_state ||
      effectiveProjection.sensitivity !== existing.sensitivity ||
      nextProvenance.factClass !== existing.fact_class ||
      nextProvenance.sourceAuthority !== existing.source_authority;
    if (isSourceReplay) {
      if (!metadataChanged) {
        return {
          fact: rowToFact(existing),
          status: 'duplicate',
          superseded: [],
        };
      }
      const repaired = db.runSync(
        `UPDATE memory_facts
            SET pinned = ?, review_state = ?, sensitivity = ?,
                fact_class = ?, source_authority = ?
          WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
        effectiveProjection.pinned ? 1 : 0,
        effectiveProjection.reviewState,
        effectiveProjection.sensitivity,
        nextProvenance.factClass,
        nextProvenance.sourceAuthority,
        existing.id,
      );
      if ((repaired.changes ?? 0) !== 1) {
        throw new Error('memory_fact_duplicate_projection_update_failed');
      }
      const fact = rowToFact({
        ...existing,
        pinned: effectiveProjection.pinned ? 1 : 0,
        review_state: effectiveProjection.reviewState,
        sensitivity: effectiveProjection.sensitivity,
        fact_class: nextProvenance.factClass,
        source_authority: nextProvenance.sourceAuthority,
      });
      runAfterMemoryTransactionCommit(() =>
        notifyStructuredMemoryChanged(existing.origin_conversation_id),
      );
      return { fact, status: 'duplicate', superseded: [] };
    }
    const reinforcementIncrement = 1;
    const lastReinforcedAt = now;
    const lastAccessedAt = now;
    const localSimilarity = createCurrentLocalSimilarityVector(
      buildFactLocalSimilarityText({
        predicate: existing.predicate,
        objectText: existing.object_text,
        sourceSummary: existing.source_summary,
      }),
    );
    const serializedLocalSimilarity = serializeCurrentLocalSimilarityVector(localSimilarity);
    db.runSync(
      `UPDATE memory_facts
         SET attributes = ?,
             updated_at = ?,
             confidence = MAX(confidence, ?),
             importance = MAX(importance, ?),
             retrievability = MAX(retrievability, ?),
             stability = MAX(stability, ?),
             decay_rate = MIN(decay_rate, ?),
             pinned = ?,
             review_state = ?,
             sensitivity = ?,
             fact_class = ?,
             source_authority = ?,
             memory_kind = ?,
             local_similarity_model = ?,
             local_similarity_dimensions = ?,
             local_similarity_vector = ?,
             local_similarity_updated_at = ?,
             repeated_mention_count = repeated_mention_count + ?,
             last_reinforced_at = ?,
             last_accessed_at = ?
         WHERE id = ?`,
      JSON.stringify(merged),
      now,
      confidence,
      importance,
      retrievability,
      stability,
      decayRate,
      effectiveProjection.pinned ? 1 : 0,
      effectiveProjection.reviewState,
      effectiveProjection.sensitivity,
      nextProvenance.factClass,
      nextProvenance.sourceAuthority,
      memoryKind,
      localSimilarity.model,
      localSimilarity.dimensions,
      serializedLocalSimilarity,
      now,
      reinforcementIncrement,
      lastReinforcedAt,
      lastAccessedAt,
      existing.id,
    );
    const fact = rowToFact({
      ...existing,
      attributes: JSON.stringify(merged),
      updated_at: now,
      confidence: Math.max(existing.confidence, confidence),
      importance: Math.max(existing.importance ?? 0.5, importance),
      retrievability: Math.max(existing.retrievability ?? 1, retrievability),
      stability: Math.max(existing.stability ?? 0.5, stability),
      decay_rate: Math.min(existing.decay_rate ?? 0.03, decayRate),
      pinned: effectiveProjection.pinned ? 1 : 0,
      review_state: effectiveProjection.reviewState,
      sensitivity: effectiveProjection.sensitivity,
      fact_class: nextProvenance.factClass,
      source_authority: nextProvenance.sourceAuthority,
      memory_kind: memoryKind,
      local_similarity_model: localSimilarity.model,
      local_similarity_dimensions: localSimilarity.dimensions,
      local_similarity_vector: serializedLocalSimilarity,
      local_similarity_updated_at: now,
      repeated_mention_count: (existing.repeated_mention_count ?? 0) + reinforcementIncrement,
      last_reinforced_at: lastReinforcedAt,
      last_accessed_at: lastAccessedAt,
    });
    replaceFactRetrievalTerms(fact);
    runAfterMemoryTransactionCommit(() =>
      notifyStructuredMemoryChanged(existing.origin_conversation_id),
    );
    return {
      fact,
      status: 'duplicate',
      superseded: [],
    };
  }

  const localSimilarity = createCurrentLocalSimilarityVector(
    buildFactLocalSimilarityText({
      predicate,
      objectText,
      sourceSummary: input.sourceSummary,
    }),
  );
  const serializedLocalSimilarity = serializeCurrentLocalSimilarityVector(localSimilarity);

  const superseded: MemoryFact[] = [];
  if (input.supersedePrior) {
    const query = buildSupersedePriorQuery(
      normalizedInput,
      scope,
      memoryOwnerId,
      provenance.personaId,
    );
    const priors = db
      .getAllSync<FactRow>(query.sql, ...query.params)
      .filter((prior) =>
        hasExactSupersessionScopeIdentity(
          prior,
          normalizedInput,
          scope,
          memoryOwnerId,
          provenance.personaId,
        ),
      );
    if (priors.length > MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES) {
      throw new Error('memory_fact_supersession_limit_exceeded');
    }
    for (const prior of priors) {
      db.runSync(
        `UPDATE memory_facts
           SET invalid_at = ?, updated_at = ?
           WHERE id = ?`,
        now,
        now,
        prior.id,
      );
      superseded.push(rowToFact({ ...prior, invalid_at: now, updated_at: now }));
    }
  }

  const id = newId('fact');
  const fact: MemoryFact = {
    id,
    subjectId: input.subjectId,
    predicate,
    objectText,
    objectEntityId: input.objectEntityId ?? null,
    attributes: input.attributes ?? {},
    confidence,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceRunId: input.sourceRunId ?? null,
    memoryOwnerId,
    personaId: provenance.personaId,
    factClass: provenance.factClass,
    sourceAuthority: provenance.sourceAuthority,
    scope,
    originConversationId: input.originConversationId ?? null,
    originThreadId: input.originThreadId ?? null,
    originTaskId: input.originTaskId ?? null,
    sourceTurnId: input.sourceTurnId ?? null,
    sourceSummary: input.sourceSummary ?? null,
    importance,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy,
    expiresAt,
    contentHash: hash,
    localSimilarity,
    validAt,
    invalidAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    pinned: input.pinned ?? false,
    sourceActorId: input.sourceActorId ?? null,
    retrievability,
    stability,
    decayRate,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState,
    sensitivity,
    memoryKind,
  };
  db.runSync(
    `INSERT INTO memory_facts
       (id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, memory_owner_id, persona_id,
        fact_class, source_authority, scope, origin_conversation_id,
        origin_thread_id, origin_task_id, source_turn_id, source_summary, importance,
        access_count, repeated_mention_count, last_recalled_at, last_reinforced_at,
        last_accessed_at, decay_policy, expires_at, content_hash, local_similarity_model,
        local_similarity_dimensions, local_similarity_vector, local_similarity_updated_at, valid_at,
        invalid_at, created_at, updated_at, deleted_at, pinned, source_actor_id,
        retrievability, stability, decay_rate, last_presented_at, last_confirmed_at,
        last_conflicted_at, review_state, sensitivity, sensitivity_policy_version, memory_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL,
        ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
    fact.id,
    fact.subjectId,
    fact.predicate,
    fact.objectText,
    fact.objectEntityId,
    JSON.stringify(fact.attributes),
    fact.confidence,
    fact.sourceMessageId,
    fact.sourceRunId,
    fact.memoryOwnerId,
    fact.personaId,
    fact.factClass,
    fact.sourceAuthority,
    fact.scope,
    fact.originConversationId,
    fact.originThreadId,
    fact.originTaskId,
    fact.sourceTurnId,
    fact.sourceSummary,
    fact.importance,
    fact.decayPolicy,
    fact.expiresAt,
    fact.contentHash,
    localSimilarity.model,
    localSimilarity.dimensions,
    serializedLocalSimilarity,
    now,
    fact.validAt,
    fact.createdAt,
    fact.updatedAt,
    fact.pinned ? 1 : 0,
    fact.sourceActorId,
    fact.retrievability,
    fact.stability,
    fact.decayRate,
    fact.reviewState,
    fact.sensitivity,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    fact.memoryKind,
  );
  replaceFactRetrievalTerms(fact);
  runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(fact.originConversationId));
  return { fact, status: 'created', superseded };
}
