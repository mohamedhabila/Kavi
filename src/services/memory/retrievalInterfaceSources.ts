import type { RecallFactsOptions, ScoredFact } from './factRecall';
import { listFactsForSourceRuns } from './facts/queries';
import type { MemoryFact } from './facts/types';
import {
  buildQueryUnitWeights,
  lexicalOverlap,
  tokenizeLexicalUnits,
} from './ranking/lexical';
import { retrievalTextForFact } from './ranking/factText';

export const INTERFACE_SOURCE_POOL_LIMIT = 32;
export const INTERFACE_SOURCE_POOL_MIN = 24;
export const INTERFACE_SOURCE_POOL_MULTIPLIER = 5;

const INTERFACE_SOURCE_GROUP_TOP_FACTS = 6;
const INTERFACE_SOURCE_GROUP_FACT_LIMIT = 3;
const SOURCE_LINKED_INTERFACE_POOL_LIMIT = 24;
const SOURCE_LINKED_INTERFACE_PER_SOURCE = 3;

interface InterfaceLaneLike {
  id: string;
  scoredFacts: ScoredFact[];
  facts: MemoryFact[];
  timings?: { poolSize: number };
}

function sourceGroupKey(fact: MemoryFact): string {
  return fact.sourceRunId ?? fact.id;
}

function sourceRankingText(fact: MemoryFact): string {
  return retrievalTextForFact(fact);
}

function mergeUniqueScoredFacts(entries: ScoredFact[], limit: number): ScoredFact[] {
  const merged: ScoredFact[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.fact.id)) continue;
    merged.push(entry);
    seenIds.add(entry.fact.id);
    if (merged.length >= limit) break;
  }
  return merged;
}

function mergeUniqueScoredFactsByScore(entries: ScoredFact[], limit: number): ScoredFact[] {
  return mergeUniqueScoredFacts(
    [...entries].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.fact.updatedAt - left.fact.updatedAt;
    }),
    limit,
  );
}

export function selectSourceAwareInterfaceFacts(
  entries: ScoredFact[],
  query: string,
  limit: number,
): ScoredFact[] {
  if (entries.length <= limit) return entries;
  const queryUnits = tokenizeLexicalUnits(query);
  if (queryUnits.size === 0) return mergeUniqueScoredFacts(entries, limit);
  const unitWeights = buildQueryUnitWeights(queryUnits, entries, (entry) =>
    sourceRankingText(entry.fact),
  );
  const groups = new Map<string, ScoredFact[]>();
  for (const entry of entries) {
    const key = sourceGroupKey(entry.fact);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const rankedGroups = Array.from(groups.entries())
    .map(([key, group]) => {
      const rankedEntries = [...group].sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const rightOverlap = lexicalOverlap(queryUnits, sourceRankingText(right.fact), unitWeights);
        const leftOverlap = lexicalOverlap(queryUnits, sourceRankingText(left.fact), unitWeights);
        if (rightOverlap !== leftOverlap) return rightOverlap - leftOverlap;
        return right.fact.updatedAt - left.fact.updatedAt;
      });
      const topEntries = rankedEntries.slice(0, INTERFACE_SOURCE_GROUP_TOP_FACTS);
      const coverageScore = lexicalOverlap(
        queryUnits,
        topEntries.map((entry) => sourceRankingText(entry.fact)).join('\n'),
        unitWeights,
      );
      const bestScore = Math.max(...topEntries.map((entry) => entry.score));
      const averageScore =
        topEntries.reduce((sum, entry) => sum + entry.score, 0) / Math.max(1, topEntries.length);
      return {
        key,
        entries: rankedEntries,
        score: coverageScore * 0.3 + bestScore * 0.55 + averageScore * 0.15,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.entries[0].fact.updatedAt - left.entries[0].fact.updatedAt;
    });

  const selected: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const selectedPerGroup = new Map<string, number>();
  const addEntry = (groupKey: string, entry: ScoredFact): void => {
    if (selected.length >= limit || seenIds.has(entry.fact.id)) return;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    selectedPerGroup.set(groupKey, (selectedPerGroup.get(groupKey) ?? 0) + 1);
  };

  for (const group of rankedGroups) {
    const first =
      group.entries.find(
        (entry) => entry.fact.memoryKind === 'ui_inventory' && !seenIds.has(entry.fact.id),
      ) ?? group.entries.find((entry) => !seenIds.has(entry.fact.id));
    if (first) addEntry(group.key, first);
    if (selected.length >= limit) return selected;
  }

  let added = true;
  while (selected.length < limit && added) {
    added = false;
    for (const group of rankedGroups) {
      if ((selectedPerGroup.get(group.key) ?? 0) >= INTERFACE_SOURCE_GROUP_FACT_LIMIT) continue;
      const next = group.entries.find((entry) => !seenIds.has(entry.fact.id));
      if (!next) continue;
      addEntry(group.key, next);
      added = true;
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

function scoredSourceLinkedInterfaceFact(params: {
  fact: MemoryFact;
  score: number;
}): ScoredFact {
  return {
    fact: params.fact,
    score: params.score,
    vectorScore: 0,
    textScore: 0,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: params.fact.importance * 0.04,
    retrievabilityScore: params.fact.retrievability,
    relevanceScore: params.score,
  };
}

function mergeSourceRunScore(
  scores: Map<string, number>,
  sourceRunId: string | undefined | null,
  score: number,
): void {
  const normalized = sourceRunId?.trim();
  if (!normalized || score <= 0) return;
  scores.set(normalized, Math.max(scores.get(normalized) ?? 0, score));
}

function sourceRunScoresFromLanes(lanes: ReadonlyArray<InterfaceLaneLike>): Map<string, number> {
  const scores = new Map<string, number>();
  for (const lane of lanes) {
    if (lane.id !== 'interface') continue;
    for (const entry of lane.scoredFacts) {
      const sourceScore = Math.max(entry.relevanceScore, entry.score);
      mergeSourceRunScore(scores, entry.fact.sourceRunId, sourceScore);
    }
  }
  return scores;
}

export function recallSourceLinkedInterfaceFacts(
  lanes: ReadonlyArray<InterfaceLaneLike>,
  options: RecallFactsOptions,
): ScoredFact[] {
  const sourceScores = sourceRunScoresFromLanes(lanes);
  if (sourceScores.size === 0) return [];
  const rankedSourceRunIds = Array.from(sourceScores.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(
      0,
      Math.max(1, Math.floor(SOURCE_LINKED_INTERFACE_POOL_LIMIT / SOURCE_LINKED_INTERFACE_PER_SOURCE)),
    )
    .map(([sourceRunId]) => sourceRunId);
  const inventories: MemoryFact[] = [];
  for (const sourceRunId of rankedSourceRunIds) {
    inventories.push(
      ...listFactsForSourceRuns([sourceRunId], {
        memoryKind: 'ui_inventory',
        limit: SOURCE_LINKED_INTERFACE_PER_SOURCE,
        ...(typeof options.now === 'number' ? { asOf: options.now } : {}),
      }),
    );
  }
  if (inventories.length === 0) return [];
  const maxStateIndexBySource = new Map<string, number>();
  for (const fact of inventories) {
    const sourceRunId = fact.sourceRunId ?? '';
    const stateIndex = numericStateIndex(fact);
    maxStateIndexBySource.set(
      sourceRunId,
      Math.max(maxStateIndexBySource.get(sourceRunId) ?? 0, stateIndex),
    );
  }
  return inventories
    .map((fact) => {
      const linkedScore = sourceScores.get(fact.sourceRunId ?? '') ?? 0;
      const stateIndex = numericStateIndex(fact);
      const maxStateIndex = Math.max(1, maxStateIndexBySource.get(fact.sourceRunId ?? '') ?? 1);
      const stateScore = Math.max(0, Math.min(1, stateIndex / maxStateIndex));
      const score = linkedScore + stateScore * 0.1 + fact.retrievability * 0.02 + fact.importance * 0.01;
      return scoredSourceLinkedInterfaceFact({ fact, score });
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.fact.updatedAt - left.fact.updatedAt;
    });
}

function numericStateIndex(fact: MemoryFact): number {
  const raw = fact.attributes.stateIndex;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function mergeSourceLinkedInterfaceFacts<TLane extends InterfaceLaneLike>(
  lane: TLane,
  sourceLinkedFacts: ReadonlyArray<ScoredFact>,
  query: string,
  limit: number,
): TLane {
  if (lane.id !== 'interface' || sourceLinkedFacts.length === 0) return lane;
  const pool = mergeUniqueScoredFactsByScore(
    [...sourceLinkedFacts, ...lane.scoredFacts],
    INTERFACE_SOURCE_POOL_LIMIT,
  );
  const scoredFacts = selectSourceAwareInterfaceFacts(pool, query, limit);
  return {
    ...lane,
    scoredFacts,
    facts: scoredFacts.map((entry) => entry.fact),
    timings: lane.timings
      ? {
          ...lane.timings,
          poolSize: Math.max(lane.timings.poolSize, pool.length),
        }
      : lane.timings,
  };
}
