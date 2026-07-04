import { countRows, getMany, getOne } from '../access/crud';
import {
  normalizeScope,
  rowToFact,
  type FactRow,
  type ListFactsOptions,
  type MemoryFact,
  type MemoryFactKind,
  type MemoryFactScope,
} from './types';

type SqlBindValue = string | number;

const DEFAULT_FACT_LIMIT = 100;
const MAX_FACT_LIMIT = 500;
const DEFAULT_RECALL_CANDIDATE_LIMIT = 128;
const MAX_RECALL_CANDIDATE_LIMIT = 2_000;
const DEFAULT_RECALL_PINNED_LIMIT = 64;
const DEFAULT_RECALL_SCOPED_RECENT_LIMIT = 192;

interface FactFilter {
  clauses: string[];
  params: SqlBindValue[];
}

function column(name: string, alias?: string): string {
  return alias ? `${alias}.${name}` : name;
}

function buildFactFilter(options: ListFactsOptions, alias?: string): FactFilter {
  const clauses: string[] = [];
  const params: SqlBindValue[] = [];
  if (options.subjectId) {
    clauses.push(`${column('subject_id', alias)} = ?`);
    params.push(options.subjectId);
  }
  if (options.predicate) {
    clauses.push(`${column('predicate', alias)} = ?`);
    params.push(options.predicate);
  }
  if (options.scope) {
    const scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
    const normalizedScopes = scopes.map(normalizeScope);
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
  return { clauses, params };
}

function whereSql(filter: FactFilter): string {
  return filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : '';
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(value ?? fallback, max));
}

export function listFacts(options: ListFactsOptions = {}): MemoryFact[] {
  const filter = buildFactFilter(options);
  const limit = clampLimit(options.limit, DEFAULT_FACT_LIMIT, MAX_FACT_LIMIT);
  const rows = getMany<FactRow>(
    `SELECT * FROM memory_facts ${whereSql(filter)}
       ORDER BY pinned DESC, importance DESC, updated_at DESC
       LIMIT ${limit}`,
    ...filter.params,
  );
  return rows.map(rowToFact);
}

export interface ListFactsForRecallCandidatesOptions extends ListFactsOptions {
  lexicalUnits?: string[];
  selectedLexicalUnits?: string[];
  anchorLexicalUnitSets?: ReadonlyArray<ReadonlyArray<string>>;
  scopedRecentConversationId?: string;
  scopedRecentTaskId?: string;
  pinnedLimit?: number;
  scopedRecentLimit?: number;
  includeUnanchoredCandidates?: boolean;
}

export function listFactsForRecallCandidates(
  options: ListFactsForRecallCandidatesOptions = {},
): MemoryFact[] {
  const totalLimit = clampLimit(
    options.limit,
    DEFAULT_RECALL_CANDIDATE_LIMIT,
    MAX_RECALL_CANDIDATE_LIMIT,
  );
  const filter = buildFactFilter(options);
  const byId = new Map<string, MemoryFact>();

  function addRows(
    extraClauses: string[],
    extraParams: SqlBindValue[],
    orderBy: string,
    limit: number,
  ): void {
    if (byId.size >= totalLimit) return;
    const laneLimit = Math.max(1, Math.min(limit, totalLimit - byId.size));
    const laneFilter = {
      clauses: [...filter.clauses, ...extraClauses],
      params: [...filter.params, ...extraParams],
    };
    const rows = getMany<FactRow>(
      `SELECT * FROM memory_facts ${whereSql(laneFilter)}
         ORDER BY ${orderBy}
         LIMIT ${laneLimit}`,
      ...laneFilter.params,
    );
    for (const row of rows) {
      if (byId.size >= totalLimit) break;
      byId.set(row.id, rowToFact(row));
    }
  }

  function addIndexedLexicalRows(
    units: string[],
    limit: number,
    memoryKinds?: ReadonlyArray<MemoryFactKind>,
  ): void {
    if (byId.size >= totalLimit || units.length === 0) return;
    const laneLimit = Math.max(1, Math.min(limit, totalLimit - byId.size));
    const factFilter = buildFactFilter(options, 'f');
    const termClauses = [`t.unit IN (${units.map(() => '?').join(', ')})`];
    const params: SqlBindValue[] = [...units];
    const requestedKinds = memoryKinds ?? options.memoryKind;
    if (requestedKinds) {
      const kinds = Array.isArray(requestedKinds) ? requestedKinds : [requestedKinds];
      termClauses.push(`t.memory_kind IN (${kinds.map(() => '?').join(', ')})`);
      params.push(...kinds);
    }
    const where = whereSql({
      clauses: [...termClauses, ...factFilter.clauses],
      params: [...params, ...factFilter.params],
    });
    const rows = getMany<FactRow>(
      `SELECT f.*
         FROM memory_fact_terms AS t INDEXED BY idx_fact_terms_unit_kind_fact
         JOIN memory_facts f ON f.id = t.fact_id
         ${where}
        GROUP BY f.id
        ORDER BY SUM(t.weight) DESC,
                 COUNT(*) DESC,
                 f.pinned DESC,
                 f.retrievability DESC,
                 f.importance DESC,
                 f.updated_at DESC
        LIMIT ${laneLimit}`,
      ...params,
      ...factFilter.params,
    );
    for (const row of rows) {
      if (byId.size >= totalLimit) break;
      byId.set(row.id, rowToFact(row));
    }
  }

  function addAnchorLexicalRows(anchorUnitSets: ReadonlyArray<ReadonlyArray<string>>): void {
    if (byId.size >= totalLimit || anchorUnitSets.length === 0) return;
    const factFilter = buildFactFilter(options, 'f');
    for (const anchorUnits of anchorUnitSets) {
      if (byId.size >= totalLimit) break;
      const units = Array.from(
        new Set(anchorUnits.map((unit) => unit.trim()).filter((unit) => unit.length > 0)),
      );
      if (units.length === 0) continue;
      const laneLimit = Math.max(1, Math.min(24, totalLimit - byId.size));
      const params: SqlBindValue[] = [...units, ...factFilter.params, units.length];
      const rows = getMany<FactRow>(
        `SELECT f.*
           FROM memory_fact_terms AS t INDEXED BY idx_fact_terms_unit_kind_fact
           JOIN memory_facts f ON f.id = t.fact_id
           ${whereSql({
             clauses: [`t.unit IN (${units.map(() => '?').join(', ')})`, ...factFilter.clauses],
             params: [...units, ...factFilter.params],
           })}
          GROUP BY f.id
         HAVING COUNT(DISTINCT t.unit) = ?
          ORDER BY f.pinned DESC,
                   f.retrievability DESC,
                   f.importance DESC,
                   f.updated_at DESC
          LIMIT ${laneLimit}`,
        ...params,
      );
      for (const row of rows) {
        if (byId.size >= totalLimit) break;
        byId.set(row.id, rowToFact(row));
      }
    }
  }

  addRows(
    ['pinned = 1'],
    [],
    'pinned DESC, retrievability DESC, importance DESC, updated_at DESC',
    clampLimit(options.pinnedLimit, DEFAULT_RECALL_PINNED_LIMIT, totalLimit),
  );

  const lexicalUnits = Array.from(
    new Set(
      (options.selectedLexicalUnits?.length
        ? options.selectedLexicalUnits
        : (options.lexicalUnits ?? [])
      )
        .map((unit) => unit.trim())
        .filter(Boolean),
    ),
  );
  addAnchorLexicalRows(options.anchorLexicalUnitSets ?? []);
  if (lexicalUnits.length > 0) {
    addIndexedLexicalRows(lexicalUnits, totalLimit);
  }

  const scopedClauses: string[] = [];
  const scopedParams: SqlBindValue[] = [];
  if (options.scopedRecentConversationId) {
    scopedClauses.push('origin_conversation_id = ?');
    scopedParams.push(options.scopedRecentConversationId);
  }
  if (options.scopedRecentTaskId) {
    scopedClauses.push('origin_task_id = ?');
    scopedParams.push(options.scopedRecentTaskId);
  }
  if (scopedClauses.length > 0) {
    addRows(
      [`(${scopedClauses.join(' OR ')})`],
      scopedParams,
      'updated_at DESC, importance DESC',
      clampLimit(options.scopedRecentLimit, DEFAULT_RECALL_SCOPED_RECENT_LIMIT, totalLimit),
    );
  }

  if (options.includeUnanchoredCandidates || lexicalUnits.length === 0) {
    addRows(
      [],
      [],
      'pinned DESC, retrievability DESC, importance DESC, updated_at DESC',
      totalLimit,
    );
  }

  return Array.from(byId.values());
}

export function listFactTermUnitHitsForFacts(
  factIds: ReadonlyArray<string>,
  queryUnits: ReadonlyArray<string>,
): Map<string, Set<string>> {
  const uniqueFactIds = Array.from(
    new Set(factIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  const uniqueQueryUnits = Array.from(
    new Set(queryUnits.map((unit) => unit.trim()).filter((unit) => unit.length > 0)),
  );
  const hits = new Map<string, Set<string>>();
  if (uniqueFactIds.length === 0 || uniqueQueryUnits.length === 0) return hits;
  const rows = getMany<{ fact_id: string; unit: string }>(
    `SELECT fact_id, unit
       FROM memory_fact_terms INDEXED BY idx_fact_terms_fact
      WHERE fact_id IN (${uniqueFactIds.map(() => '?').join(', ')})
        AND unit IN (${uniqueQueryUnits.map(() => '?').join(', ')})`,
    ...uniqueFactIds,
    ...uniqueQueryUnits,
  );
  for (const row of rows) {
    const units = hits.get(row.fact_id) ?? new Set<string>();
    units.add(row.unit);
    hits.set(row.fact_id, units);
  }
  return hits;
}

export interface FactTermUnitStat {
  unit: string;
  factCount: number;
  totalWeight: number;
}

export function listFactTermStatsForUnits(
  units: ReadonlyArray<string>,
): Map<string, FactTermUnitStat> {
  const uniqueUnits = Array.from(
    new Set(units.map((unit) => unit.trim()).filter((unit) => unit.length > 0)),
  );
  const stats = new Map<string, FactTermUnitStat>();
  if (uniqueUnits.length === 0) return stats;
  const rows = getMany<{ unit: string; fact_count: number; total_weight: number }>(
    `SELECT unit,
            SUM(fact_count) AS fact_count,
            SUM(total_weight) AS total_weight
       FROM memory_fact_term_stats
      WHERE unit IN (${uniqueUnits.map(() => '?').join(', ')})
      GROUP BY unit`,
    ...uniqueUnits,
  );
  for (const row of rows) {
    stats.set(row.unit, {
      unit: row.unit,
      factCount: row.fact_count,
      totalWeight: row.total_weight,
    });
  }
  return stats;
}

export function listFactsForSourceRuns(
  sourceRunIds: ReadonlyArray<string>,
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
  } = {},
): MemoryFact[] {
  const uniqueSourceRunIds = Array.from(
    new Set(sourceRunIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  if (uniqueSourceRunIds.length === 0) return [];
  const filter = buildFactFilter(options);
  const limit = clampLimit(options.limit, uniqueSourceRunIds.length, MAX_FACT_LIMIT);
  const rows = getMany<FactRow>(
    `SELECT * FROM memory_facts
      ${whereSql({
        clauses: [
          `source_run_id IN (${uniqueSourceRunIds.map(() => '?').join(', ')})`,
          ...filter.clauses,
        ],
        params: [...uniqueSourceRunIds, ...filter.params],
      })}
      ORDER BY source_run_id,
               CAST(json_extract(attributes, '$.stateIndex') AS INTEGER) DESC,
               retrievability DESC,
               importance DESC,
               updated_at DESC
      LIMIT ${limit}`,
    ...uniqueSourceRunIds,
    ...filter.params,
  );
  return rows.map(rowToFact);
}

export interface SourceRunStateNeighborhoodContext {
  sourceRunId?: string | null;
  stateIndex?: string | number | null;
}

function stateIndexToNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function listFactsForSourceRunForwardWindows(
  contexts: ReadonlyArray<SourceRunStateNeighborhoodContext>,
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
    forwardRadius?: number;
    includeAnchorState?: boolean;
    limit?: number;
    factsPerStateKind?: number;
    stateLimit?: number;
  } = {},
): MemoryFact[] {
  const normalizedContexts = contexts
    .map((context) => ({
      sourceRunId:
        typeof context.sourceRunId === 'string' && context.sourceRunId.trim()
          ? context.sourceRunId.trim()
          : null,
      stateIndex: stateIndexToNumber(context.stateIndex),
    }))
    .filter(
      (context): context is { sourceRunId: string; stateIndex: number } =>
        Boolean(context.sourceRunId) && context.stateIndex !== null,
    );
  if (normalizedContexts.length === 0) return [];

  const byKey = new Map<string, { sourceRunId: string; stateIndex: number }>();
  for (const context of normalizedContexts) {
    byKey.set(`${context.sourceRunId}:${context.stateIndex}`, context);
  }

  const uniqueContexts = Array.from(byKey.values());
  const forwardRadius = Math.max(1, Math.min(Math.floor(options.forwardRadius ?? 16), 64));
  const stateLimit = Math.max(1, Math.min(Math.floor(options.stateLimit ?? 16), 32));
  const factsPerStateKind = Math.max(1, Math.min(Math.floor(options.factsPerStateKind ?? 1), 8));
  const limit = clampLimit(options.limit, uniqueContexts.length * stateLimit, MAX_FACT_LIMIT);
  const filter = buildFactFilter(options, 'f');
  const stateExpr = "CAST(json_extract(f.attributes, '$.stateIndex') AS REAL)";
  const lowerBoundOperator = options.includeAnchorState ? '>=' : '>';
  const byId = new Map<string, MemoryFact>();

  for (const context of uniqueContexts) {
    if (byId.size >= limit) break;
    const rows = getMany<FactRow>(
      `SELECT *
         FROM (
           SELECT f.*,
	                  ${stateExpr} AS state_index_rank,
	                  CASE
	                    WHEN f.memory_kind = 'outcome' THEN 0
	                    WHEN f.memory_kind = 'procedure' THEN 1
	                    WHEN f.memory_kind = 'decision' THEN 2
	                    WHEN f.memory_kind = 'risk' THEN 3
	                    WHEN f.memory_kind = 'artifact' THEN 4
	                    WHEN f.memory_kind = 'source' THEN 5
	                    ELSE 6
	                  END AS memory_kind_rank,
                  ROW_NUMBER() OVER (
                    PARTITION BY ${stateExpr}, f.memory_kind
                    ORDER BY f.retrievability DESC,
                             f.importance DESC,
                             f.updated_at DESC
                  ) AS state_kind_rank
             FROM memory_facts AS f
             ${whereSql({
               clauses: [
                 'f.source_run_id = ?',
                 `${stateExpr} ${lowerBoundOperator} ?`,
                 `${stateExpr} <= ?`,
                 ...filter.clauses,
               ],
               params: [
                 context.sourceRunId,
                 context.stateIndex,
                 context.stateIndex + forwardRadius,
                 ...filter.params,
               ],
             })}
         )
        WHERE state_kind_rank <= ${factsPerStateKind}
        ORDER BY state_index_rank ASC, memory_kind_rank ASC
        LIMIT ${Math.min(stateLimit, limit - byId.size)}`,
      context.sourceRunId,
      context.stateIndex,
      context.stateIndex + forwardRadius,
      ...filter.params,
    );
    for (const row of rows) {
      byId.set(row.id, rowToFact(row));
      if (byId.size >= limit) break;
    }
  }

  return Array.from(byId.values());
}

export function listFactsForSourceRunStateNeighborhoods(
  contexts: ReadonlyArray<SourceRunStateNeighborhoodContext>,
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
    preferAdjacent?: boolean;
    radius?: number;
  } = {},
): MemoryFact[] {
  const normalizedContexts = contexts
    .map((context) => ({
      sourceRunId:
        typeof context.sourceRunId === 'string' && context.sourceRunId.trim()
          ? context.sourceRunId.trim()
          : null,
      stateIndex: stateIndexToNumber(context.stateIndex),
    }))
    .filter(
      (context): context is { sourceRunId: string; stateIndex: number } =>
        Boolean(context.sourceRunId) && context.stateIndex !== null,
    );
  if (normalizedContexts.length === 0) return [];

  const byKey = new Map<string, { sourceRunId: string; stateIndex: number }>();
  for (const context of normalizedContexts) {
    byKey.set(`${context.sourceRunId}:${context.stateIndex}`, context);
  }

  const uniqueContexts = Array.from(byKey.values());
  const radius = Math.max(0, Math.min(Math.floor(options.radius ?? 2), 8));
  const limit = clampLimit(options.limit, uniqueContexts.length * 4, MAX_FACT_LIMIT);
  const perContextLimit = Math.max(3, Math.min(8, Math.ceil(limit / uniqueContexts.length)));
  const filter = buildFactFilter(options);
  const stateExpr = "CAST(json_extract(attributes, '$.stateIndex') AS REAL)";
  const byId = new Map<string, MemoryFact>();

  for (const context of uniqueContexts) {
    if (byId.size >= limit) break;
    const minState = context.stateIndex - radius;
    const maxState = context.stateIndex + radius;
    const orderSql = options.preferAdjacent
      ? `CASE WHEN ${stateExpr} = ? THEN 1 ELSE 0 END ASC,
                 ABS(${stateExpr} - ?) ASC,
	                 CASE WHEN ${stateExpr} >= ? THEN 0 ELSE 1 END ASC,
	                 CASE
	                   WHEN memory_kind = 'outcome' THEN 0
	                   WHEN memory_kind = 'procedure' THEN 1
	                   WHEN memory_kind = 'decision' THEN 2
	                   WHEN memory_kind = 'risk' THEN 3
	                   ELSE 4
	                 END ASC,
                 retrievability DESC,
                 importance DESC,
                 updated_at DESC`
      : `ABS(${stateExpr} - ?) ASC,
                 retrievability DESC,
                 importance DESC,
                 updated_at DESC`;
    const orderParams = options.preferAdjacent
      ? [context.stateIndex, context.stateIndex, context.stateIndex]
      : [context.stateIndex];
    const rows = getMany<FactRow>(
      `SELECT * FROM memory_facts
        ${whereSql({
          clauses: ['source_run_id = ?', `${stateExpr} BETWEEN ? AND ?`, ...filter.clauses],
          params: [context.sourceRunId, minState, maxState, ...filter.params],
        })}
        ORDER BY ${orderSql}
        LIMIT ${Math.min(perContextLimit, limit - byId.size)}`,
      context.sourceRunId,
      minState,
      maxState,
      ...filter.params,
      ...orderParams,
    );
    for (const row of rows) {
      byId.set(row.id, rowToFact(row));
      if (byId.size >= limit) break;
    }
  }

  return Array.from(byId.values());
}

export function countFacts(
  options: { pinnedOnly?: boolean; scope?: MemoryFactScope; memoryKind?: MemoryFactKind } = {},
): number {
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (options.pinnedOnly) clauses.push('pinned = 1');
  if (options.scope) {
    clauses.push('scope = ?');
    params.push(options.scope);
  }
  if (options.memoryKind) {
    clauses.push('memory_kind = ?');
    params.push(options.memoryKind);
  }
  const where = clauses.join(' AND ');
  return countRows(`SELECT COUNT(*) as count FROM memory_facts WHERE ${where}`, ...params);
}

export function countFactsByKind(): Record<string, number> {
  const rows = getMany<{ memory_kind: string; count: number }>(
    `SELECT memory_kind, COUNT(*) AS count
       FROM memory_facts
      WHERE deleted_at IS NULL
      GROUP BY memory_kind
      ORDER BY count DESC`,
  );
  return Object.fromEntries(rows.map((row) => [row.memory_kind, row.count]));
}

export function getFactById(id: string): MemoryFact | null {
  const row = getOne<FactRow>(`SELECT * FROM memory_facts WHERE id = ? LIMIT 1`, id);
  return row ? rowToFact(row) : null;
}
