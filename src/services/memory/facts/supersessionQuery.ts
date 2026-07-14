import type { RecordFactInput } from './types';

type MemorySqlBindValue = string | number | null;

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
