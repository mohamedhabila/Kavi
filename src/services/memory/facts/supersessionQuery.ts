import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import type { FactRow, RecordFactInput } from './types';

type MemorySqlBindValue = string | number | null;

/**
 * Whether `fact` is an exact-scope-identity match for a supersession
 * candidate under `input`/`scope` — a write can never invalidate facts from
 * another scope, persona, root, thread, or task.
 */
export function hasExactSupersessionScopeIdentity(
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

export function buildSupersedePriorQuery(
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
