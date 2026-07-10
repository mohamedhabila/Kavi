import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runMemoryTransaction } from '../access/transaction';
import { safeParseObject } from '../schema';
import { notifyStructuredMemoryChanged } from '../store';
import { recordFact } from './mutations';
import { replaceFactRetrievalTerms } from './retrievalIndex';
import { hasPersistedSourceEvidence } from './sourceEvidence';
import {
  clamp01,
  normalizeFactKind,
  normalizeScope,
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
