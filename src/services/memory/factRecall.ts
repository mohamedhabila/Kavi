// ---------------------------------------------------------------------------
// Kavi — Query-time fact recall
// ---------------------------------------------------------------------------
// Bridges the bi-temporal fact store and the prompt assembler. The orchestrator
// hands us the latest user message; we return the top-K facts that should be
// injected into Layer 3 (`<retrieved_memory>` block) of the prompt.
//
// Scoring is deliberately sparse and deterministic:
//   • query-aware candidate generation from indexed lexical units;
//   • candidate-set IDF weighted lexical overlap;
//   • quoted-anchor boosts for exact UI/action names present on the same fact;
//   • context quality only after relevance is established.
//
// Query-time recall does not call embedding providers. The mobile assistant
// should have a predictable local memory read path; separate file/chunk search
// can still use embeddings through its own index.
// All retrieved facts are currently-valid (`invalid_at IS NULL`) by default —
// callers can pass `asOf` for historical queries.
// ---------------------------------------------------------------------------

import { markFactsRecalled } from './facts/mutations';
import {
  listFactsForRecallCandidates,
  listFactTermUnitHitsForFacts,
  selectIndexedLexicalUnitsForRecall,
} from './facts/queries';
import { type MemoryFact, type MemoryFactKind, type MemoryFactScope } from './facts/types';
import { countLexicalUnits } from './ranking/lexical';
import { buildScoringLexicalUnits } from './ranking/queryUnits';
import { quotedSpanUnitSets } from './ranking/quotedSpans';
import { exponentialDecayMultiplier } from './ranking/scoring';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const PINNED_BOOST = 0.25;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const RELEVANCE_EPSILON = 1e-6;
const QUOTED_ANCHOR_LIMIT = 12;
const QUOTED_ANCHOR_MATCH_BOOST = 0.18;
const QUOTED_ANCHOR_FULL_MATCH_BOOST = 0.12;
const UI_SCHEMA_KEY_ARRAY_LIMIT = 48;

export interface RecallFactsOptions {
  /** Maximum facts returned. Default 8. */
  limit?: number;
  /**
   * Relevance-score floor for inclusion. Scope, reinforcement, importance,
   * retrievability, and recency cannot move zero-relevance facts over this
   * floor; pinned facts are the only explicit non-query anchors.
   */
  threshold?: number;
  /** Bi-temporal anchor — facts valid at this ms timestamp. */
  asOf?: number;
  includeHistorical?: boolean;
  scopeHints?: MemoryFactScope[];
  conversationId?: string;
  taskId?: string;
  memoryKind?: MemoryFactKind | MemoryFactKind[];
  now?: number;
  /**
   * When true (default), pinned facts are always returned regardless of
   * threshold and consume `limit` slots first.
   */
  alwaysIncludePinned?: boolean;
  /**
   * Pool of candidates pulled from the store before scoring. Larger = more
   * recall, slower scoring. Default 128.
   */
  candidatePoolLimit?: number;
  /**
   * Maximum indexed lexical units used to fetch candidates. Lower values favor
   * rare discriminative units and bound SQLite fanout.
   */
  lexicalUnitLimit?: number;
  /** Optional recall-stage telemetry. Used by product diagnostics and benchmarks. */
  onTiming?: (timing: RecallFactsTiming) => void;
}

export interface RecallFactsTiming {
  queryChars: number;
  queryUnitCount: number;
  candidateCount: number;
  candidateHitFactCount: number;
  tokenizeQueryMs: number;
  candidateFetchMs: number;
  candidateTermHitsMs: number;
  unitWeightsMs: number;
  scoreMs: number;
  sortMs: number;
  selectMs: number;
  totalMs: number;
}

export interface ScoredFact {
  fact: MemoryFact;
  score: number;
  textScore: number;
  pinnedBoost: number;
  decayMultiplier: number;
  scopeBoost: number;
  reinforcementBoost: number;
  importanceScore: number;
  retrievabilityScore: number;
  relevanceScore: number;
}

function lexicalOverlapFromUnitHits(
  queryUnits: Set<string>,
  factUnitHits: ReadonlySet<string> | undefined,
  unitWeights?: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0 || !factUnitHits || factUnitHits.size === 0) return 0;
  let hits = 0;
  let total = 0;
  for (const unit of queryUnits) {
    const weight = unitWeights?.get(unit) ?? 1;
    total += weight;
    if (factUnitHits.has(unit)) hits += weight;
  }
  return total > 0 ? hits / total : 0;
}

function buildQueryUnitWeightsFromHits(
  queryUnits: Set<string>,
  candidates: ReadonlyArray<MemoryFact>,
  candidateUnitHits: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (queryUnits.size === 0 || candidates.length === 0) return weights;
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    const hits = candidateUnitHits.get(candidate.id);
    if (!hits || hits.size === 0) continue;
    for (const unit of queryUnits) {
      if (hits.has(unit)) {
        documentFrequency.set(unit, (documentFrequency.get(unit) ?? 0) + 1);
      }
    }
  }
  const documentCount = candidates.length;
  for (const unit of queryUnits) {
    const df = documentFrequency.get(unit) ?? 0;
    weights.set(unit, Math.log((documentCount + 1) / (df + 1)) + 1);
  }
  return weights;
}

function anchorMatchBoost(
  anchorUnitSets: ReadonlyArray<Set<string>>,
  factUnitHits: ReadonlySet<string> | undefined,
): number {
  if (anchorUnitSets.length === 0) return 0;
  const matched = anchorUnitSets.filter((anchorUnits) => {
    if (anchorUnits.size === 0) return false;
    return Array.from(anchorUnits).every((unit) => factUnitHits?.has(unit));
  }).length;
  if (matched === 0) return 0;
  return (
    matched * QUOTED_ANCHOR_MATCH_BOOST +
    (matched === anchorUnitSets.length ? QUOTED_ANCHOR_FULL_MATCH_BOOST : 0)
  );
}

function getCandidateScopes(options: RecallFactsOptions): MemoryFactScope[] | undefined {
  if (!options.scopeHints?.length && !options.conversationId && !options.taskId) {
    return undefined;
  }
  const scopes = new Set<MemoryFactScope>(options.scopeHints ?? []);
  if (options.conversationId) scopes.add('conversation');
  if (options.taskId) scopes.add('session');
  scopes.add('global');
  scopes.add('project');
  return scopes.size > 0 ? Array.from(scopes) : undefined;
}

function isFactEligibleForRecall(fact: MemoryFact, options: RecallFactsOptions): boolean {
  if (fact.scope === 'conversation') {
    return Boolean(options.conversationId && fact.originConversationId === options.conversationId);
  }
  if (fact.scope === 'session') {
    return Boolean(options.taskId && fact.originTaskId === options.taskId);
  }
  return true;
}

function scoreScope(fact: MemoryFact, options: RecallFactsOptions): number {
  if (fact.scope === 'conversation' && fact.originConversationId === options.conversationId) {
    return 0.08;
  }
  if (fact.scope === 'session' && fact.originTaskId === options.taskId) {
    return 0.08;
  }
  if (options.scopeHints?.includes(fact.scope)) return 0.04;
  return 0;
}

function decayHalfLifeDays(fact: MemoryFact): number {
  if (fact.pinned || fact.decayPolicy === 'pinned') return Number.POSITIVE_INFINITY;
  if (fact.decayPolicy === 'slow') return 180;
  if (fact.decayPolicy === 'fast') return 7;
  if (fact.decayPolicy === 'ephemeral') return 2;
  return 30 + fact.importance * 90 + Math.log1p(fact.accessCount) * 12;
}

function scoreDecay(fact: MemoryFact, now: number): number {
  const halfLifeDays = decayHalfLifeDays(fact);
  if (!Number.isFinite(halfLifeDays)) return 1;
  const lastStrengthAt = fact.lastReinforcedAt ?? fact.lastRecalledAt ?? fact.updatedAt;
  const ageDays = Math.max(0, now - lastStrengthAt) / (24 * 60 * 60 * 1000);
  return exponentialDecayMultiplier({ ageInDays: ageDays, halfLifeDays });
}

function scoreReinforcement(fact: MemoryFact): number {
  return Math.min(0.05, Math.log1p(fact.accessCount + fact.repeatedMentionCount) * 0.015);
}

function scoreRetrievability(fact: MemoryFact): number {
  return Math.max(0, Math.min(1, fact.retrievability));
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown, limit = UI_SCHEMA_KEY_ARRAY_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, limit);
}

function objectArrayShape(
  value: unknown,
  fields: ReadonlyArray<string>,
  limit = UI_SCHEMA_KEY_ARRAY_LIMIT,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) =>
      Object.fromEntries(
        fields
          .map((field) => [field, entry[field]] as const)
          .filter(([, fieldValue]) =>
            Array.isArray(fieldValue)
              ? fieldValue.length > 0
              : fieldValue !== undefined && fieldValue !== null && fieldValue !== '',
          ),
      ),
    )
    .filter((entry) => Object.keys(entry).length > 0)
    .slice(0, limit);
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 4) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, output, depth + 1);
    }
  }
}

function unitsForJsonFields(
  parsed: Record<string, unknown>,
  fields: ReadonlyArray<string>,
): Set<string> {
  const values: string[] = [];
  for (const field of fields) collectStrings(parsed[field], values);
  const units = new Set<string>();
  for (const value of values) {
    for (const unit of countLexicalUnits(value).keys()) units.add(unit);
  }
  return units;
}

function scalarString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function uiInventorySchemaKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_inventory') return null;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return null;
  const url = scalarString(fact.attributes.url, parsed.url);
  const fields = objectArrayShape(parsed.fields, ['role', 'controlName', 'name', 'type', 'required']);
  const textEntryControls = objectArrayShape(parsed.textEntryControls, [
    'role',
    'name',
    'controlName',
    'type',
  ]);
  const searchControls = objectArrayShape(parsed.searchControls, [
    'role',
    'name',
    'controlName',
    'type',
  ]);
  const hasFormShape =
    fields.length > 0 || textEntryControls.length > 0 || searchControls.length > 0;
  const key = {
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    url,
    controlNames: hasFormShape ? [] : stringArray(parsed.controlNames),
    fields,
    textEntryControls,
    searchControls,
    labelValues: objectArrayShape(parsed.labelValues, ['label', 'role', 'name']),
    sections: hasFormShape
      ? []
      : objectArrayShape(parsed.sections, ['label', 'controlNames', 'fieldLabels']),
    tables: objectArrayShape(parsed.tables, ['label', 'columns']),
  };
  return `ui_inventory:${JSON.stringify(key)}`;
}

function uiStateSlotKey(fact: MemoryFact): string | null {
  if (fact.memoryKind !== 'ui_field' && fact.memoryKind !== 'ui_filter_state') return null;
  const parsed = parseJsonRecord(fact.objectText);
  const sourceRunId = scalarString(fact.sourceRunId, fact.attributes.sourceRunId, parsed?.sourceRunId);
  const stateIndex = scalarString(fact.attributes.stateIndex, parsed?.stateIndex);
  const url = scalarString(fact.attributes.url, parsed?.url);
  if (!sourceRunId && !stateIndex && !url) return null;
  return `ui_state:${sourceRunId}:${stateIndex}:${url}`;
}

function selectionDedupeKey(fact: MemoryFact): string | null {
  return uiInventorySchemaKey(fact) ?? uiStateSlotKey(fact);
}

function transitionStateBoost(
  fact: MemoryFact,
  queryUnits: Set<string>,
  unitWeights: ReadonlyMap<string, number>,
): number {
  if (fact.memoryKind !== 'ui_inventory' || queryUnits.size === 0) return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!parsed) return 0;
  const previousUnits = unitsForJsonFields(parsed, [
    'previousAction',
    'previousControlNames',
    'previousUrl',
  ]);
  if (previousUnits.size === 0) return 0;
  const currentUnits = unitsForJsonFields(parsed, [
    'sections',
    'controlNames',
    'fieldLabels',
    'fields',
    'textEntryControls',
    'searchControls',
    'labelValues',
    'tables',
    'url',
  ]);
  if (currentUnits.size === 0) return 0;
  const previousOnlyUnits = new Set(
    Array.from(previousUnits).filter((unit) => !currentUnits.has(unit)),
  );
  const previousOnlyOverlap = lexicalOverlapFromUnitHits(
    queryUnits,
    previousOnlyUnits,
    unitWeights,
  );
  const currentOverlap = lexicalOverlapFromUnitHits(queryUnits, currentUnits, unitWeights);
  if (previousOnlyOverlap <= 0 || currentOverlap <= 0) return 0;
  return Math.min(0.16, (previousOnlyOverlap + currentOverlap) * 0.5);
}

function buildScoredFact(params: {
  fact: MemoryFact;
  queryUnits: Set<string>;
  factUnitHits: ReadonlySet<string> | undefined;
  unitWeights: ReadonlyMap<string, number>;
  anchorUnitSets: ReadonlyArray<Set<string>>;
  alwaysIncludePinned: boolean;
  options: RecallFactsOptions;
  now: number;
}): ScoredFact {
  const {
    fact,
    queryUnits,
    factUnitHits,
    anchorUnitSets,
    alwaysIncludePinned,
    options,
    now,
  } = params;
  const textScore = lexicalOverlapFromUnitHits(queryUnits, factUnitHits, params.unitWeights);
  const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
  const decayMultiplier = scoreDecay(fact, now);
  const scopeBoost = scoreScope(fact, options);
  const reinforcementBoost = scoreReinforcement(fact);
  const importanceScore = fact.importance * 0.04;
  const retrievabilityScore = scoreRetrievability(fact);
  const relevanceScore = textScore * fact.confidence * decayMultiplier * retrievabilityScore;
  const anchorBoost = anchorMatchBoost(anchorUnitSets, factUnitHits);
  const transitionBoost = transitionStateBoost(fact, queryUnits, params.unitWeights);
  const hasRelevance = relevanceScore > RELEVANCE_EPSILON;
  const score =
    relevanceScore +
    anchorBoost +
    transitionBoost +
    pinnedBoost +
    (hasRelevance || anchorBoost > 0 ? scopeBoost + reinforcementBoost + importanceScore : 0);
  return {
    fact,
    score,
    textScore,
    pinnedBoost,
    decayMultiplier,
    scopeBoost,
    reinforcementBoost,
    importanceScore,
    retrievabilityScore,
    relevanceScore,
  };
}

function addSelectedFact(params: {
  selected: MemoryFact[];
  seenIds: Set<string>;
  seenKeys: Set<string>;
  fact: MemoryFact;
  limit: number;
}): boolean {
  if (params.selected.length >= params.limit) return false;
  if (params.seenIds.has(params.fact.id)) return false;
  const key = selectionDedupeKey(params.fact);
  if (key && params.seenKeys.has(key)) return false;
  params.selected.push(params.fact);
  params.seenIds.add(params.fact.id);
  if (key) params.seenKeys.add(key);
  return true;
}

async function buildRecallSelection(
  query: string,
  options: RecallFactsOptions,
): Promise<{ facts: MemoryFact[]; scoredFacts: ScoredFact[] }> {
  const totalStarted = Date.now();
  const timing: RecallFactsTiming = {
    queryChars: query.length,
    queryUnitCount: 0,
    candidateCount: 0,
    candidateHitFactCount: 0,
    tokenizeQueryMs: 0,
    candidateFetchMs: 0,
    candidateTermHitsMs: 0,
    unitWeightsMs: 0,
    scoreMs: 0,
    sortMs: 0,
    selectMs: 0,
    totalMs: 0,
  };
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
  const candidatePool = Math.max(
    limit,
    Math.min(options.candidatePoolLimit ?? CANDIDATE_POOL_LIMIT, CANDIDATE_POOL_MAX),
  );
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const trimmedQuery = query.trim();
  const now = options.now ?? options.asOf ?? Date.now();
  const candidateScopes = getCandidateScopes(options);
  const tokenizeStarted = Date.now();
  const queryUnitCounts = countLexicalUnits(trimmedQuery);
  const queryUnits = new Set(queryUnitCounts.keys());
  const anchorUnitSets = quotedSpanUnitSets(trimmedQuery, QUOTED_ANCHOR_LIMIT);
  const lexicalUnitsForRecall = Array.from(queryUnitCounts.entries()).flatMap(([unit, count]) =>
    Array.from({ length: Math.max(1, Math.min(count, 16)) }, () => unit),
  );
  const selectedLexicalUnits = selectIndexedLexicalUnitsForRecall(lexicalUnitsForRecall, {
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.lexicalUnitLimit ? { lexicalUnitLimit: options.lexicalUnitLimit } : {}),
  });
  const scoringQueryUnits = buildScoringLexicalUnits(queryUnits, selectedLexicalUnits);
  timing.tokenizeQueryMs = Date.now() - tokenizeStarted;
  timing.queryUnitCount = queryUnits.size;

  const candidateFetchStarted = Date.now();
  const candidates = listFactsForRecallCandidates({
    limit: candidatePool,
    lexicalUnits: lexicalUnitsForRecall,
    selectedLexicalUnits,
    ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
    ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
    ...(candidateScopes ? { scope: candidateScopes } : {}),
    ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
    ...(options.includeHistorical ? { includeInvalidated: true } : {}),
    ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
  }).filter((fact) => isFactEligibleForRecall(fact, options));
  timing.candidateFetchMs = Date.now() - candidateFetchStarted;
  timing.candidateCount = candidates.length;
  const candidateTermHitsStarted = Date.now();
  const candidateUnitHits = listFactTermUnitHitsForFacts(
    candidates.map((fact) => fact.id),
    Array.from(scoringQueryUnits),
  );
  timing.candidateTermHitsMs = Date.now() - candidateTermHitsStarted;
  timing.candidateHitFactCount = candidateUnitHits.size;

  const unitWeightsStarted = Date.now();
  const unitWeights = buildQueryUnitWeightsFromHits(scoringQueryUnits, candidates, candidateUnitHits);
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: scoringQueryUnits,
      factUnitHits: candidateUnitHits.get(fact.id),
      unitWeights,
      anchorUnitSets,
      alwaysIncludePinned,
      options,
      now,
    }),
  );
  timing.scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.fact.updatedAt - a.fact.updatedAt;
  });
  timing.sortMs = Date.now() - sortStarted;
  const scoredById = new Map(scored.map((entry) => [entry.fact.id, entry]));

  const selectStarted = Date.now();
  const selected: MemoryFact[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  if (alwaysIncludePinned) {
    for (const entry of scored) {
      if (!entry.fact.pinned) continue;
      addSelectedFact({ selected, seenIds, seenKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

  if (trimmedQuery && selected.length < limit) {
    const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
    for (const entry of scored) {
      if (entry.relevanceScore < threshold && entry.score < threshold) continue;
      addSelectedFact({ selected, seenIds, seenKeys, fact: entry.fact, limit });
      if (selected.length >= limit) break;
    }
  }

  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  return {
    facts: selected,
    scoredFacts: selected.map((fact) => scoredById.get(fact.id)).filter(Boolean) as ScoredFact[],
  };
}

/**
 * Query-time recall — the canonical entry point used by prompt assembly.
 *
 * Returns up to `limit` MemoryFact entries ranked by combined score. Pinned
 * facts are always included (consuming slots first) when
 * `alwaysIncludePinned` is true (default).
 *
 * The function is deliberately tolerant of partial inputs: empty queries
 * return only pinned facts.
 */
export async function recallFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<MemoryFact[]> {
  const now = options.now ?? options.asOf ?? Date.now();
  const selection = await buildRecallSelection(query, options);

  markFactsRecalled(
    selection.facts.map((fact) => fact.id),
    now,
  );
  return selection.facts;
}

/**
 * Score-bearing variant. Same selection logic as `recallFactsForQuery` but
 * returns the per-fact scoring breakdown so callers (telemetry, UI) can show
 * why a fact was retrieved.
 */
export async function recallScoredFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<ScoredFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.scoredFacts;
}
