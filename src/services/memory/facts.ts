// ---------------------------------------------------------------------------
// Kavi — Bi-temporal fact store (Graphiti-inspired)
// ---------------------------------------------------------------------------
// Each fact carries `valid_at` (when the assertion became true in the user's
// reality) and `invalid_at` (when it stopped being true; NULL while currently
// valid). Supersession never mutates the prior row — we record a new row and
// stamp `invalid_at` on the prior one. `deleted_at` is for soft-delete UX.
// ---------------------------------------------------------------------------

import { getMemoryDb } from './sqlite-store';
import {
  ensureFactSchema,
  fnv1aHash,
  newId,
  safeParseArray,
  safeParseObject,
} from './schema';
import { notifyStructuredMemoryChanged } from './store';

export type MemoryFactScope = 'global' | 'project' | 'conversation' | 'session' | 'persona';

export type MemoryDecayPolicy = 'normal' | 'slow' | 'fast' | 'pinned' | 'ephemeral';

export interface MemoryFact {
  id: string;
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceTurnId: string | null;
  sourceSummary: string | null;
  importance: number;
  accessCount: number;
  repeatedMentionCount: number;
  lastRecalledAt: number | null;
  lastReinforcedAt: number | null;
  lastAccessedAt: number | null;
  decayPolicy: MemoryDecayPolicy;
  expiresAt: number | null;
  contentHash: string;
  embedding: number[] | null;
  validAt: number;
  invalidAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  pinned: boolean;
}

interface FactRow {
  id: string;
  subject_id: string;
  predicate: string;
  object_text: string;
  object_entity_id: string | null;
  attributes: string;
  confidence: number;
  source_message_id: string | null;
  source_run_id: string | null;
  scope: string;
  origin_conversation_id: string | null;
  origin_thread_id: string | null;
  origin_task_id: string | null;
  source_turn_id: string | null;
  source_summary: string | null;
  importance: number;
  access_count: number;
  repeated_mention_count: number;
  last_recalled_at: number | null;
  last_reinforced_at: number | null;
  last_accessed_at: number | null;
  decay_policy: string;
  expires_at: number | null;
  content_hash: string;
  embedding: string | null;
  valid_at: number;
  invalid_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  pinned: number;
}

function rowToFact(row: FactRow): MemoryFact {
  return {
    id: row.id,
    subjectId: row.subject_id,
    predicate: row.predicate,
    objectText: row.object_text,
    objectEntityId: row.object_entity_id,
    attributes: safeParseObject(row.attributes),
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    sourceRunId: row.source_run_id,
    scope: normalizeScope(row.scope),
    originConversationId: row.origin_conversation_id,
    originThreadId: row.origin_thread_id,
    originTaskId: row.origin_task_id,
    sourceTurnId: row.source_turn_id,
    sourceSummary: row.source_summary,
    importance: clamp01(row.importance ?? 0.5),
    accessCount: Math.max(0, row.access_count ?? 0),
    repeatedMentionCount: Math.max(0, row.repeated_mention_count ?? 0),
    lastRecalledAt: row.last_recalled_at,
    lastReinforcedAt: row.last_reinforced_at,
    lastAccessedAt: row.last_accessed_at,
    decayPolicy: normalizeDecayPolicy(row.decay_policy),
    expiresAt: row.expires_at,
    contentHash: row.content_hash,
    embedding: row.embedding ? safeParseArray<number>(row.embedding) : null,
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    pinned: row.pinned !== 0,
  };
}

export interface RecordFactInput {
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId?: string | null;
  attributes?: Record<string, unknown>;
  confidence?: number;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
  scope?: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  sourceTurnId?: string | null;
  sourceSummary?: string | null;
  importance?: number;
  decayPolicy?: MemoryDecayPolicy;
  expiresAt?: number | null;
  validAt?: number;
  pinned?: boolean;
  /** When true, any existing currently-valid fact for (subject, predicate) is invalidated. */
  supersedePrior?: boolean;
  now?: number;
}

export interface RecordFactResult {
  fact: MemoryFact;
  status: 'created' | 'duplicate';
  superseded: MemoryFact[];
}

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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

export function normalizeScope(value: unknown): MemoryFactScope {
  return value === 'project' ||
    value === 'conversation' ||
    value === 'session' ||
    value === 'persona'
    ? value
    : 'global';
}

function normalizeDecayPolicy(value: unknown): MemoryDecayPolicy {
  return value === 'slow' || value === 'fast' || value === 'pinned' || value === 'ephemeral'
    ? value
    : 'normal';
}

/**
 * Record (or dedupe) a fact. When `supersedePrior` is true any currently-valid
 * fact with the same (subject_id, predicate) is invalidated at `now` first.
 * Idempotent on `content_hash` for active rows.
 */
export function recordFact(input: RecordFactInput): RecordFactResult {
  ensureFactSchema();
  const db = getMemoryDb();
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
    const priors = db.getAllSync<FactRow>(
      `SELECT * FROM memory_facts
         WHERE subject_id = ?
           AND predicate = ?
           AND scope = ?
           AND COALESCE(origin_conversation_id, '') = COALESCE(?, '')
           AND COALESCE(origin_thread_id, '') = COALESCE(?, '')
           AND COALESCE(origin_task_id, '') = COALESCE(?, '')
           AND invalid_at IS NULL
           AND deleted_at IS NULL`,
      input.subjectId,
      input.predicate,
      scope,
      input.originConversationId ?? null,
      input.originThreadId ?? input.originConversationId ?? null,
      input.originTaskId ?? null,
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

export interface ListFactsOptions {
  subjectId?: string;
  predicate?: string;
  scope?: MemoryFactScope | MemoryFactScope[];
  originConversationId?: string;
  originTaskId?: string;
  pinnedOnly?: boolean;
  includeInvalidated?: boolean;
  includeDeleted?: boolean;
  includeExpired?: boolean;
  limit?: number;
  /** Only return facts valid at this timestamp. Defaults to "currently valid". */
  asOf?: number;
}

export function listFacts(options: ListFactsOptions = {}): MemoryFact[] {
  ensureFactSchema();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (options.subjectId) {
    clauses.push('subject_id = ?');
    params.push(options.subjectId);
  }
  if (options.predicate) {
    clauses.push('predicate = ?');
    params.push(options.predicate);
  }
  if (options.scope) {
    const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
    const normalizedScopes = scopes.map(normalizeScope);
    clauses.push(`scope IN (${normalizedScopes.map(() => '?').join(', ')})`);
    params.push(...normalizedScopes);
  }
  if (options.originConversationId) {
    clauses.push('origin_conversation_id = ?');
    params.push(options.originConversationId);
  }
  if (options.originTaskId) {
    clauses.push('origin_task_id = ?');
    params.push(options.originTaskId);
  }
  if (options.pinnedOnly) clauses.push('pinned = 1');
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
  if (!options.includeExpired) {
    const asOf = options.asOf ?? Date.now();
    clauses.push('(expires_at IS NULL OR expires_at > ?)');
    params.push(asOf);
  }
  if (!options.includeInvalidated) {
    if (options.asOf !== undefined) {
      clauses.push('valid_at <= ?');
      params.push(options.asOf);
      clauses.push('(invalid_at IS NULL OR invalid_at > ?)');
      params.push(options.asOf);
    } else {
      clauses.push('invalid_at IS NULL');
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = getMemoryDb().getAllSync<FactRow>(
    `SELECT * FROM memory_facts ${where}
       ORDER BY pinned DESC, importance DESC, updated_at DESC
       LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToFact);
}

export function markFactsRecalled(ids: string[], now = Date.now()): number {
  ensureFactSchema();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;
  const result = getMemoryDb().runSync(
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

export function getFactById(id: string): MemoryFact | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<FactRow>(
    `SELECT * FROM memory_facts WHERE id = ? LIMIT 1`,
    id,
  );
  return row ? rowToFact(row) : null;
}

export function invalidateFact(id: string, now = Date.now()): boolean {
  ensureFactSchema();
  const result = getMemoryDb().runSync(
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
  ensureFactSchema();
  const result = getMemoryDb().runSync(
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
  ensureFactSchema();
  const result = getMemoryDb().runSync(
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
  ensureFactSchema();
  const serialized = embedding && embedding.length > 0 ? JSON.stringify(embedding) : null;
  const result = getMemoryDb().runSync(
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
