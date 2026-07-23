import { findEntityByName } from '../entities';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { tokenizeLexicalUnits } from '../ranking/lexical';
import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import {
  normalizeFactKind,
  rowToFact,
  type FactRow,
  type MemoryFact,
  type MemoryFactKind,
} from './types';

const DEFAULT_MANAGEMENT_SEARCH_LIMIT = 10;
const MAX_MANAGEMENT_SEARCH_LIMIT = 50;
const MAX_MANAGEMENT_SEARCH_QUERY_CHARS = 200;
const MAX_MANAGEMENT_SEARCH_UNITS = 32;

export interface MemoryFactManagementSearchResult {
  query: string;
  facts: MemoryFact[];
  totalCurrentFacts: number;
  totalMatches: number;
}

export interface MemoryFactManagementSearchOptions {
  limit?: number;
  memoryKind?: MemoryFactKind;
  pinnedOnly?: boolean;
}

function normalizeQuery(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MANAGEMENT_SEARCH_LIMIT;
  return Math.max(1, Math.min(Math.floor(value), MAX_MANAGEMENT_SEARCH_LIMIT));
}

function searchOptions(
  value: number | MemoryFactManagementSearchOptions | undefined,
): MemoryFactManagementSearchOptions {
  if (typeof value === 'number') return { limit: value };
  if (!value) return {};
  if (value.memoryKind && normalizeFactKind(value.memoryKind) !== value.memoryKind) {
    throw new Error('memory_management_search_kind_invalid');
  }
  return value;
}

export function searchMemoryFactsForManagement(
  rawQuery: string,
  limitOrOptions?: number | MemoryFactManagementSearchOptions,
): MemoryFactManagementSearchResult {
  const options = searchOptions(limitOrOptions);
  const query = normalizeQuery(rawQuery.slice(0, MAX_MANAGEMENT_SEARCH_QUERY_CHARS));
  if (!query) return { query, facts: [], totalCurrentFacts: 0, totalMatches: 0 };

  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const memoryClauses = [
    'f.memory_owner_id = ?',
    'f.invalid_at IS NULL',
    'f.deleted_at IS NULL',
    ...(options.memoryKind ? ['f.memory_kind = ?'] : []),
    ...(options.pinnedOnly ? ['f.pinned = 1'] : []),
  ];
  const memoryParams = [memoryOwnerId, ...(options.memoryKind ? [options.memoryKind] : [])];
  const totalCurrentFacts =
    db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM memory_facts f
        WHERE ${memoryClauses.join('\n          AND ')}`,
      ...memoryParams,
    )?.count ?? 0;
  const exactSubjectId = findEntityByName(query)?.id ?? null;
  const units = Array.from(tokenizeLexicalUnits(query)).slice(0, MAX_MANAGEMENT_SEARCH_UNITS);
  const likePattern = `%${escapeLikePattern(query)}%`;
  const matchedTermsCte = units.length
    ? `matched_terms AS (
         SELECT fact_id,
                COUNT(DISTINCT unit) AS matched_units,
                SUM(weight) AS matched_weight
           FROM memory_fact_terms
          WHERE unit IN (${units.map(() => '?').join(', ')})
          GROUP BY fact_id
       )`
    : `matched_terms AS (
         SELECT NULL AS fact_id, 0 AS matched_units, 0 AS matched_weight WHERE 0
       )`;
  const subjectClause = exactSubjectId ? 'OR f.subject_id = ?' : '';
  const filters = `${memoryClauses.join('\n      AND ')}
      AND (
        mt.fact_id IS NOT NULL
        OR LOWER(e.canonical_name) LIKE ? ESCAPE '\\'
        OR LOWER(f.predicate) LIKE ? ESCAPE '\\'
        OR LOWER(f.object_text) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(f.source_summary, '')) LIKE ? ESCAPE '\\'
        ${subjectClause}
      )`;
  const filterParams = [
    ...memoryParams,
    likePattern,
    likePattern,
    likePattern,
    likePattern,
    ...(exactSubjectId ? [exactSubjectId] : []),
  ];
  const sharedParams = [...units, ...filterParams];

  const totalMatches =
    db.getFirstSync<{ count: number }>(
      `WITH ${matchedTermsCte}
       SELECT COUNT(*) AS count
         FROM memory_facts f
         JOIN memory_entities e ON e.id = f.subject_id
         LEFT JOIN matched_terms mt ON mt.fact_id = f.id
        WHERE ${filters}`,
      ...sharedParams,
    )?.count ?? 0;
  const rows = db.getAllSync<FactRow>(
    `WITH ${matchedTermsCte}
     SELECT f.*
       FROM memory_facts f
       JOIN memory_entities e ON e.id = f.subject_id
       LEFT JOIN matched_terms mt ON mt.fact_id = f.id
      WHERE ${filters}
      ORDER BY COALESCE(mt.matched_units, 0) DESC,
               COALESCE(mt.matched_weight, 0) DESC,
               f.pinned DESC,
               f.importance DESC,
               f.updated_at DESC,
               f.id ASC
      LIMIT ?`,
    ...sharedParams,
    clampLimit(options.limit),
  );

  return {
    query,
    facts: rows.map(rowToFact),
    totalCurrentFacts,
    totalMatches,
  };
}
