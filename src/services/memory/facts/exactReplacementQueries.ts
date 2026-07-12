import { getMany } from '../access/crud';
import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isExactMemoryScopeId, requireExactMemoryScopeId } from '../memoryScopeIdentity';
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
export const PRIOR_USER_SELF_CORRECTION_SCAN_LIMIT = 32;

interface ExactReplacementScopeQuery {
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  personaId?: string | null;
}

export interface CurrentReplacementFactQuery extends ExactReplacementScopeQuery {
  subjectId: string;
  predicate: string;
}

export interface PriorUserSelfCorrectionFactQuery extends ExactReplacementScopeQuery {
  subjectId: string;
  sourceMessageId: string;
}

function appendScopeIdentity(
  clauses: string[],
  params: SqlBindValue[],
  input: ExactReplacementScopeQuery,
  scope: MemoryFactScope,
): void {
  if (scope === 'global') {
    clauses.push(
      'persona_id IS NULL',
      'origin_conversation_id IS NULL',
      'origin_thread_id IS NULL',
      'origin_task_id IS NULL',
    );
    return;
  }
  if (scope === 'persona') {
    if (!isExactMemoryScopeId(input.personaId)) {
      throw new Error('memory_fact_persona_id_required');
    }
    clauses.push(
      'persona_id = ?',
      'origin_conversation_id IS NULL',
      'origin_thread_id IS NULL',
      'origin_task_id IS NULL',
    );
    params.push(input.personaId);
    return;
  }

  clauses.push('persona_id IS NULL', 'origin_conversation_id = ?');
  params.push(
    requireExactMemoryScopeId(
      input.originConversationId,
      'memory_fact_origin_conversation_id_required',
    ),
  );
  if (scope === 'conversation' || scope === 'project') {
    clauses.push('origin_task_id IS NULL');
    return;
  }
  clauses.push('origin_thread_id = ?', 'origin_task_id = ?');
  params.push(
    requireExactMemoryScopeId(input.originThreadId, 'memory_fact_origin_thread_id_required'),
    requireExactMemoryScopeId(input.originTaskId, 'memory_fact_origin_task_id_required'),
  );
}

function hasUsableConversationThread(row: FactRow, scope: MemoryFactScope): boolean {
  return (
    (scope !== 'conversation' && scope !== 'project') ||
    row.origin_thread_id === null ||
    isExactMemoryScopeId(row.origin_thread_id)
  );
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
  appendScopeIdentity(clauses, params, input, scope);

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
    .filter((row) => hasUsableConversationThread(row, scope))
    .slice(0, 2)
    .map(rowToFact);
}

/**
 * Resolve current grounded self facts written from the immediately preceding
 * code-owned user message. This intentionally omits the model-proposed
 * predicate: an anaphoric correction may reuse the one unambiguous persisted
 * predicate, but it may never pick an older or differently scoped fact.
 */
export function listCurrentFactsForPriorUserSelfCorrection(
  input: PriorUserSelfCorrectionFactQuery,
): MemoryFact[] {
  const scope = requireMemoryFactScope(input.scope);
  requireFactScopeIdentity(input, scope);
  const sourceMessageId = input.sourceMessageId.trim();
  if (!sourceMessageId) throw new Error('memory_fact_source_message_id_required');
  const memoryOwnerId = getLocalMemoryVaultOwnerId(getSchemaReadyMemoryDb());
  const clauses = [
    'subject_id = ?',
    'source_message_id = ?',
    'memory_owner_id = ?',
    'scope = ?',
    "fact_class = 'subjective_user'",
    "source_authority = 'grounded_user'",
    'invalid_at IS NULL',
    'deleted_at IS NULL',
  ];
  const params: SqlBindValue[] = [input.subjectId, sourceMessageId, memoryOwnerId, scope];
  appendScopeIdentity(clauses, params, input, scope);

  const rows = getMany<FactRow>(
    `SELECT * FROM memory_facts
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC, id ASC
      LIMIT ${PRIOR_USER_SELF_CORRECTION_SCAN_LIMIT + 1}`,
    ...params,
  );
  if (rows.length > PRIOR_USER_SELF_CORRECTION_SCAN_LIMIT) {
    throw new Error('memory_prior_user_correction_scan_saturated');
  }
  return rows.filter((row) => hasUsableConversationThread(row, scope)).map(rowToFact);
}
