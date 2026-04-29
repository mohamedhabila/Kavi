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
    input.subjectId,
    input.predicate.toLowerCase(),
    input.objectText.trim().toLowerCase(),
    input.objectEntityId ?? null,
  ]);
  return fnv1aHash(payload);
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
         SET attributes = ?, updated_at = ?, confidence = MAX(confidence, ?)
         WHERE id = ?`,
      JSON.stringify(merged),
      now,
      input.confidence ?? existing.confidence,
      existing.id,
    );
    return {
      fact: rowToFact({ ...existing, attributes: JSON.stringify(merged), updated_at: now }),
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
           AND invalid_at IS NULL
           AND deleted_at IS NULL`,
      input.subjectId,
      input.predicate,
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
    confidence: input.confidence ?? 1.0,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceRunId: input.sourceRunId ?? null,
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
        confidence, source_message_id, source_run_id, content_hash, embedding,
        valid_at, invalid_at, created_at, updated_at, deleted_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?)`,
    fact.id,
    fact.subjectId,
    fact.predicate,
    fact.objectText,
    fact.objectEntityId,
    JSON.stringify(fact.attributes),
    fact.confidence,
    fact.sourceMessageId,
    fact.sourceRunId,
    fact.contentHash,
    fact.validAt,
    fact.createdAt,
    fact.updatedAt,
    fact.pinned ? 1 : 0,
  );
  return { fact, status: 'created', superseded };
}

export interface ListFactsOptions {
  subjectId?: string;
  predicate?: string;
  pinnedOnly?: boolean;
  includeInvalidated?: boolean;
  includeDeleted?: boolean;
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
  if (options.pinnedOnly) clauses.push('pinned = 1');
  if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
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
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToFact);
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
  return (result.changes ?? 0) > 0;
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
  return (result.changes ?? 0) > 0;
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
  return (result.changes ?? 0) > 0;
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
  return (result.changes ?? 0) > 0;
}
