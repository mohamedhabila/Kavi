import { lexicalUnitJaccard, tokenizeLexicalUnits } from './lexical';

export interface RankedMemoryFact {
  id: string;
  sourceRunId: string | null;
  attributes: Record<string, unknown>;
}

export interface RankedMemoryFactEntry<TFact extends RankedMemoryFact = RankedMemoryFact> {
  fact: TFact;
  score: number;
  relevanceScore: number;
}

function numericAttribute(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function trajectoryStateIndex(fact: RankedMemoryFact): number | null {
  return numericAttribute(fact.attributes.stateIndex);
}

export function diversifyTrajectoryAware<TEntry extends RankedMemoryFactEntry>(
  scored: TEntry[],
  limit: number,
  options: {
    textForFact: (fact: TEntry['fact']) => string;
    unitsForFact?: (fact: TEntry['fact']) => Set<string> | undefined;
    relevanceEpsilon: number;
    trajectoryNeighborLimit: number;
  },
): TEntry[] {
  const remaining = [...scored];
  const selected: TEntry[] = [];
  const selectedUnits: Array<Set<string>> = [];
  const unitCache = new Map<string, Set<string>>();
  const targetCount = Math.max(limit * 2, limit);

  const unitsFor = (fact: TEntry['fact']): Set<string> => {
    const cached = unitCache.get(fact.id);
    if (cached) return cached;
    const computed = options.unitsForFact?.(fact) ?? tokenizeLexicalUnits(options.textForFact(fact));
    unitCache.set(fact.id, computed);
    return computed;
  };

  const selectEntry = (entry: TEntry): void => {
    selected.push(entry);
    selectedUnits.push(unitsFor(entry.fact));
  };

  const selectedSourceCount = (sourceRunId: string): number =>
    selected.filter((entry) => entry.fact.sourceRunId === sourceRunId).length;

  const selectTrajectoryNeighbors = (anchor: TEntry): void => {
    if (selected.length >= targetCount) return;
    if (!anchor.fact.sourceRunId) return;
    const anchorStateIndex = trajectoryStateIndex(anchor.fact);
    if (anchorStateIndex === null) return;
    const neighborBudget = Math.min(
      options.trajectoryNeighborLimit,
      Math.max(0, targetCount - selected.length),
    );
    if (neighborBudget <= 0) return;

    const selectedStateIndexes = new Set(
      selected
        .filter((entry) => entry.fact.sourceRunId === anchor.fact.sourceRunId)
        .map((entry) => trajectoryStateIndex(entry.fact))
        .filter((stateIndex): stateIndex is number => stateIndex !== null),
    );
    const bestByStateIndex = new Map<
      number,
      { entry: TEntry; stateIndex: number; distance: number }
    >();

    for (const entry of remaining) {
      if (entry.fact.sourceRunId !== anchor.fact.sourceRunId) continue;
      if (entry.relevanceScore <= options.relevanceEpsilon) continue;
      const stateIndex = trajectoryStateIndex(entry.fact);
      if (stateIndex === null || selectedStateIndexes.has(stateIndex)) continue;
      const distance = stateIndex - anchorStateIndex;
      if (distance === 0) continue;
      const existing = bestByStateIndex.get(stateIndex);
      if (!existing || entry.score > existing.entry.score) {
        bestByStateIndex.set(stateIndex, { entry, stateIndex, distance });
      }
    }

    const bySupportStrength = (
      left: { entry: TEntry; distance: number },
      right: { entry: TEntry; distance: number },
    ): number => {
      if (right.entry.score !== left.entry.score) return right.entry.score - left.entry.score;
      const distanceDelta = Math.abs(left.distance) - Math.abs(right.distance);
      if (distanceDelta !== 0) return distanceDelta;
      return 0;
    };
    const byChronologyThenSupport = (
      left: { entry: TEntry; stateIndex: number; distance: number },
      right: { entry: TEntry; stateIndex: number; distance: number },
    ): number => {
      if (left.stateIndex !== right.stateIndex) return left.stateIndex - right.stateIndex;
      return bySupportStrength(left, right);
    };
    const forward = Array.from(bestByStateIndex.values())
      .filter((candidate) => candidate.distance > 0)
      .sort((left, right) => {
        const distanceDelta = left.distance - right.distance;
        if (distanceDelta !== 0) return distanceDelta;
        return bySupportStrength(left, right);
      });
    const priorChronological = Array.from(bestByStateIndex.values())
      .filter((candidate) => candidate.distance < 0)
      .sort(byChronologyThenSupport);
    const priorBySupport = Array.from(bestByStateIndex.values())
      .filter((candidate) => candidate.distance < 0)
      .sort(bySupportStrength);
    const seenNeighborIds = new Set<string>();
    const rankedNeighbors: Array<{ entry: TEntry; stateIndex: number; distance: number }> = [];
    const pushNeighbor = (candidate: { entry: TEntry; stateIndex: number; distance: number }) => {
      if (seenNeighborIds.has(candidate.entry.fact.id)) return;
      rankedNeighbors.push(candidate);
      seenNeighborIds.add(candidate.entry.fact.id);
    };
    for (const candidate of forward.slice(0, 2)) {
      pushNeighbor(candidate);
    }
    for (const candidate of priorChronological.slice(0, 2)) {
      pushNeighbor(candidate);
    }
    for (const candidate of [...forward.slice(2), ...priorBySupport].sort(bySupportStrength)) {
      pushNeighbor(candidate);
    }

    for (const { entry } of rankedNeighbors) {
      if (selected.length >= targetCount) break;
      if (selectedSourceCount(anchor.fact.sourceRunId) - 1 >= neighborBudget) break;
      const index = remaining.findIndex((candidate) => candidate.fact.id === entry.fact.id);
      if (index < 0) continue;
      const [neighbor] = remaining.splice(index, 1);
      selectEntry(neighbor);
    }
  };

  while (remaining.length > 0 && selected.length < targetCount) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateUnits = unitsFor(candidate.fact);
      const redundancy = selectedUnits.length
        ? Math.max(...selectedUnits.map((units) => lexicalUnitJaccard(candidateUnits, units)))
        : 0;
      const mmrScore = candidate.score * 0.82 - redundancy * 0.18;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    selectEntry(picked);
    selectTrajectoryNeighbors(picked);
  }

  return [...selected, ...remaining];
}
