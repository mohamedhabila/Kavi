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
const DEFAULT_RECALL_CANDIDATE_LIMIT = 512;
const MAX_RECALL_CANDIDATE_LIMIT = 2_000;
const DEFAULT_RECALL_PINNED_LIMIT = 64;
const DEFAULT_RECALL_SCOPED_RECENT_LIMIT = 192;
const DEFAULT_RECALL_LEXICAL_UNIT_LIMIT = 64;

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
    clauses.push(
      `${column('memory_kind', alias)} IN (${kinds.map(() => '?').join(', ')})`,
    );
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

function prioritizeLexicalUnits(units: string[]): string[] {
  return units
    .map((unit, index) => ({ unit, index }))
    .sort((left, right) => {
      if (right.unit.length !== left.unit.length) return right.unit.length - left.unit.length;
      return left.index - right.index;
    })
    .map((entry) => entry.unit);
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

  function addIndexedLexicalRows(units: string[], limit: number): void {
    if (byId.size >= totalLimit || units.length === 0) return;
    const laneLimit = Math.max(1, Math.min(limit, totalLimit - byId.size));
    const factFilter = buildFactFilter(options, 'f');
    const termClauses = [`t.unit IN (${units.map(() => '?').join(', ')})`];
    const params: SqlBindValue[] = [...units];
    if (options.memoryKind) {
      const kinds = Array.isArray(options.memoryKind) ? options.memoryKind : [options.memoryKind];
      termClauses.push(`t.memory_kind IN (${kinds.map(() => '?').join(', ')})`);
      params.push(...kinds);
    }
    const where = whereSql({
      clauses: [...termClauses, ...factFilter.clauses],
      params: [...params, ...factFilter.params],
    });
    const rows = getMany<FactRow>(
      `SELECT f.*
         FROM memory_fact_terms t
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
    'updated_at DESC',
    clampLimit(options.pinnedLimit, DEFAULT_RECALL_PINNED_LIMIT, totalLimit),
  );

  const lexicalUnits = Array.from(
    new Set((options.lexicalUnits ?? []).map((unit) => unit.trim()).filter(Boolean)),
  ).slice(0, clampLimit(options.lexicalUnitLimit, DEFAULT_RECALL_LEXICAL_UNIT_LIMIT, 64));
  const prioritizedLexicalUnits = prioritizeLexicalUnits(lexicalUnits);
  if (prioritizedLexicalUnits.length > 0) {
    addIndexedLexicalRows(prioritizedLexicalUnits, totalLimit);
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
