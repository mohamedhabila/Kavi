import { isMemoryFactScope, type ListFactsOptions } from './types';
import {
  requireMemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import type { MemoryApplicabilityUseIntent } from '../memoryApplicabilityTypes';
import type { FactRecallCandidateLane } from '../factRecallAccessPolicy';

export type SqlBindValue = string | number;

export interface FactFilter {
  clauses: string[];
  params: SqlBindValue[];
}

export interface RecallFactScopeIdentity extends RequiredMemoryAccessScopeIdentity {
  useIntent: MemoryApplicabilityUseIntent;
  candidateLane: FactRecallCandidateLane;
}

function column(name: string, alias?: string): string {
  return alias ? `${alias}.${name}` : name;
}

function buildRecallScopeFilter(
  identity: RecallFactScopeIdentity,
  asOf: number,
  alias?: string,
): FactFilter {
  const scope = requireMemoryAccessScopeIdentity(identity);
  if (identity.useIntent !== 'automatic_prompt' && identity.useIntent !== 'explicit_user_request') {
    throw new Error('memory_recall_access_intent_invalid');
  }
  if (identity.candidateLane !== 'direct_use' && identity.candidateLane !== 'resolution') {
    throw new Error('memory_recall_candidate_lane_invalid');
  }
  if (!Number.isSafeInteger(asOf) || asOf < 0) {
    throw new Error('memory_recall_access_timestamp_invalid');
  }
  const scopeColumn = column('scope', alias);
  const ownerColumn = column('memory_owner_id', alias);
  const personaColumn = column('persona_id', alias);
  const conversationColumn = column('origin_conversation_id', alias);
  const threadColumn = column('origin_thread_id', alias);
  const taskColumn = column('origin_task_id', alias);
  const reviewColumn = column('review_state', alias);
  const sensitivityColumn = column('sensitivity', alias);
  const factClassColumn = column('fact_class', alias);
  const authorityColumn = column('source_authority', alias);
  const createdColumn = column('created_at', alias);
  const validColumn = column('valid_at', alias);
  const invalidColumn = column('invalid_at', alias);
  const expiresColumn = column('expires_at', alias);
  const deletedColumn = column('deleted_at', alias);
  const directAuthorityClause = `(
    (${factClassColumn} = 'subjective_user' AND ${authorityColumn} = 'grounded_user')
    OR (${factClassColumn} = 'objective' AND ${authorityColumn} IN ('grounded_user', 'tool_observed', 'external_source'))
    OR (${factClassColumn} = 'workflow' AND (
      ${authorityColumn} IN ('grounded_user', 'tool_observed', 'external_source')
      OR (${authorityColumn} = 'assistant_inferred' AND ${reviewColumn} = 'verified')
    ))
  )`;
  const resolutionAuthorityClause = `(
    (${factClassColumn} = 'subjective_user' AND ${authorityColumn} = 'assistant_inferred')
    OR (${factClassColumn} = 'objective' AND ${authorityColumn} = 'assistant_inferred')
    OR (${factClassColumn} = 'workflow' AND ${authorityColumn} = 'assistant_inferred' AND ${reviewColumn} <> 'verified')
  )`;
  const branches = [
    `(${scopeColumn} = ? AND ${personaColumn} IS NULL AND ${conversationColumn} IS NULL AND ${threadColumn} IS NULL AND ${taskColumn} IS NULL)`,
    `(${scopeColumn} = ? AND ${personaColumn} = ? AND ${conversationColumn} IS NULL AND ${threadColumn} IS NULL AND ${taskColumn} IS NULL)`,
    `(${scopeColumn} = ? AND ${personaColumn} IS NULL AND ${conversationColumn} = ? AND ${taskColumn} IS NULL)`,
    `(${scopeColumn} = ? AND ${personaColumn} IS NULL AND ${conversationColumn} = ? AND ${taskColumn} IS NULL)`,
  ];
  const branchParams: SqlBindValue[] = [
    'global',
    'persona',
    scope.personaId,
    'project',
    scope.memoryConversationId,
    'conversation',
    scope.memoryConversationId,
  ];
  if (scope.taskId !== null) {
    branches.push(
      `(${scopeColumn} = ? AND ${personaColumn} IS NULL AND ${conversationColumn} = ? AND ${threadColumn} = ? AND ${taskColumn} = ?)`,
    );
    branchParams.push('session', scope.memoryConversationId, scope.sourceThreadId, scope.taskId);
  }

  return {
    clauses: [
      `${ownerColumn} = ?`,
      `(${branches.join(' OR ')})`,
      `${factClassColumn} IN ('subjective_user', 'objective', 'workflow')`,
      identity.candidateLane === 'direct_use' ? directAuthorityClause : resolutionAuthorityClause,
      `${reviewColumn} IN ('auto', 'verified', 'pending_review', 'stale', 'conflicted')`,
      identity.useIntent === 'explicit_user_request'
        ? `${sensitivityColumn} IN ('normal', 'personal', 'sensitive')`
        : `${sensitivityColumn} IN ('normal', 'personal')`,
      `TYPEOF(${createdColumn}) = 'integer' AND ${createdColumn} >= 0 AND ${createdColumn} <= ?`,
      `TYPEOF(${validColumn}) = 'integer' AND ${validColumn} >= 0 AND ${validColumn} <= ?`,
      `(${invalidColumn} IS NULL OR (TYPEOF(${invalidColumn}) = 'integer' AND ${invalidColumn} > ? AND ${invalidColumn} <= ${Number.MAX_SAFE_INTEGER}))`,
      `(${expiresColumn} IS NULL OR (TYPEOF(${expiresColumn}) = 'integer' AND ${expiresColumn} > ? AND ${expiresColumn} <= ${Number.MAX_SAFE_INTEGER}))`,
      `${deletedColumn} IS NULL`,
    ],
    params: [scope.memoryOwnerId, ...branchParams, asOf, asOf, asOf, asOf],
  };
}

export function buildFactFilter(
  options: ListFactsOptions,
  alias?: string,
  recallScopeIdentity?: RecallFactScopeIdentity,
): FactFilter {
  if (options.asOf !== undefined && (!Number.isSafeInteger(options.asOf) || options.asOf < 0)) {
    throw new Error('memory_fact_query_timestamp_invalid');
  }
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
    if (scopes.length === 0 || !scopes.every(isMemoryFactScope)) {
      throw new Error('memory_fact_query_scope_invalid');
    }
    clauses.push(`${column('scope', alias)} IN (${scopes.map(() => '?').join(', ')})`);
    params.push(...scopes);
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
    if (options.asOf === undefined) {
      throw new Error('memory_recall_access_timestamp_required');
    }
    const recallScope = buildRecallScopeFilter(recallScopeIdentity, options.asOf, alias);
    clauses.push(...recallScope.clauses);
    params.push(...recallScope.params);
  }
  return { clauses, params };
}

export function whereSql(filter: FactFilter): string {
  return filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : '';
}
