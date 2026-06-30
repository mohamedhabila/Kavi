import type { MemoryFact } from './facts/types';
import { parseJsonRecord } from './factJson';
import { countLexicalUnits } from './ranking/lexical';
import {
  collectUiObservationSurfaceLabels,
  isUiObservationFact,
} from './uiObservationEvidence';

const UI_SURFACE_LABEL_MATCH_BOOST = 1.0;
const UI_SURFACE_IDENTITY_MIN_SCORE = 0.5;
const UI_SURFACE_IDENTITY_KEEP_RATIO = 0.75;

export interface UiSurfaceScoredFact {
  fact: MemoryFact;
  surfaceIdentityScore: number;
  visibleTextEvidenceBoost?: number;
}

function isActionResultMemory(fact: MemoryFact): boolean {
  return fact.memoryKind === 'outcome' || fact.memoryKind === 'gotcha';
}

export function surfaceLabelMatchBoost(
  fact: MemoryFact,
  queryUnits: ReadonlySet<string>,
  unitWeights: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0) return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!isUiObservationFact(fact, parsed)) return 0;
  const surfaceLabels = collectUiObservationSurfaceLabels(parsed, fact.attributes);
  if (surfaceLabels.length === 0) return 0;
  const surfaceUnits = new Set<string>();
  for (const label of surfaceLabels) {
    if (typeof label !== 'string') continue;
    for (const unit of countLexicalUnits(label).keys()) surfaceUnits.add(unit);
  }
  if (surfaceUnits.size === 0) return 0;
  let matchedWeight = 0;
  let labelWeight = 0;
  for (const unit of surfaceUnits) {
    const weight = unitWeights.get(unit) ?? 1;
    labelWeight += weight;
    if (queryUnits.has(unit)) matchedWeight += weight;
  }
  return labelWeight > 0 ? (matchedWeight / labelWeight) * UI_SURFACE_LABEL_MATCH_BOOST : 0;
}

export function surfaceIdentityScore(
  fact: MemoryFact,
  queryUnits: ReadonlySet<string>,
  unitWeights: ReadonlyMap<string, number>,
): number {
  if (queryUnits.size === 0) return 0;
  const parsed = parseJsonRecord(fact.objectText);
  if (!isUiObservationFact(fact, parsed)) return 0;
  const surfaceLabels = collectUiObservationSurfaceLabels(parsed, fact.attributes);
  if (typeof surfaceLabels[0] !== 'string') return 0;
  const identityUnits = Array.from(countLexicalUnits(surfaceLabels[0]).keys());
  if (identityUnits.length === 0) return 0;
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const unit of identityUnits) {
    const weight = unitWeights.get(unit) ?? 1;
    totalWeight += weight;
    if (queryUnits.has(unit)) matchedWeight += weight;
  }
  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}

export function dominantUiSurfaceIdentityScore(
  scoredFacts: ReadonlyArray<UiSurfaceScoredFact>,
): number {
  let best = 0;
  for (const entry of scoredFacts) {
    if (!isUiObservationFact(entry.fact, parseJsonRecord(entry.fact.objectText))) continue;
    best = Math.max(best, entry.surfaceIdentityScore);
  }
  return best;
}

export function isUiSurfaceIdentityCompatible(
  entry: UiSurfaceScoredFact,
  dominantScore: number,
): boolean {
  if (isActionResultMemory(entry.fact)) return true;
  if (!isUiObservationFact(entry.fact, parseJsonRecord(entry.fact.objectText))) return true;
  if ((entry.visibleTextEvidenceBoost ?? 0) > 0) return true;
  if (dominantScore < UI_SURFACE_IDENTITY_MIN_SCORE) return true;
  return entry.surfaceIdentityScore >= dominantScore * UI_SURFACE_IDENTITY_KEEP_RATIO;
}

export function pruneUiSurfaceIdentityConflicts<T extends UiSurfaceScoredFact>(
  selected: ReadonlyArray<MemoryFact>,
  scoredById: ReadonlyMap<string, T>,
): MemoryFact[] {
  const dominantScore = selectedUiSurfaceIdentityScore(selected, scoredById);
  if (dominantScore < UI_SURFACE_IDENTITY_MIN_SCORE) return [...selected];
  return selected.filter((fact) => {
    if (isActionResultMemory(fact)) return true;
    if (!isUiObservationFact(fact, parseJsonRecord(fact.objectText))) return true;
    const scoredFact = scoredById.get(fact.id);
    if (!scoredFact) return true;
    return isUiSurfaceIdentityCompatible(scoredFact, dominantScore);
  });
}

export function selectedUiSurfaceIdentityScore<T extends UiSurfaceScoredFact>(
  selected: ReadonlyArray<MemoryFact>,
  scoredById: ReadonlyMap<string, T>,
): number {
  let dominantScore = 0;
  for (const fact of selected) {
    if (!isUiObservationFact(fact, parseJsonRecord(fact.objectText))) continue;
    dominantScore = Math.max(dominantScore, scoredById.get(fact.id)?.surfaceIdentityScore ?? 0);
  }
  return dominantScore;
}
