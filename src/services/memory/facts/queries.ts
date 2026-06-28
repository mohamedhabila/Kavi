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
const DEFAULT_RECALL_LEXICAL_UNIT_LIMIT = 12;
const MAX_RECALL_LEXICAL_UNIT_LIMIT = 32;
const COMPACT_UI_RECALL_KINDS: MemoryFactKind[] = [
  'ui_affordance',
  'ui_field',
  'ui_filter_state',
];

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

export function selectIndexedLexicalUnitsForRecall(
  units: string[],
  options: Pick<ListFactsForRecallCandidatesOptions, 'memoryKind' | 'lexicalUnitLimit'>,
): string[] {
  const unitStats = new Map<string, { index: number; queryCount: number }>();
  for (const rawUnit of units) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    const existing = unitStats.get(unit);
    if (existing) {
      existing.queryCount += 1;
    } else {
      unitStats.set(unit, { index: unitStats.size, queryCount: 1 });
    }
  }
  const uniqueUnits = Array.from(unitStats.keys());
  if (uniqueUnits.length === 0) return [];
  const maxUnits = clampLimit(
    options.lexicalUnitLimit,
    DEFAULT_RECALL_LEXICAL_UNIT_LIMIT,
    MAX_RECALL_LEXICAL_UNIT_LIMIT,
  );
  const termClauses = [`unit IN (${uniqueUnits.map(() => '?').join(', ')})`];
  const params: SqlBindValue[] = [...uniqueUnits];
  if (options.memoryKind) {
    const kinds = Array.isArray(options.memoryKind) ? options.memoryKind : [options.memoryKind];
    termClauses.push(`memory_kind IN (${kinds.map(() => '?').join(', ')})`);
    params.push(...kinds);
  }
  const rows = getMany<{ unit: string; hit_count: number }>(
    `SELECT unit, SUM(fact_count) AS hit_count
       FROM memory_fact_term_stats
      WHERE ${termClauses.join(' AND ')}
      GROUP BY unit`,
    ...params,
  );
  const hitCounts = new Map(rows.map((row) => [row.unit, row.hit_count]));
  const maxHitCount = Math.max(1, ...Array.from(hitCounts.values()));
  const positiveEntries = uniqueUnits
    .map((unit) => {
      const stats = unitStats.get(unit) ?? { index: 0, queryCount: 1 };
      const hitCount = hitCounts.get(unit) ?? 0;
      const inverseFrequency = Math.log((maxHitCount + 1) / (hitCount + 1)) + 1;
      return {
        unit,
        index: stats.index,
        hitCount,
        score: stats.queryCount * inverseFrequency,
      };
    })
    .filter((entry) => entry.hitCount > 0);
  const ranked = positiveEntries
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.hitCount !== right.hitCount) return left.hitCount - right.hitCount;
      if (right.unit.length !== left.unit.length) return right.unit.length - left.unit.length;
      return left.index - right.index;
    })
    .slice(0, maxUnits)
    .map((entry) => entry.unit);
  if (ranked.length > 0) return ranked;
  return uniqueUnits.slice(0, maxUnits);
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
  scopedRecentConversationId?: string;
  scopedRecentTaskId?: string;
  pinnedLimit?: number;
  scopedRecentLimit?: number;
  lexicalUnitLimit?: number;
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

  addRows(
    ['pinned = 1'],
    [],
    'pinned DESC, retrievability DESC, importance DESC, updated_at DESC',
    clampLimit(options.pinnedLimit, DEFAULT_RECALL_PINNED_LIMIT, totalLimit),
  );

  const lexicalUnits = options.selectedLexicalUnits?.length
    ? Array.from(new Set(options.selectedLexicalUnits.map((unit) => unit.trim()).filter(Boolean)))
    : selectIndexedLexicalUnitsForRecall(options.lexicalUnits ?? [], options);
  if (lexicalUnits.length > 0) {
    if (!options.memoryKind) {
      const compactUiLexicalUnits = selectIndexedLexicalUnitsForRecall(options.lexicalUnits ?? [], {
        memoryKind: COMPACT_UI_RECALL_KINDS,
        lexicalUnitLimit: MAX_RECALL_LEXICAL_UNIT_LIMIT,
      });
      addIndexedLexicalRows(
        compactUiLexicalUnits.length > 0 ? compactUiLexicalUnits : lexicalUnits,
        Math.max(16, Math.ceil(totalLimit * 0.25)),
        COMPACT_UI_RECALL_KINDS,
      );
    }
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

export function listFactsForSourceRuns(
  sourceRunIds: ReadonlyArray<string>,
  options: Pick<
    ListFactsOptions,
    'memoryKind' | 'includeDeleted' | 'includeExpired' | 'includeInvalidated' | 'asOf'
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

export interface FactObservationContext {
  sourceRunId?: string | null;
  stateIndex?: string | number | null;
  url?: string | null;
}

function scalarToString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function factMatchesObservationContext(fact: MemoryFact, context: FactObservationContext): boolean {
  const contextStateIndex = scalarToString(context.stateIndex);
  const factStateIndex = scalarToString(fact.attributes.stateIndex);
  const contextUrl =
    typeof context.url === 'string' && context.url.trim() ? context.url.trim() : null;
  const factUrl = typeof fact.attributes.url === 'string' ? fact.attributes.url : null;
  if (contextStateIndex && factStateIndex === contextStateIndex) {
    return !contextUrl || factUrl === contextUrl;
  }
  return Boolean(contextUrl && factUrl === contextUrl);
}

export function listUiInventoriesForObservationContexts(
  contexts: ReadonlyArray<FactObservationContext>,
  options: Pick<
    ListFactsOptions,
    'includeDeleted' | 'includeExpired' | 'includeInvalidated' | 'asOf'
  > & {
    limit?: number;
  } = {},
): MemoryFact[] {
  const normalizedContexts = contexts
    .map((context) => ({
      sourceRunId:
        typeof context.sourceRunId === 'string' && context.sourceRunId.trim()
          ? context.sourceRunId.trim()
          : null,
      stateIndex: scalarToString(context.stateIndex),
      url: typeof context.url === 'string' && context.url.trim() ? context.url.trim() : null,
    }))
    .filter((context) => context.sourceRunId && (context.stateIndex || context.url));
  if (normalizedContexts.length === 0) return [];
  const contextLimit = Math.max(1, Math.min(Math.max((options.limit ?? 32) * 2, 32), 96));
  const boundedContexts = normalizedContexts.slice(0, contextLimit);

  const byId = new Map<string, MemoryFact>();
  const limit = clampLimit(options.limit, boundedContexts.length, MAX_FACT_LIMIT);
  const filter = buildFactFilter({
    memoryKind: 'ui_inventory',
    ...(options.includeDeleted ? { includeDeleted: true } : {}),
    ...(options.includeExpired ? { includeExpired: true } : {}),
    ...(options.includeInvalidated ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  });
  for (const context of boundedContexts) {
    if (!context.sourceRunId) continue;
    if (byId.size >= limit) return Array.from(byId.values());
    const matchClauses: string[] = [];
    const matchParams: SqlBindValue[] = [];
    if (context.stateIndex && context.url) {
      matchClauses.push(
        `(json_extract(attributes, '$.stateIndex') = ? AND json_extract(attributes, '$.url') = ?)`,
      );
      matchParams.push(context.stateIndex, context.url);
    } else if (context.stateIndex) {
      matchClauses.push(`json_extract(attributes, '$.stateIndex') = ?`);
      matchParams.push(context.stateIndex);
    }
    if (context.url) {
      matchClauses.push(`json_extract(attributes, '$.url') = ?`);
      matchParams.push(context.url);
    }
    if (matchClauses.length === 0) continue;
    const rows = getMany<FactRow>(
      `SELECT * FROM memory_facts
        ${whereSql({
          clauses: ['source_run_id = ?', `(${matchClauses.join(' OR ')})`, ...filter.clauses],
          params: [context.sourceRunId, ...matchParams, ...filter.params],
        })}
        ORDER BY retrievability DESC, importance DESC, updated_at DESC
        LIMIT ${limit - byId.size}`,
      context.sourceRunId,
      ...matchParams,
      ...filter.params,
    );
    for (const row of rows) {
      const fact = rowToFact(row);
      if (!factMatchesObservationContext(fact, context)) continue;
      byId.set(fact.id, fact);
      if (byId.size >= limit) {
        return Array.from(byId.values());
      }
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
