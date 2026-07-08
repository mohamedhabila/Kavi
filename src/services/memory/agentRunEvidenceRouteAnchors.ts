import type { AgentRunStep } from './agentRunEvidenceCompaction';
import {
  agentRunNavigationSurfaceDepth,
  agentRunNavigationSurfaceFamilyKey,
  agentRunNavigationSurfaceKey,
} from './agentRunNavigationSurface';

function spreadIndexes(indexes: ReadonlyArray<number>, limit: number): number[] {
  if (indexes.length <= limit) return [...indexes];
  if (limit <= 1) return indexes[0] === undefined ? [] : [indexes[0]];
  const lastIndex = indexes.length - 1;
  const selected: number[] = [];
  const seen = new Set<number>();
  for (let slot = 0; slot < limit; slot += 1) {
    const sourceIndex = Math.round((slot * lastIndex) / (limit - 1));
    const index = indexes[sourceIndex];
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
    selected.push(index);
  }
  return selected;
}

function minDistanceToSelected(index: number, selected: ReadonlySet<number>): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const selectedIndex of selected) {
    distance = Math.min(distance, Math.abs(index - selectedIndex));
  }
  return distance;
}

function hasObservedStepEvidence(step: AgentRunStep): boolean {
  if (step.observation || step.toolResult) return true;
  if ((step.observedControlSequence?.length ?? 0) > 0) return true;
  return (step.observedAffordances?.length ?? 0) > 0;
}

export function agentRunTransitionStepIndexes(steps: ReadonlyArray<AgentRunStep>): number[] {
  const indexes: number[] = [];
  let previousSurfaceKey: string | undefined;
  let previousTransitionIndex = Number.NEGATIVE_INFINITY;
  steps.forEach((step, index) => {
    const surfaceKey = agentRunNavigationSurfaceKey(step.url);
    if (!surfaceKey || surfaceKey === previousSurfaceKey) return;
    if (index !== previousTransitionIndex + 1) {
      indexes.push(index);
    }
    previousTransitionIndex = index;
    previousSurfaceKey = surfaceKey;
  });
  return indexes;
}

export function agentRunRouteAnchorStepIndexes(
  steps: ReadonlyArray<AgentRunStep>,
  limit: number,
): number[] {
  const selected = new Set<number>();
  const append = (index: number | undefined): void => {
    if (index === undefined || index < 0 || index >= steps.length) return;
    if (selected.size >= limit) return;
    selected.add(index);
  };

  const candidateIndexes = steps
    .map((step, index) => ({ step, index, surfaceKey: agentRunNavigationSurfaceKey(step.url) }))
    .filter((entry) => entry.surfaceKey && hasObservedStepEvidence(entry.step));
  if (candidateIndexes.length === 0) return [];
  const candidateIndexSet = new Set(candidateIndexes.map((entry) => entry.index));

  append(candidateIndexes[0]?.index);
  const surfaceVisits = new Map<string, { first: number; last: number }>();
  candidateIndexes.forEach(({ index, surfaceKey }) => {
    if (!surfaceKey) return;
    const visit = surfaceVisits.get(surfaceKey);
    if (visit) {
      visit.last = index;
    } else {
      surfaceVisits.set(surfaceKey, { first: index, last: index });
    }
  });
  const structuralIndexes = Array.from(
    new Set([
      ...Array.from(surfaceVisits.values()).flatMap((visit) => [visit.first, visit.last]),
      ...agentRunTransitionStepIndexes(steps).filter((index) => candidateIndexSet.has(index)),
      candidateIndexes[candidateIndexes.length - 1]?.index,
    ]),
  ).sort((left, right) => left - right);
  append(candidateIndexes[candidateIndexes.length - 1]?.index);
  for (const index of spreadIndexes(structuralIndexes, Math.max(1, Math.ceil(limit / 2)))) {
    append(index);
  }
  const detailedIndexes = structuralIndexes
    .map((index) => ({
      index,
      depth: agentRunNavigationSurfaceDepth(steps[index]?.url),
      familyKey: agentRunNavigationSurfaceFamilyKey(steps[index]?.url),
    }))
    .filter((entry) => entry.depth > 0)
    .sort((left, right) => left.index - right.index);
  const selectedFamilies = new Set(
    Array.from(selected)
      .map((index) => agentRunNavigationSurfaceFamilyKey(steps[index]?.url))
      .filter((familyKey): familyKey is string => Boolean(familyKey)),
  );
  while (selected.size < limit) {
    const candidates = detailedIndexes.filter((entry) => !selected.has(entry.index));
    if (candidates.length === 0) break;
    const unrepresentedFamilyCandidates = candidates.filter(
      (entry) => entry.familyKey && !selectedFamilies.has(entry.familyKey),
    );
    const pool =
      unrepresentedFamilyCandidates.length > 0 ? unrepresentedFamilyCandidates : candidates;
    const next = pool.sort((left, right) => {
      if (right.depth !== left.depth) return right.depth - left.depth;
      const distanceDelta =
        minDistanceToSelected(right.index, selected) - minDistanceToSelected(left.index, selected);
      if (distanceDelta !== 0) return distanceDelta;
      return left.index - right.index;
    })[0];
    if (!next) break;
    append(next.index);
    if (next.familyKey) selectedFamilies.add(next.familyKey);
  }

  return Array.from(selected).sort((left, right) => left - right);
}
