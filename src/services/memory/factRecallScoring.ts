import { type MemoryFact } from './facts/types';
import { type RecallFactsOptions, type ScoredFact } from './factRecallTypes';
import { exponentialDecayMultiplier } from './ranking/scoring';

const PINNED_BOOST = 0.25;
const RELEVANCE_EPSILON = 1e-6;
const QUOTED_ANCHOR_MATCH_BOOST = 0.18;
const QUOTED_ANCHOR_FULL_MATCH_BOOST = 0.12;
const DISCRIMINATIVE_SCORING_MIN_UNITS = 8;

export function buildQueryUnitWeightsFromHits(
  queryUnits: ReadonlySet<string>,
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

export function selectDiscriminativeScoringUnits(params: {
  scoringUnits: ReadonlySet<string>;
  unitWeights: ReadonlyMap<string, number>;
  anchorLexicalUnits: ReadonlyArray<string>;
}): Set<string> {
  const { scoringUnits, unitWeights, anchorLexicalUnits } = params;
  if (scoringUnits.size <= DISCRIMINATIVE_SCORING_MIN_UNITS) return new Set(scoringUnits);
  const weightedUnits = Array.from(scoringUnits)
    .map((unit) => ({ unit, weight: unitWeights.get(unit) ?? 1 }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.unit.localeCompare(right.unit);
    });
  const weights = weightedUnits.map((entry) => entry.weight).sort((left, right) => left - right);
  const medianWeight = weights[Math.floor(weights.length / 2)] ?? 1;
  const selected = new Set<string>();
  const anchors = new Set(anchorLexicalUnits);
  for (const entry of weightedUnits) {
    if (entry.weight >= medianWeight || anchors.has(entry.unit)) selected.add(entry.unit);
  }
  const minUnits = Math.min(DISCRIMINATIVE_SCORING_MIN_UNITS, scoringUnits.size);
  for (const entry of weightedUnits) {
    if (selected.size >= minUnits) break;
    selected.add(entry.unit);
  }
  return selected;
}

export function buildScoredFact(params: {
  fact: MemoryFact;
  queryUnits: ReadonlySet<string>;
  factUnitHits: ReadonlySet<string> | undefined;
  unitWeights: ReadonlyMap<string, number>;
  anchorUnitSets: ReadonlyArray<Set<string>>;
  query: string;
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
  const lexicalScore = lexicalOverlapFromUnitHits(queryUnits, factUnitHits, params.unitWeights);
  const textScore = lexicalScore;
  const pinnedBoost = alwaysIncludePinned && fact.pinned ? PINNED_BOOST : 0;
  const decayMultiplier = scoreDecay(fact, now);
  const scopeBoost = scoreScope(fact, options);
  const reinforcementBoost = scoreReinforcement(fact);
  const importanceScore = fact.importance * 0.04;
  const retrievabilityScore = scoreRetrievability(fact);
  const relevanceScore = textScore * fact.confidence * decayMultiplier * retrievabilityScore;
  const anchorBoost = anchorMatchBoost(anchorUnitSets, factUnitHits);
  const hasRelevance = relevanceScore > RELEVANCE_EPSILON;
  const score =
    relevanceScore +
    anchorBoost +
    pinnedBoost +
    (hasRelevance || anchorBoost > 0 ? scopeBoost + reinforcementBoost + importanceScore : 0);
  return {
    fact,
    score,
    textScore,
    lexicalScore,
    pinnedBoost,
    decayMultiplier,
    scopeBoost,
    reinforcementBoost,
    importanceScore,
    retrievabilityScore,
    relevanceScore,
  };
}

function lexicalOverlapFromUnitHits(
  queryUnits: ReadonlySet<string>,
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
