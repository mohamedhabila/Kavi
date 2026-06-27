import type { RecallFactsOptions, ScoredFact } from './factRecall';
import { listFactsForSourceRuns } from './facts/queries';
import type { MemoryFact } from './facts/types';
import {
  buildQueryUnitWeights,
  lexicalOverlap,
  tokenizeLexicalUnits,
} from './ranking/lexical';
import { retrievalTextForFact } from './ranking/factText';
import { quotedSpanUnitSets } from './ranking/quotedSpans';

export const INTERFACE_SOURCE_POOL_LIMIT = 32;
export const INTERFACE_SOURCE_POOL_MIN = 24;
export const INTERFACE_SOURCE_POOL_MULTIPLIER = 5;

const INTERFACE_SOURCE_GROUP_TOP_FACTS = 6;
const INTERFACE_SOURCE_GROUP_FACT_LIMIT = 3;
const SOURCE_LINKED_INTERFACE_POOL_LIMIT = 32;
const SOURCE_LINKED_INTERFACE_PER_SOURCE = 6;
const QUOTED_SPAN_LIMIT = 12;
const MAX_ANCHOR_SIGNATURE_CONTROLS = 24;

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

function anchorOverlapScore(anchorUnitSets: ReadonlyArray<Set<string>>, text: string): number {
  if (anchorUnitSets.length === 0) return 0;
  let best = 0;
  for (const units of anchorUnitSets) {
    best = Math.max(best, lexicalOverlap(units, text));
  }
  return best;
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

function normalizeSignatureText(value: string): string {
  const units = Array.from(tokenizeLexicalUnits(value)).sort();
  return units.length > 0 ? units.join(' ') : value.normalize('NFKC').trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function anchorEvidenceSignature(
  fact: MemoryFact,
  anchorUnitSets: ReadonlyArray<Set<string>>,
): string | null {
  if (anchorUnitSets.length === 0 || fact.memoryKind !== 'ui_inventory') return null;
  const payload = parseJsonRecord(fact.objectText);
  if (!payload) return null;
  if (Array.isArray(payload.sections)) {
    for (const entry of payload.sections) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const section = entry as Record<string, unknown>;
      if (typeof section.label !== 'string') continue;
      if (anchorOverlapScore(anchorUnitSets, section.label) <= 0) continue;
      const controls = stringArray(section.controlNames)
        .slice(0, MAX_ANCHOR_SIGNATURE_CONTROLS)
        .map(normalizeSignatureText)
        .filter(Boolean)
        .sort();
      return `section:${normalizeSignatureText(section.label)}:${controls.join('|')}`;
    }
  }
  for (const controlName of stringArray(payload.visibleControls ?? payload.controlNames)) {
    if (anchorOverlapScore(anchorUnitSets, controlName) > 0) {
      return `control:${normalizeSignatureText(controlName)}`;
    }
  }
  return null;
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
  const anchorUnitSets = quotedSpanUnitSets(query, QUOTED_SPAN_LIMIT);
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
      const groupText = topEntries.map((entry) => sourceRankingText(entry.fact)).join('\n');
      const coverageScore = lexicalOverlap(
        queryUnits,
        groupText,
        unitWeights,
      );
      const anchorScore = anchorOverlapScore(anchorUnitSets, groupText);
      const contextualAnchorScore = anchorScore * coverageScore;
      const bestScore = Math.max(...topEntries.map((entry) => entry.score));
      const averageScore =
        topEntries.reduce((sum, entry) => sum + entry.score, 0) / Math.max(1, topEntries.length);
      return {
        key,
        entries: rankedEntries,
        score:
          coverageScore * 0.45 +
          bestScore * 0.35 +
          averageScore * 0.1 +
          contextualAnchorScore * 0.1,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.entries[0].fact.updatedAt - left.entries[0].fact.updatedAt;
    });

  const selected: ScoredFact[] = [];
  const seenIds = new Set<string>();
  const selectedPerGroup = new Map<string, number>();
  const selectedAnchorSignatures = new Set<string>();
  const signatureForEntry = (entry: ScoredFact): string | null =>
    anchorEvidenceSignature(entry.fact, anchorUnitSets);
  const addEntry = (groupKey: string, entry: ScoredFact): void => {
    if (selected.length >= limit || seenIds.has(entry.fact.id)) return;
    selected.push(entry);
    seenIds.add(entry.fact.id);
    selectedPerGroup.set(groupKey, (selectedPerGroup.get(groupKey) ?? 0) + 1);
    const signature = signatureForEntry(entry);
    if (signature) selectedAnchorSignatures.add(signature);
  };

  const addFirstFromGroup = (group: (typeof rankedGroups)[number]): void => {
    const first =
      group.entries.find(
        (entry) => entry.fact.memoryKind === 'ui_inventory' && !seenIds.has(entry.fact.id),
      ) ?? group.entries.find((entry) => !seenIds.has(entry.fact.id));
    if (first) addEntry(group.key, first);
  };

  if (anchorUnitSets.length > 0 && rankedGroups.length > 0) {
    addFirstFromGroup(rankedGroups[0]);
    for (const group of rankedGroups) {
      if (selected.length >= limit) return selected;
      const diverseAnchorEntry = group.entries.find((entry) => {
        if (seenIds.has(entry.fact.id)) return false;
        const signature = signatureForEntry(entry);
        return Boolean(signature && !selectedAnchorSignatures.has(signature));
      });
      if (diverseAnchorEntry) addEntry(group.key, diverseAnchorEntry);
    }
  }

  for (const group of rankedGroups) {
    addFirstFromGroup(group);
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
  query: string,
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
  const queryUnits = tokenizeLexicalUnits(query);
  const unitWeights = buildQueryUnitWeights(queryUnits, inventories, sourceRankingText);
  const anchorUnitSets = quotedSpanUnitSets(query, QUOTED_SPAN_LIMIT);
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
      const queryScore =
        queryUnits.size > 0 ? lexicalOverlap(queryUnits, sourceRankingText(fact), unitWeights) : 0;
      const anchorScore = anchorOverlapScore(anchorUnitSets, sourceRankingText(fact));
      const score =
        linkedScore +
        anchorScore * 0.4 +
        queryScore * 0.25 +
        stateScore * 0.03 +
        fact.retrievability * 0.02 +
        fact.importance * 0.01;
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
