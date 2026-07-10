import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryStatement } from '../access/crud';
import { newId, safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../store';
import { runAfterMemoryTransactionCommit, runMemoryTransaction } from '../access/transaction';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import { replaceFactRetrievalTerms } from './retrievalIndex';
import { buildFactContentHash, hasExactFactContentIdentity } from './contentIdentity';
import {
  mergeDuplicateProvenance,
  mergeDuplicateReviewState,
  mergeDuplicateSensitivity,
} from './duplicateMetadata';
import { requireFactMutationScope, requireFactMutationTimestamp } from './mutationValidation';
import { requireFactScopeIdentity } from './scopeIdentity';
import { hasPersistedSourceEvidence } from './sourceEvidence';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
  requireCurrentLocalSimilarityVector,
  type LocalSimilarityVector,
} from '../localSimilarity';
import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
  requireMemoryFactReviewState,
  requireMemoryFactSensitivity,
  resolveFactApplicabilityProvenance,
  type SealedFactApplicabilityProvenance,
} from './applicabilityProvenance';
import {
  clamp01,
  normalizeDecayPolicy,
  normalizeFactKind,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type RecordFactInput,
  type RecordFactResult,
} from './types';

type MemorySqlBindValue = string | number | null;

function buildSupersedePriorQuery(
  input: RecordFactInput,
  scope: NonNullable<RecordFactInput['scope']>,
  memoryOwnerId: string,
  personaId: string | null,
): { sql: string; params: MemorySqlBindValue[] } {
  const clauses = [
    'subject_id = ?',
    'predicate = ? COLLATE NOCASE',
    'invalid_at IS NULL',
    'deleted_at IS NULL',
    'memory_owner_id = ?',
  ];
  const params: MemorySqlBindValue[] = [input.subjectId, input.predicate, memoryOwnerId];

  clauses.push('scope = ?');
  params.push(scope);

  if (scope === 'global') {
    clauses.push('persona_id IS NULL');
    clauses.push('origin_conversation_id IS NULL');
    clauses.push('origin_thread_id IS NULL');
    clauses.push('origin_task_id IS NULL');
  } else if (scope === 'persona') {
    clauses.push('persona_id = ?');
    params.push(personaId);
    clauses.push('origin_conversation_id IS NULL');
    clauses.push('origin_thread_id IS NULL');
    clauses.push('origin_task_id IS NULL');
  } else if (scope === 'session') {
    clauses.push('persona_id IS NULL');
    clauses.push('origin_conversation_id = ?');
    params.push(input.originConversationId!);
    clauses.push('origin_thread_id = ?');
    params.push(input.originThreadId!);
    clauses.push('origin_task_id = ?');
    params.push(input.originTaskId!);
  } else if (scope === 'conversation' || scope === 'project') {
    clauses.push('persona_id IS NULL');
    clauses.push('origin_conversation_id = ?');
    params.push(input.originConversationId!);
    clauses.push('origin_task_id IS NULL');
  }

  return {
    sql: `SELECT * FROM memory_facts WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

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

function recordFactInTransaction(
  input: RecordFactInput,
  sealedApplicability?: SealedFactApplicabilityProvenance,
): RecordFactResult {
  const db = getSchemaReadyMemoryDb();
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
  const confidence = clamp01(input.confidence ?? 1.0);
  const importance = clamp01(input.importance ?? 0.5);
  const retrievability = clamp01(input.retrievability ?? 1);
  const stability = clamp01(input.stability ?? 0.5);
  const decayRate = Math.max(0, input.decayRate ?? 0.03);
  const decayPolicy = normalizeDecayPolicy(input.decayPolicy);
  const memoryKind = normalizeFactKind(input.memoryKind);
  const reviewState = requireMemoryFactReviewState(input.reviewState ?? 'auto');
  const sensitivity = requireMemoryFactSensitivity(input.sensitivity ?? 'normal');
  const provenance = resolveFactApplicabilityProvenance({
    scope,
    memoryKind,
    ...(sealedApplicability ? { sealed: sealedApplicability } : {}),
  });
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const localSimilarity = createCurrentLocalSimilarityVector(
    buildFactLocalSimilarityText({
      predicate,
      objectText,
      sourceSummary: input.sourceSummary,
    }),
  );
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
  if (existing) {
    const sourceTurnId = input.sourceTurnId?.trim();
    const sourceMessageId = input.sourceMessageId?.trim();
    const isSourceReplay = Boolean(
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
    const nextSensitivity = mergeDuplicateSensitivity(existingSensitivity, sensitivity);
    const nextProvenance = mergeDuplicateProvenance({
      existingFactClass,
      existingSourceAuthority,
      incoming: provenance,
      incomingIsSealed: sealedApplicability !== undefined,
    });
    const metadataChanged =
      nextReviewState !== existingReviewState ||
      nextSensitivity !== existingSensitivity ||
      nextProvenance.factClass !== existingFactClass ||
      nextProvenance.sourceAuthority !== existingSourceAuthority;
    if (isSourceReplay && !metadataChanged) {
      return {
        fact: rowToFact(existing),
        status: 'duplicate',
        superseded: [],
      };
    }
    const merged = { ...safeParseObject(existing.attributes), ...(input.attributes ?? {}) };
    const reinforcementIncrement = isSourceReplay ? 0 : 1;
    const lastReinforcedAt = isSourceReplay ? existing.last_reinforced_at : now;
    const lastAccessedAt = isSourceReplay ? existing.last_accessed_at : now;
    db.runSync(
      `UPDATE memory_facts
         SET attributes = ?,
             updated_at = ?,
             confidence = MAX(confidence, ?),
             importance = MAX(importance, ?),
             retrievability = MAX(retrievability, ?),
             stability = MAX(stability, ?),
             decay_rate = MIN(decay_rate, ?),
             review_state = ?,
             sensitivity = ?,
             fact_class = ?,
             source_authority = ?,
             memory_kind = ?,
             local_similarity_model = ?,
             local_similarity_dimensions = ?,
             local_similarity_vector = ?,
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
      nextReviewState,
      nextSensitivity,
      nextProvenance.factClass,
      nextProvenance.sourceAuthority,
      memoryKind,
      localSimilarity.model,
      localSimilarity.dimensions,
      JSON.stringify(localSimilarity.values),
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
      review_state: nextReviewState,
      sensitivity: nextSensitivity,
      fact_class: nextProvenance.factClass,
      source_authority: nextProvenance.sourceAuthority,
      memory_kind: memoryKind,
      local_similarity_model: localSimilarity.model,
      local_similarity_dimensions: localSimilarity.dimensions,
      local_similarity_vector: JSON.stringify(localSimilarity.values),
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
        local_similarity_dimensions, local_similarity_vector, valid_at,
        invalid_at, created_at, updated_at, deleted_at, pinned, source_actor_id,
        retrievability, stability, decay_rate, last_presented_at, last_confirmed_at,
        last_conflicted_at, review_state, sensitivity, memory_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL,
        ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
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
    JSON.stringify(localSimilarity.values),
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
    fact.memoryKind,
  );
  replaceFactRetrievalTerms(fact);
  runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(fact.originConversationId));
  return { fact, status: 'created', superseded };
}

export function markFactsRecalled(ids: string[], now = Date.now()): number {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  getSchemaReadyMemoryDb();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET access_count = access_count + 1,
           last_recalled_at = ?,
           last_accessed_at = ?,
           updated_at = ?
       WHERE id IN (${uniqueIds.map(() => '?').join(', ')})
         AND deleted_at IS NULL`,
    now,
    now,
    now,
    ...uniqueIds,
  );
  return result.changes ?? 0;
}

export function invalidateFact(id: string, now = Date.now()): boolean {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET invalid_at = ?, updated_at = ?
       WHERE id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
    now,
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) {
    runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
  }
  return changed;
}

export function setFactPinned(id: string, pinned: boolean, now = Date.now()): boolean {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET pinned = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    pinned ? 1 : 0,
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
  return changed;
}

/**
 * Persist one current, validated local-similarity vector for a fact.
 */
export function setFactLocalSimilarity(
  id: string,
  localSimilarity: LocalSimilarityVector,
  now = Date.now(),
): boolean {
  requireFactMutationTimestamp(now, 'memory_fact_mutation_clock_invalid');
  const validated = requireCurrentLocalSimilarityVector(localSimilarity);
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET local_similarity_model = ?,
           local_similarity_dimensions = ?,
           local_similarity_vector = ?,
           updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    validated.model,
    validated.dimensions,
    JSON.stringify(validated.values),
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged());
  return changed;
}
