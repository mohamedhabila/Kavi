import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryStatement } from '../access/crud';
import { newId, safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../store';
import { runMemoryTransaction } from '../access/transaction';
import { deleteFactRetrievalTerms, replaceFactRetrievalTerms } from './retrievalIndex';
import { buildFactContentHash } from './contentIdentity';
import {
  clamp01,
  normalizeDecayPolicy,
  normalizeFactKind,
  normalizeScope,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type RecordFactInput,
  type RecordFactResult,
  type ReplaceCurrentFactConflict,
  type ReplaceCurrentFactInput,
  type ReplaceCurrentFactResult,
} from './types';

type MemorySqlBindValue = string | number | null;

function buildSupersedePriorQuery(
  input: RecordFactInput,
  scope: ReturnType<typeof normalizeScope>,
): { sql: string; params: MemorySqlBindValue[] } {
  const clauses = [
    'subject_id = ?',
    'predicate = ? COLLATE NOCASE',
    'invalid_at IS NULL',
    'deleted_at IS NULL',
  ];
  const params: MemorySqlBindValue[] = [input.subjectId, input.predicate];

  if (scope === 'session') {
    clauses.push('scope = ?');
    params.push(scope);
    clauses.push("COALESCE(origin_conversation_id, '') = COALESCE(?, '')");
    params.push(input.originConversationId ?? null);
    clauses.push("COALESCE(origin_thread_id, '') = COALESCE(?, '')");
    params.push(input.originThreadId ?? input.originConversationId ?? null);
    clauses.push("COALESCE(origin_task_id, '') = COALESCE(?, '')");
    params.push(input.originTaskId ?? null);
  } else {
    clauses.push("scope != 'session'");
    if ((scope === 'conversation' || scope === 'project') && input.originConversationId) {
      clauses.push(
        "(scope NOT IN ('conversation', 'project') OR COALESCE(origin_conversation_id, '') = COALESCE(?, '') OR origin_conversation_id IS NULL)",
      );
      params.push(input.originConversationId);
    }
  }

  return {
    sql: `SELECT * FROM memory_facts WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

/**
 * Record (or dedupe) a fact. When `supersedePrior` is true any currently-valid
 * fact with the same (subject_id, predicate) is invalidated at `now` first.
 * Durable non-session scopes supersede each other because providers may choose
 * different scopes for the same current-state update across long conversations.
 * Session facts remain isolated by conversation/thread/task.
 * Idempotent on `content_hash` for active rows.
 */
export function recordFact(input: RecordFactInput): RecordFactResult {
  return runMemoryTransaction(() => recordFactInTransaction(input));
}

function recordFactInTransaction(input: RecordFactInput): RecordFactResult {
  const db = getSchemaReadyMemoryDb();
  const now = input.now ?? Date.now();
  if (!input.subjectId) throw new Error('recordFact: subjectId required');
  const predicate = input.predicate.trim();
  const objectText = input.objectText.trim();
  if (!predicate) throw new Error('recordFact: predicate required');
  if (!objectText) throw new Error('recordFact: objectText required');

  const normalizedInput = { ...input, predicate, objectText };
  const hash = buildFactContentHash(normalizedInput);
  const scope = normalizeScope(input.scope);
  const confidence = clamp01(input.confidence ?? 1.0);
  const importance = clamp01(input.importance ?? 0.5);
  const retrievability = clamp01(input.retrievability ?? 1);
  const stability = clamp01(input.stability ?? 0.5);
  const decayRate = Math.max(0, input.decayRate ?? 0.03);
  const decayPolicy = normalizeDecayPolicy(input.decayPolicy);
  const memoryKind = normalizeFactKind(input.memoryKind);
  const reviewState = input.reviewState?.trim() || 'auto';
  const sensitivity = input.sensitivity?.trim() || 'normal';

  const existing = db.getFirstSync<FactRow>(
    `SELECT * FROM memory_facts
       WHERE content_hash = ? AND invalid_at IS NULL AND deleted_at IS NULL
       LIMIT 1`,
    hash,
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
    if (isSourceReplay) {
      return {
        fact: rowToFact(existing),
        status: 'duplicate',
        superseded: [],
      };
    }
    const merged = { ...safeParseObject(existing.attributes), ...(input.attributes ?? {}) };
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
             memory_kind = ?,
             repeated_mention_count = repeated_mention_count + 1,
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
      reviewState,
      sensitivity,
      memoryKind,
      now,
      now,
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
      review_state: reviewState,
      sensitivity,
      memory_kind: memoryKind,
      repeated_mention_count: (existing.repeated_mention_count ?? 0) + 1,
      last_reinforced_at: now,
      last_accessed_at: now,
    });
    replaceFactRetrievalTerms(fact);
    notifyStructuredMemoryChanged(existing.origin_conversation_id);
    return {
      fact,
      status: 'duplicate',
      superseded: [],
    };
  }

  const superseded: MemoryFact[] = [];
  if (input.supersedePrior) {
    const query = buildSupersedePriorQuery(normalizedInput, scope);
    const priors = db.getAllSync<FactRow>(query.sql, ...query.params);
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
    scope,
    originConversationId: input.originConversationId ?? null,
    originThreadId: input.originThreadId ?? input.originConversationId ?? null,
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
    expiresAt: input.expiresAt ?? null,
    contentHash: hash,
    embedding: null,
    validAt: input.validAt ?? now,
    invalidAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    pinned: input.pinned ?? false,
    sourceActorId: input.sourceActorId ?? null,
    taskId: input.taskId ?? input.originTaskId ?? null,
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
        confidence, source_message_id, source_run_id, scope, origin_conversation_id,
        origin_thread_id, origin_task_id, source_turn_id, source_summary, importance,
        access_count, repeated_mention_count, last_recalled_at, last_reinforced_at,
        last_accessed_at, decay_policy, expires_at, content_hash, embedding, valid_at,
        invalid_at, created_at, updated_at, deleted_at, pinned, source_actor_id, task_id,
        retrievability, stability, decay_rate, last_presented_at, last_confirmed_at,
        last_conflicted_at, review_state, sensitivity, memory_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL,
        ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    fact.id,
    fact.subjectId,
    fact.predicate,
    fact.objectText,
    fact.objectEntityId,
    JSON.stringify(fact.attributes),
    fact.confidence,
    fact.sourceMessageId,
    fact.sourceRunId,
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
    fact.validAt,
    fact.createdAt,
    fact.updatedAt,
    fact.pinned ? 1 : 0,
    fact.sourceActorId,
    fact.taskId,
    fact.retrievability,
    fact.stability,
    fact.decayRate,
    fact.reviewState,
    fact.sensitivity,
    fact.memoryKind,
  );
  replaceFactRetrievalTerms(fact);
  notifyStructuredMemoryChanged(fact.originConversationId);
  return { fact, status: 'created', superseded };
}

class ExactReplacementConflict extends Error {
  constructor(readonly code: ReplaceCurrentFactConflict) {
    super(code);
  }
}

function nullableId(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function replacementScopeMatches(row: FactRow, input: ReplaceCurrentFactInput): boolean {
  const scope = normalizeScope(input.scope);
  if (normalizeScope(row.scope) !== scope) return false;
  if (scope === 'global') return true;

  const conversationId = nullableId(input.originConversationId);
  if (scope === 'conversation') {
    return nullableId(row.origin_conversation_id) === conversationId;
  }
  const threadId = nullableId(input.originThreadId ?? input.originConversationId);
  const taskId = nullableId(input.originTaskId);
  return (
    nullableId(row.origin_conversation_id) === conversationId &&
    nullableId(row.origin_thread_id) === threadId &&
    nullableId(row.origin_task_id) === taskId
  );
}

function hasPersistedSourceEvidence(
  factId: string,
  sourceMessageId: string | null | undefined,
): boolean {
  const messageId = sourceMessageId?.trim();
  if (!messageId) return false;
  const db = getSchemaReadyMemoryDb();
  return Boolean(
    db.getFirstSync<{ present: number }>(
      `SELECT 1 AS present
         FROM memory_fact_evidence
        WHERE fact_id = ? AND message_id = ?
        LIMIT 1`,
      factId,
      messageId,
    ),
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
  db.runSync(
    `UPDATE memory_facts
       SET attributes = ?, updated_at = ?, confidence = MAX(confidence, ?),
           importance = MAX(importance, ?), retrievability = MAX(retrievability, ?),
           stability = MAX(stability, ?), decay_rate = MIN(decay_rate, ?),
           repeated_mention_count = repeated_mention_count + 1,
           last_reinforced_at = ?, last_accessed_at = ?
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
  });
  replaceFactRetrievalTerms(fact);
  notifyStructuredMemoryChanged(row.origin_conversation_id);
  return fact;
}

/**
 * Atomically replace one exact current fact. The expected target is rechecked
 * inside the write transaction; a changed or incompatible target is never
 * broadened into an insert or subject/predicate-wide invalidation.
 */
export function replaceCurrentFact(input: ReplaceCurrentFactInput): ReplaceCurrentFactResult {
  const expectedCurrentFactId = input.expectedCurrentFactId.trim();
  if (!expectedCurrentFactId) {
    return { fact: null, status: 'conflict', superseded: [], conflict: 'target_missing' };
  }
  const predicate = input.predicate.trim();
  const objectText = input.objectText.trim();
  if (!input.subjectId) throw new Error('replaceCurrentFact: subjectId required');
  if (!predicate) throw new Error('replaceCurrentFact: predicate required');
  if (!objectText) throw new Error('replaceCurrentFact: objectText required');
  const now = input.now ?? Date.now();

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
      if (
        current.subject_id !== input.subjectId ||
        current.predicate.trim().toLowerCase() !== predicate.toLowerCase()
      ) {
        throw new ExactReplacementConflict('target_changed');
      }
      if (!replacementScopeMatches(current, input)) {
        throw new ExactReplacementConflict('target_scope_mismatch');
      }

      if (current.object_text.normalize('NFKC').trim() === objectText.normalize('NFKC')) {
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

      const created = recordFact({
        ...input,
        predicate,
        objectText,
        pinned: input.pinned ?? current.pinned !== 0,
        sensitivity: input.sensitivity ?? current.sensitivity ?? 'normal',
        reviewState: input.reviewState ?? current.review_state ?? 'auto',
        memoryKind: input.memoryKind ?? normalizeFactKind(current.memory_kind),
        supersedePrior: false,
        now,
      });
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

export function markFactsRecalled(ids: string[], now = Date.now()): number {
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
    notifyStructuredMemoryChanged();
  }
  return changed;
}

export function softDeleteFact(id: string, now = Date.now()): boolean {
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    now,
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) {
    deleteFactRetrievalTerms(id);
    notifyStructuredMemoryChanged();
  }
  return changed;
}

export function setFactPinned(id: string, pinned: boolean, now = Date.now()): boolean {
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET pinned = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    pinned ? 1 : 0,
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) notifyStructuredMemoryChanged();
  return changed;
}

/**
 * Persist an embedding vector for a fact. The vector is stored as a JSON
 * array in the `embedding` TEXT column. Used by the query-time recall
 * pipeline (see `factRecall.ts`) and by the consolidator backfill pass.
 * Returns true if a row was updated.
 */
export function setFactEmbedding(
  id: string,
  embedding: number[] | null,
  now = Date.now(),
): boolean {
  const serialized = embedding && embedding.length > 0 ? JSON.stringify(embedding) : null;
  const result = runMemoryStatement(
    `UPDATE memory_facts
       SET embedding = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    serialized,
    now,
    id,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) notifyStructuredMemoryChanged();
  return changed;
}
