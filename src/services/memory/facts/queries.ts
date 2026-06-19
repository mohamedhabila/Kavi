import { countRows, getMany, getOne } from '../access/crud';
import {
  normalizeScope,
  rowToFact,
  type FactRow,
  type ListFactsOptions,
  type MemoryFact,
  type MemoryFactScope,
} from './types';

export function listFacts(options: ListFactsOptions = {}): MemoryFact[] {
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
  const rows = getMany<FactRow>(
    `SELECT * FROM memory_facts ${where}
       ORDER BY pinned DESC, importance DESC, updated_at DESC
       LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToFact);
}

export function countFacts(
  options: { pinnedOnly?: boolean; scope?: MemoryFactScope } = {},
): number {
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (options.pinnedOnly) clauses.push('pinned = 1');
  if (options.scope) {
    clauses.push('scope = ?');
    params.push(options.scope);
  }
  const where = clauses.join(' AND ');
  return countRows(`SELECT COUNT(*) as count FROM memory_facts WHERE ${where}`, ...params);
}

export function getFactById(id: string): MemoryFact | null {
  const row = getOne<FactRow>(`SELECT * FROM memory_facts WHERE id = ? LIMIT 1`, id);
  return row ? rowToFact(row) : null;
}
