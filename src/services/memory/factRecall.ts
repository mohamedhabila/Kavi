// Kavi query-time fact recall. This path is deterministic and local: build one
// indexed lexical candidate pool, score it once, and return the best matching
// memories. Agent-run structure belongs in compact memory records, not in
// query-time repair lanes.

import { markFactsRecalled } from './facts/mutations';
import { listFactTermUnitHitsForFacts, listFactsForRecallCandidates } from './facts/queries';
import { type MemoryFact, type MemoryFactScope } from './facts/types';
import { selectIndexedRecallLexicalUnits } from './factRecallCandidateUnits';
import { buildRecallLexicalUnits, selectScoringQueryUnits } from './factRecallQueryUnits';
import {
  type RecallFactsOptions,
  type RecallFactsTiming,
  type ScoredFact,
} from './factRecallTypes';
import {
  buildQueryUnitWeightsFromHits,
  buildScoredFact,
  selectDiscriminativeScoringUnits,
} from './factRecallScoring';
import { countLexicalUnits } from './ranking/lexical';
import { quotedSpanUnitSets } from './ranking/quotedSpans';

export type { RecallFactsOptions, RecallFactsTiming, ScoredFact } from './factRecallTypes';

const DEFAULT_LIMIT = 8;
const DEFAULT_TEXT_THRESHOLD = 0.04;
const CANDIDATE_POOL_LIMIT = 128;
const CANDIDATE_POOL_MAX = 2_000;
const QUOTED_ANCHOR_LIMIT = 12;

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

function uniqueFactsById(facts: ReadonlyArray<MemoryFact>): MemoryFact[] {
  const byId = new Map<string, MemoryFact>();
  for (const fact of facts) byId.set(fact.id, fact);
  return Array.from(byId.values());
}

function factDedupeKey(fact: MemoryFact): string {
  return `${fact.memoryKind}\u0000${fact.contentHash || fact.objectText.trim()}`;
}

function selectTopFacts(
  scored: ReadonlyArray<ScoredFact>,
  options: RecallFactsOptions,
  limit: number,
): ScoredFact[] {
  const threshold = options.threshold ?? DEFAULT_TEXT_THRESHOLD;
  const alwaysIncludePinned = options.alwaysIncludePinned !== false;
  const selected: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const entry of scored) {
    if (selected.length >= limit) break;
    const isPinned = alwaysIncludePinned && entry.fact.pinned;
    if (!isPinned && entry.relevanceScore < threshold && entry.score < threshold) continue;
    if (seenIds.has(entry.fact.id)) continue;
    const key = factDedupeKey(entry.fact);
    if (seenKeys.has(key)) continue;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    seenKeys.add(key);
  }

  return selected;
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
  const anchorLexicalUnits = Array.from(
    new Set(anchorUnitSets.flatMap((anchorUnits) => Array.from(anchorUnits))),
  );
  const recallLexicalUnits = buildRecallLexicalUnits(
    queryUnitCounts,
    anchorLexicalUnits,
    options.lexicalUnitLimit,
  );
  timing.tokenizeQueryMs = Date.now() - tokenizeStarted;
  timing.queryUnitCount = queryUnits.size;

  const candidateFetchStarted = Date.now();
  const indexedRecallLexicalUnits = selectIndexedRecallLexicalUnits(
    recallLexicalUnits,
    anchorLexicalUnits,
  );
  const candidates = uniqueFactsById(
    listFactsForRecallCandidates({
      limit: candidatePool,
      selectedLexicalUnits: indexedRecallLexicalUnits,
      ...(options.conversationId ? { scopedRecentConversationId: options.conversationId } : {}),
      ...(options.taskId ? { scopedRecentTaskId: options.taskId } : {}),
      ...(candidateScopes ? { scope: candidateScopes } : {}),
      ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
      ...(options.includeHistorical ? { includeInvalidated: true } : {}),
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
    }),
  ).filter((fact) => isFactEligibleForRecall(fact, options));
  timing.candidateFetchMs = Date.now() - candidateFetchStarted;
  timing.candidateCount = candidates.length;

  const candidateTermHitsStarted = Date.now();
  const candidateUnitHits = listFactTermUnitHitsForFacts(
    candidates.map((fact) => fact.id),
    recallLexicalUnits,
  );
  timing.candidateTermHitsMs = Date.now() - candidateTermHitsStarted;
  timing.candidateHitFactCount = candidateUnitHits.size;
  const scoringQueryUnits = selectScoringQueryUnits(
    recallLexicalUnits,
    queryUnits,
    candidateUnitHits,
  );

  const unitWeightsStarted = Date.now();
  const initialUnitWeights = buildQueryUnitWeightsFromHits(
    scoringQueryUnits,
    candidates,
    candidateUnitHits,
  );
  const discriminativeScoringUnits = selectDiscriminativeScoringUnits({
    scoringUnits: scoringQueryUnits,
    unitWeights: initialUnitWeights,
    anchorLexicalUnits,
  });
  const unitWeights = buildQueryUnitWeightsFromHits(
    discriminativeScoringUnits,
    candidates,
    candidateUnitHits,
  );
  timing.unitWeightsMs = Date.now() - unitWeightsStarted;

  const scoreStarted = Date.now();
  const scored = candidates.map((fact) =>
    buildScoredFact({
      fact,
      queryUnits: discriminativeScoringUnits,
      factUnitHits: candidateUnitHits.get(fact.id),
      unitWeights,
      query: trimmedQuery,
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

  const selectStarted = Date.now();
  const selected = selectTopFacts(scored, options, limit);
  timing.selectMs = Date.now() - selectStarted;
  timing.totalMs = Date.now() - totalStarted;
  options.onTiming?.(timing);

  return {
    facts: selected.map((entry) => entry.fact),
    scoredFacts: selected,
  };
}

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

export async function recallScoredFactsForQuery(
  query: string,
  options: RecallFactsOptions = {},
): Promise<ScoredFact[]> {
  const selection = await buildRecallSelection(query, options);
  return selection.scoredFacts;
}
