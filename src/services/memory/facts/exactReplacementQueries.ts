import { getMany } from '../access/crud';
import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import type { SqlBindValue } from './queryFilter';
import { requireFactScopeIdentity } from './scopeIdentity';
import {
  requireMemoryFactScope,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type MemoryFactScope,
} from './types';

export const MEMORY_FACT_REPLACEMENT_SCAN_LIMIT = 512;

export interface CurrentReplacementFactQuery {
  subjectId: string;
  predicate: string;
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  personaId?: string | null;
}

/**
 * Resolve only current facts in the exact namespace a replacement may mutate.
 * Two rows are sufficient: zero means no target, one is exact, and two means
 * the key is ambiguous and must be rejected.
 */
export function listCurrentFactsForReplacement(input: CurrentReplacementFactQuery): MemoryFact[] {
  const scope = requireMemoryFactScope(input.scope);
  requireFactScopeIdentity(input, scope);
  const memoryOwnerId = getLocalMemoryVaultOwnerId(getSchemaReadyMemoryDb());
  const clauses = [
    'subject_id = ?',
    'predicate = ? COLLATE NOCASE',
    'memory_owner_id = ?',
    'scope = ?',
    'invalid_at IS NULL',
    'deleted_at IS NULL',
  ];
  const params: SqlBindValue[] = [input.subjectId, input.predicate, memoryOwnerId, scope];

  if (scope === 'global') {
    clauses.push('persona_id IS NULL');
    clauses.push('origin_conversation_id IS NULL');
    clauses.push('origin_thread_id IS NULL');
    clauses.push('origin_task_id IS NULL');
  } else if (scope === 'persona') {
    if (!isExactMemoryScopeId(input.personaId)) {
      throw new Error('memory_fact_persona_id_required');
    }
    clauses.push('persona_id = ?');
    params.push(input.personaId);
    clauses.push('origin_conversation_id IS NULL');
    clauses.push('origin_thread_id IS NULL');
    clauses.push('origin_task_id IS NULL');
  } else {
    if (!isExactMemoryScopeId(input.originConversationId)) {
      throw new Error('memory_fact_origin_conversation_id_required');
    }
    clauses.push('persona_id IS NULL');
    clauses.push('origin_conversation_id = ?');
    params.push(input.originConversationId);
    if (scope === 'conversation' || scope === 'project') {
      clauses.push('origin_task_id IS NULL');
    } else {
      if (!isExactMemoryScopeId(input.originThreadId)) {
        throw new Error('memory_fact_origin_thread_id_required');
      }
      if (!isExactMemoryScopeId(input.originTaskId)) {
        throw new Error('memory_fact_origin_task_id_required');
      }
      clauses.push('origin_thread_id = ?');
      params.push(input.originThreadId);
      clauses.push('origin_task_id = ?');
      params.push(input.originTaskId);
    }
  }

  const rows = getMany<FactRow>(
    `SELECT * FROM memory_facts
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, id ASC
      LIMIT ${MEMORY_FACT_REPLACEMENT_SCAN_LIMIT + 1}`,
    ...params,
  );
  if (rows.length > MEMORY_FACT_REPLACEMENT_SCAN_LIMIT) {
    throw new Error('memory_fact_replacement_scan_saturated');
  }
  return rows
    .filter(
      (row) =>
        (scope !== 'conversation' && scope !== 'project') ||
        row.origin_thread_id === null ||
        isExactMemoryScopeId(row.origin_thread_id),
    )
    .slice(0, 2)
    .map(rowToFact);
}
