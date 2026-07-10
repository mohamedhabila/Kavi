import { getMany } from '../access/crud';
import type { SqlBindValue } from './queryFilter';
import {
  normalizeScope,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type MemoryFactScope,
} from './types';

export interface CurrentReplacementFactQuery {
  subjectId: string;
  predicate: string;
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
}

/**
 * Resolve only current facts in the exact namespace a replacement may mutate.
 * Two rows are sufficient: zero means no target, one is exact, and two means
 * the key is ambiguous and must be rejected.
 */
export function listCurrentFactsForReplacement(input: CurrentReplacementFactQuery): MemoryFact[] {
  const clauses = [
    'subject_id = ?',
    'predicate = ? COLLATE NOCASE',
    'scope = ?',
    'invalid_at IS NULL',
    'deleted_at IS NULL',
  ];
  const params: SqlBindValue[] = [input.subjectId, input.predicate, normalizeScope(input.scope)];

  if (input.scope === 'conversation') {
    clauses.push("COALESCE(origin_conversation_id, '') = ?");
    params.push(input.originConversationId?.trim() ?? '');
  } else if (input.scope !== 'global') {
    clauses.push("COALESCE(origin_conversation_id, '') = ?");
    params.push(input.originConversationId?.trim() ?? '');
    clauses.push("COALESCE(origin_thread_id, '') = ?");
    params.push(input.originThreadId?.trim() ?? input.originConversationId?.trim() ?? '');
    clauses.push("COALESCE(origin_task_id, '') = ?");
    params.push(input.originTaskId?.trim() ?? '');
  }

  return getMany<FactRow>(
    `SELECT * FROM memory_facts
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, id ASC
      LIMIT 2`,
    ...params,
  ).map(rowToFact);
}
