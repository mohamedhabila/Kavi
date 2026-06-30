import { getMany } from '../access/crud';
import {
  normalizeScope,
  rowToFact,
  type FactRow,
  type ListFactsOptions,
  type MemoryFact,
} from './types';

type SqlBindValue = string | number;

const MAX_SOURCE_RUN_LEXICAL_LIMIT = 500;

interface SourceRunFilter {
  clauses: string[];
  params: SqlBindValue[];
}

function clampLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(value ?? fallback, MAX_SOURCE_RUN_LEXICAL_LIMIT));
}

function sourceRunFactFilter(options: ListFactsOptions): SourceRunFilter {
  const clauses: string[] = [];
  const params: SqlBindValue[] = [];
  if (options.scope) {
    const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
    const normalizedScopes = scopes.map(normalizeScope);
    clauses.push(`f.scope IN (${normalizedScopes.map(() => '?').join(', ')})`);
    params.push(...normalizedScopes);
  }
  if (options.originConversationId) {
    clauses.push('f.origin_conversation_id = ?');
    params.push(options.originConversationId);
  }
  if (options.originTaskId) {
    clauses.push('f.origin_task_id = ?');
    params.push(options.originTaskId);
  }
  if (options.memoryKind) {
    const kinds = Array.isArray(options.memoryKind) ? options.memoryKind : [options.memoryKind];
    clauses.push(`f.memory_kind IN (${kinds.map(() => '?').join(', ')})`);
    params.push(...kinds);
  }
  if (!options.includeDeleted) clauses.push('f.deleted_at IS NULL');
  if (!options.includeExpired) {
    params.push(options.asOf ?? Date.now());
    clauses.push('(f.expires_at IS NULL OR f.expires_at > ?)');
  }
  if (!options.includeInvalidated) {
    if (options.asOf !== undefined) {
      clauses.push('f.valid_at <= ?');
      clauses.push('(f.invalid_at IS NULL OR f.invalid_at > ?)');
      params.push(options.asOf, options.asOf);
    } else {
      clauses.push('f.invalid_at IS NULL');
    }
  }
  return { clauses, params };
}

function whereSql(filter: SourceRunFilter): string {
  return filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : '';
}

export function listFactsForSourceRunLexicalMatches(
  sourceRunIds: ReadonlyArray<string>,
  queryUnits: ReadonlyArray<string>,
  options: Pick<
    ListFactsOptions,
    | 'memoryKind'
    | 'scope'
    | 'originConversationId'
    | 'originTaskId'
    | 'includeDeleted'
    | 'includeExpired'
    | 'includeInvalidated'
    | 'asOf'
  > & {
    limit?: number;
    factsPerSourceRun?: number;
  } = {},
): MemoryFact[] {
  const uniqueSourceRunIds = Array.from(
    new Set(sourceRunIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  const uniqueQueryUnits = Array.from(
    new Set(queryUnits.map((unit) => unit.trim()).filter((unit) => unit.length > 0)),
  );
  if (uniqueSourceRunIds.length === 0 || uniqueQueryUnits.length === 0) return [];
  const filter = sourceRunFactFilter(options);
  const limit = clampLimit(options.limit, uniqueSourceRunIds.length * 4);
  const factsPerSourceRun = Math.max(1, Math.min(options.factsPerSourceRun ?? limit, 16));
  const stateExpr = "CAST(json_extract(f.attributes, '$.stateIndex') AS REAL)";
  const rows = getMany<FactRow>(
    `WITH matched AS (
       SELECT f.*,
              SUM(t.weight) AS source_match_weight,
              COUNT(DISTINCT t.unit) AS source_unit_count,
              ${stateExpr} AS source_state_index
         FROM memory_fact_terms AS t INDEXED BY idx_fact_terms_source_unit_fact
         JOIN memory_facts f ON f.id = t.fact_id
        ${whereSql({
          clauses: [
            `t.source_run_id IN (${uniqueSourceRunIds.map(() => '?').join(', ')})`,
            `t.unit IN (${uniqueQueryUnits.map(() => '?').join(', ')})`,
            ...filter.clauses,
          ],
          params: [...uniqueSourceRunIds, ...uniqueQueryUnits, ...filter.params],
        })}
        GROUP BY f.id
     ),
     ranked AS (
       SELECT matched.*,
              ROW_NUMBER() OVER (
                PARTITION BY matched.source_run_id
                ORDER BY matched.source_match_weight DESC,
                         matched.source_unit_count DESC,
                         matched.source_state_index DESC,
                         matched.retrievability DESC,
                         matched.importance DESC,
                         matched.updated_at DESC
              ) AS source_rank
         FROM matched
     )
     SELECT *
       FROM ranked
      WHERE source_rank <= ?
      ORDER BY source_match_weight DESC,
               source_unit_count DESC,
               source_state_index DESC,
               retrievability DESC,
               importance DESC,
               updated_at DESC
      LIMIT ${limit}`,
    ...uniqueSourceRunIds,
    ...uniqueQueryUnits,
    ...filter.params,
    factsPerSourceRun,
  );
  return rows.map(rowToFact);
}
