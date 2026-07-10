import { requireMemoryFactScope, type ListFactsOptions } from './types';

export type SqlBindValue = string | number;

export interface FactFilter {
  clauses: string[];
  params: SqlBindValue[];
}

export interface RecallFactScopeIdentity {
  conversationId?: string;
  threadId?: string;
  taskId?: string;
}

function column(name: string, alias?: string): string {
  return alias ? `${alias}.${name}` : name;
}

function normalizedIdentityValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildRecallScopeFilter(identity: RecallFactScopeIdentity, alias?: string): FactFilter {
  const scopeColumn = column('scope', alias);
  const conversationColumn = column('origin_conversation_id', alias);
  const threadColumn = column('origin_thread_id', alias);
  const taskColumn = column('origin_task_id', alias);
  const conversationId = normalizedIdentityValue(identity.conversationId);
  const threadId = normalizedIdentityValue(identity.threadId);
  const taskId = normalizedIdentityValue(identity.taskId);
  // Persona remains identity-less in the RET04 schema. RET05 adds the owner and
  // persona columns needed to make that branch exact without inferring identity.
  const branches = [`${scopeColumn} = ?`, `${scopeColumn} = ?`];
  const params: SqlBindValue[] = ['global', 'persona'];

  if (conversationId) {
    branches.push(`(${scopeColumn} = ? AND ${conversationColumn} = ?)`);
    params.push('project', conversationId);
    branches.push(`(${scopeColumn} = ? AND ${conversationColumn} = ?)`);
    params.push('conversation', conversationId);
  }

  if (conversationId && taskId) {
    const clauses = [`${scopeColumn} = ?`, `${conversationColumn} = ?`, `${taskColumn} = ?`];
    const branchParams: SqlBindValue[] = ['session', conversationId, taskId];
    if (threadId) {
      clauses.push(`${threadColumn} = ?`);
      branchParams.push(threadId);
    }
    branches.push(`(${clauses.join(' AND ')})`);
    params.push(...branchParams);
  }

  return {
    clauses: [`(${branches.join(' OR ')})`],
    params,
  };
}

export function buildFactFilter(
  options: ListFactsOptions,
  alias?: string,
  recallScopeIdentity?: RecallFactScopeIdentity,
): FactFilter {
  const clauses: string[] = [];
  const params: SqlBindValue[] = [];
  if (options.subjectId) {
    clauses.push(`${column('subject_id', alias)} = ?`);
    params.push(options.subjectId);
  }
  if (options.predicate) {
    clauses.push(`${column('predicate', alias)} = ? COLLATE NOCASE`);
    params.push(options.predicate);
  }
  if (options.scope) {
    const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
    const normalizedScopes = scopes.map(requireMemoryFactScope);
    clauses.push(`${column('scope', alias)} IN (${normalizedScopes.map(() => '?').join(', ')})`);
    params.push(...normalizedScopes);
  }
  if (options.originConversationId) {
    clauses.push(`${column('origin_conversation_id', alias)} = ?`);
    params.push(options.originConversationId);
  }
  if (options.originTaskId) {
    clauses.push(`${column('origin_task_id', alias)} = ?`);
    params.push(options.originTaskId);
  }
  if (options.pinnedOnly) clauses.push(`${column('pinned', alias)} = 1`);
  if (options.memoryKind) {
    const kinds = Array.isArray(options.memoryKind) ? options.memoryKind : [options.memoryKind];
    clauses.push(`${column('memory_kind', alias)} IN (${kinds.map(() => '?').join(', ')})`);
    params.push(...kinds);
  }
  if (!options.includeDeleted) clauses.push(`${column('deleted_at', alias)} IS NULL`);
  if (!options.includeExpired) {
    const asOf = options.asOf ?? Date.now();
    clauses.push(`(${column('expires_at', alias)} IS NULL OR ${column('expires_at', alias)} > ?)`);
    params.push(asOf);
  }
  if (!options.includeInvalidated) {
    if (options.asOf !== undefined) {
      clauses.push(`${column('valid_at', alias)} <= ?`);
      params.push(options.asOf);
      clauses.push(
        `(${column('invalid_at', alias)} IS NULL OR ${column('invalid_at', alias)} > ?)`,
      );
      params.push(options.asOf);
    } else {
      clauses.push(`${column('invalid_at', alias)} IS NULL`);
    }
  }
  if (recallScopeIdentity) {
    const recallScope = buildRecallScopeFilter(recallScopeIdentity, alias);
    clauses.push(...recallScope.clauses);
    params.push(...recallScope.params);
  }
  return { clauses, params };
}

export function whereSql(filter: FactFilter): string {
  return filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : '';
}
