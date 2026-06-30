import type { MemoryFact, MemoryFactKind } from './facts/types';

const SOURCE_RUN_CANDIDATE_SOURCE_LIMIT = 12;

export const SOURCE_RUN_CANDIDATE_FACTS_PER_SOURCE = 3;

export const SOURCE_RUN_CANDIDATE_EXPANSION_KINDS: MemoryFactKind[] = [
  'ui_inventory',
  'ui_field',
  'ui_filter_state',
  'outcome',
];

export function sourceRunIdsForLocalExpansion(facts: ReadonlyArray<MemoryFact>): string[] {
  const groups = new Map<string, { sourceRunId: string; count: number; firstIndex: number }>();
  facts.forEach((fact, index) => {
    if (!fact.sourceRunId) return;
    const existing = groups.get(fact.sourceRunId);
    if (existing) {
      existing.count += 1;
      return;
    }
    groups.set(fact.sourceRunId, {
      sourceRunId: fact.sourceRunId,
      count: 1,
      firstIndex: index,
    });
  });
  return Array.from(groups.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.firstIndex - right.firstIndex;
    })
    .slice(0, SOURCE_RUN_CANDIDATE_SOURCE_LIMIT)
    .map((group) => group.sourceRunId);
}
