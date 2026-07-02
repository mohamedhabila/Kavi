import { selectionDedupeKey, sourceRunStateKey } from './ranking/selection';
import type { ScoredFact } from './factRecallTypes';

const SOURCE_COHERENCE_FACT_LIMIT = 4;
const SOURCE_COHERENCE_DECAY = 0.5;
const SOURCE_COHERENCE_KIND_BONUS = 0.04;
const SOURCE_COHERENCE_KIND_BONUS_MAX = 0.12;
const SOURCE_COHERENCE_OUTCOME_BONUS_MAX = 0.2;
const SOURCE_COHERENCE_MAX_NON_RELEVANCE_EVIDENCE = 0.2;
const SOURCE_COHERENCE_LOCAL_STATE_RADIUS = 4;

interface SourceGroup {
  key: string;
  entries: ScoredFact[];
  score: number;
  bestScore: number;
  firstIndex: number;
}

function sourceGroupKey(entry: ScoredFact): string {
  return entry.fact.sourceRunId ? `source:${entry.fact.sourceRunId}` : `fact:${entry.fact.id}`;
}

function evidenceKey(entry: ScoredFact): string {
  return (
    selectionDedupeKey(entry.fact) ??
    sourceRunStateKey(entry.fact) ??
    `${entry.fact.memoryKind}:${entry.fact.id}`
  );
}

function entryEvidenceScore(entry: ScoredFact): number {
  const relevance = Math.max(entry.relevanceScore, 0);
  const nonRelevanceEvidence = Math.max(entry.score - relevance, 0);
  return (
    relevance +
    Math.min(nonRelevanceEvidence, SOURCE_COHERENCE_MAX_NON_RELEVANCE_EVIDENCE)
  );
}

function numericStateIndex(entry: ScoredFact): number | null {
  const value = entry.fact.attributes.stateIndex ?? entry.fact.attributes.state_index;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function scoreSourceGroup(entries: ReadonlyArray<ScoredFact>): number {
  const seenEvidence = new Set<string>();
  const seenKinds = new Set<string>();
  let score = 0;
  let weight = 1;
  let counted = 0;
  let anchorStateIndex: number | null = null;
  let bestOutcomeEvidence = 0;
  for (const entry of entries) {
    const stateIndex = numericStateIndex(entry);
    if (anchorStateIndex === null && stateIndex !== null) anchorStateIndex = stateIndex;
    if (
      anchorStateIndex !== null &&
      stateIndex !== null &&
      Math.abs(stateIndex - anchorStateIndex) > SOURCE_COHERENCE_LOCAL_STATE_RADIUS
    ) {
      continue;
    }
    const evidenceScore = entryEvidenceScore(entry);
    if (evidenceScore <= 0) continue;
    if (entry.fact.memoryKind === 'outcome' || entry.fact.memoryKind === 'gotcha') {
      bestOutcomeEvidence = Math.max(bestOutcomeEvidence, Math.max(entry.relevanceScore, 0));
    }
    const key = evidenceKey(entry);
    if (seenEvidence.has(key)) continue;
    seenEvidence.add(key);
    seenKinds.add(entry.fact.memoryKind);
    score += evidenceScore * weight;
    weight *= SOURCE_COHERENCE_DECAY;
    counted += 1;
    if (counted >= SOURCE_COHERENCE_FACT_LIMIT) break;
  }
  const kindBonus = Math.min(
    SOURCE_COHERENCE_KIND_BONUS_MAX,
    Math.max(0, seenKinds.size - 1) * SOURCE_COHERENCE_KIND_BONUS,
  );
  const outcomeBonus = Math.min(SOURCE_COHERENCE_OUTCOME_BONUS_MAX, bestOutcomeEvidence);
  return score + kindBonus + outcomeBonus;
}

export function rankSourceCoherentEntries(
  scored: ReadonlyArray<ScoredFact>,
  sourceRunEvidenceRank: ReadonlyMap<string, number> = new Map(),
): ScoredFact[] {
  const groupsByKey = new Map<string, SourceGroup>();
  scored.forEach((entry, index) => {
    const key = sourceGroupKey(entry);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.bestScore = Math.max(existing.bestScore, entry.score);
      return;
    }
    groupsByKey.set(key, {
      key,
      entries: [entry],
      score: 0,
      bestScore: entry.score,
      firstIndex: index,
    });
  });
  const groups = Array.from(groupsByKey.values()).map((group) => ({
    ...group,
    score: scoreSourceGroup(group.entries),
  }));
  groups.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.bestScore !== left.bestScore) return right.bestScore - left.bestScore;
    const leftEvidenceRank = left.key.startsWith('source:')
      ? (sourceRunEvidenceRank.get(left.key.slice('source:'.length)) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const rightEvidenceRank = right.key.startsWith('source:')
      ? (sourceRunEvidenceRank.get(right.key.slice('source:'.length)) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    if (leftEvidenceRank !== rightEvidenceRank) return leftEvidenceRank - rightEvidenceRank;
    return left.firstIndex - right.firstIndex;
  });
  return groups.flatMap((group) => group.entries);
}
