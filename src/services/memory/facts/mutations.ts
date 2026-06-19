import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryStatement } from '../access/crud';
import { fnv1aHash, newId, safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../store';
import {
  clamp01,
  normalizeDecayPolicy,
  normalizeScope,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type RecordFactInput,
  type RecordFactResult,
} from './types';

function factContentHash(input: RecordFactInput): string {
  const payload = JSON.stringify([
    normalizeScope(input.scope),
    input.originConversationId ?? null,
    input.originTaskId ?? null,
    input.subjectId,
    input.predicate.toLowerCase(),
    input.objectText.trim().toLowerCase(),
    input.objectEntityId ?? null,
  ]);
  return fnv1aHash(payload);
}

type MemorySqlBindValue = string | number | null;

function buildSupersedePriorQuery(
  input: RecordFactInput,
  scope: ReturnType<typeof normalizeScope>,
): { sql: string; params: MemorySqlBindValue[] } {
  const clauses = [
    'subject_id = ?',
    'predicate = ?',
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
  const db = getSchemaReadyMemoryDb();
  const now = input.now ?? Date.now();
  if (!input.subjectId) throw new Error('recordFact: subjectId required');
  if (!input.predicate) throw new Error('recordFact: predicate required');
  if (!input.objectText) throw new Error('recordFact: objectText required');

  const hash = factContentHash(input);
  const scope = normalizeScope(input.scope);
  const confidence = clamp01(input.confidence ?? 1.0);
  const importance = clamp01(input.importance ?? 0.5);
  const decayPolicy = normalizeDecayPolicy(input.decayPolicy);

  const existing = db.getFirstSync<FactRow>(
    `SELECT * FROM memory_facts
       WHERE content_hash = ?
         AND deleted_at IS NULL
         AND invalid_at IS NULL
       LIMIT 1`,
    hash,
  );
  if (existing) {
    const merged = { ...safeParseObject(existing.attributes), ...(input.attributes ?? {}) };
    db.runSync(
      `UPDATE memory_facts
         SET attributes = ?,
             updated_at = ?,
             confidence = MAX(confidence, ?),
             importance = MAX(importance, ?),
             repeated_mention_count = repeated_mention_count + 1,
             last_reinforced_at = ?,
             last_accessed_at = ?
         WHERE id = ?`,
      JSON.stringify(merged),
      now,
      confidence,
      importance,
      now,
      now,
      existing.id,
    );
    notifyStructuredMemoryChanged(existing.origin_conversation_id);
    return {
      fact: rowToFact({
        ...existing,
        attributes: JSON.stringify(merged),
        updated_at: now,
        confidence: Math.max(existing.confidence, confidence),
        importance: Math.max(existing.importance ?? 0.5, importance),
        repeated_mention_count: (existing.repeated_mention_count ?? 0) + 1,
        last_reinforced_at: now,
        last_accessed_at: now,
      }),
      status: 'duplicate',
      superseded: [],
    };
  }

  const superseded: MemoryFact[] = [];
  if (input.supersedePrior) {
    const query = buildSupersedePriorQuery(input, scope);
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
    predicate: input.predicate,
    objectText: input.objectText,
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
    sourceActorId: null,
    taskId: input.originTaskId ?? null,
    retrievability: 1,
    stability: 0.5,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'semantic',
  };
  db.runSync(
    `INSERT INTO memory_facts
       (id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, scope, origin_conversation_id,
        origin_thread_id, origin_task_id, source_turn_id, source_summary, importance,
        access_count, repeated_mention_count, last_recalled_at, last_reinforced_at,
        last_accessed_at, decay_policy, expires_at, content_hash, embedding, valid_at,
        invalid_at, created_at, updated_at, deleted_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL,
        ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?)`,
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
  );
  notifyStructuredMemoryChanged(fact.originConversationId);
  return { fact, status: 'created', superseded };
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
  if (changed) notifyStructuredMemoryChanged();
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
  if (changed) notifyStructuredMemoryChanged();
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
