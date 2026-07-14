import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import {
  projectFactFromSurvivingContributions,
  type FactContributionProjection,
} from './facts/factContributionProjection';
import {
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS,
} from './sourceRetirementChildCommitments';
import {
  MEMORY_SOURCE_RETIREMENT_PLAN_VERSION,
  type MemorySourceRetirementFactReactivation,
  type MemorySourceRetirementFactRematerialization,
  type MemorySourceRetirementFactSurvivor,
  type MemorySourceRetirementFactTombstone,
  type MemorySourceRetirementPlan,
  type MemorySourceRetirementPlanInput,
} from './sourceRetirementPlan';
import {
  buildSourceRetirementPlanningGraph,
  compareSourceRetirementIdentity,
  compareSourceRetirementOrdinal,
  sourceRetirementIdentityKey,
  type SourceRetirementAggregateNode,
  type SourceRetirementFactNode,
  type SourceRetirementPlanningGraph,
} from './sourceRetirementPlanningGraph';

interface RetirementClosure {
  closedSourcesByKey: Map<string, Readonly<PersistedExactMemorySourceIdentity>>;
  newlyRetiredContributionIds: Set<string>;
  tombstonedFactIds: Set<string>;
}

function fail(code: string): never {
  throw new Error(code);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function freezeOrdinalIds(values: Iterable<string>): ReadonlyArray<string> {
  return Object.freeze([...values].sort(compareSourceRetirementOrdinal));
}

function closeRetirementGraph(graph: SourceRetirementPlanningGraph): RetirementClosure {
  const closedSourcesByKey = new Map<
    string,
    Readonly<PersistedExactMemorySourceIdentity>
  >();
  const pendingSourceKeys: string[] = [];
  const newlyRetiredContributionIds = new Set<string>();
  const tombstonedFactIds = new Set<string>();
  const pendingTombstonedFactIds: string[] = [];
  const remainingContributionsByFact = new Map<string, number>();
  for (const fact of graph.factsById.values()) {
    remainingContributionsByFact.set(fact.factId, fact.aggregates.length);
  }

  const addClosedSource = (
    source: Readonly<PersistedExactMemorySourceIdentity>,
  ): void => {
    const key = sourceRetirementIdentityKey(source);
    if (closedSourcesByKey.has(key)) return;
    if (
      closedSourcesByKey.size >=
      MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources
    ) {
      fail('memory_source_retirement_plan_resource_limit');
    }
    closedSourcesByKey.set(key, source);
    pendingSourceKeys.push(key);
  };

  const retireContribution = (contributionId: string): void => {
    if (newlyRetiredContributionIds.has(contributionId)) return;
    const node = graph.aggregateById.get(contributionId);
    if (!node) fail('memory_source_retirement_plan_graph_incomplete');
    if (
      newlyRetiredContributionIds.size >=
      MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions
    ) {
      fail('memory_source_retirement_plan_resource_limit');
    }
    newlyRetiredContributionIds.add(contributionId);
    for (const source of node.sources) addClosedSource(source);
    const factId = node.aggregate.factId;
    const remaining = remainingContributionsByFact.get(factId);
    if (remaining === undefined || remaining < 1) {
      fail('memory_source_retirement_plan_graph_invalid');
    }
    const next = remaining - 1;
    remainingContributionsByFact.set(factId, next);
    if (next === 0) {
      if (tombstonedFactIds.size >= MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredFacts) {
        fail('memory_source_retirement_plan_resource_limit');
      }
      tombstonedFactIds.add(factId);
      pendingTombstonedFactIds.push(factId);
    }
  };

  for (const source of graph.requestedSources) addClosedSource(source);
  let sourceCursor = 0;
  let tombstoneCursor = 0;
  while (
    sourceCursor < pendingSourceKeys.length ||
    tombstoneCursor < pendingTombstonedFactIds.length
  ) {
    while (sourceCursor < pendingSourceKeys.length) {
      const sourceKey = pendingSourceKeys[sourceCursor++]!;
      for (const contributionId of graph.aggregateIdsBySource.get(sourceKey) ?? []) {
        retireContribution(contributionId);
      }
    }
    while (tombstoneCursor < pendingTombstonedFactIds.length) {
      const factId = pendingTombstonedFactIds[tombstoneCursor++]!;
      for (const contributionId of
        graph.aggregateIdsByPredecessorFact.get(factId) ?? []) {
        retireContribution(contributionId);
      }
    }
  }
  return { closedSourcesByKey, newlyRetiredContributionIds, tombstonedFactIds };
}

function projectSurvivingFact(
  fact: SourceRetirementFactNode,
  surviving: ReadonlyArray<SourceRetirementAggregateNode>,
): Readonly<FactContributionProjection> {
  const projection = projectFactFromSurvivingContributions({
    factId: fact.factId,
    contributions: surviving.map(({ aggregate }) => ({
      contributionId: aggregate.contributionId,
      contributedAt: aggregate.contributedAt,
      payload: aggregate.payload,
      supersessionSnapshot: aggregate.supersessionPlan.snapshot,
    })),
    classifierContext: fact.classifierContext,
  });
  return deepFreeze(projection);
}

function collectSupersessionTargets(
  aggregateNodes: ReadonlyArray<SourceRetirementAggregateNode>,
  newlyRetiredContributionIds: ReadonlySet<string>,
): {
  survivingTargets: ReadonlySet<string>;
  retiredTargetTimes: ReadonlyMap<string, ReadonlySet<number>>;
} {
  const survivingTargets = new Set<string>();
  const retiredTargetTimes = new Map<string, Set<number>>();
  for (const node of aggregateNodes) {
    const newlyRetired = newlyRetiredContributionIds.has(node.aggregate.contributionId);
    for (const predecessorFactId of node.predecessorFactIds) {
      if (!newlyRetired) {
        survivingTargets.add(predecessorFactId);
        continue;
      }
      const times = retiredTargetTimes.get(predecessorFactId);
      if (times) times.add(node.aggregate.contributedAt);
      else retiredTargetTimes.set(predecessorFactId, new Set([node.aggregate.contributedAt]));
    }
  }
  return { survivingTargets, retiredTargetTimes };
}

function isExactReactivation(input: {
  fact: SourceRetirementFactNode;
  survivingTargets: ReadonlySet<string>;
  retiredTargetTimes: ReadonlyMap<string, ReadonlySet<number>>;
}): boolean {
  const invalidatedAt = input.fact.evidence.invalidAt;
  return (
    invalidatedAt !== null &&
    input.fact.evidence.deletedAt === null &&
    !input.survivingTargets.has(input.fact.factId) &&
    Boolean(input.retiredTargetTimes.get(input.fact.factId)?.has(invalidatedAt))
  );
}

function planFactActions(
  graph: SourceRetirementPlanningGraph,
  closure: RetirementClosure,
): {
  survivors: ReadonlyArray<Readonly<MemorySourceRetirementFactSurvivor>>;
  tombstones: ReadonlyArray<Readonly<MemorySourceRetirementFactTombstone>>;
  reactivations: ReadonlyArray<Readonly<MemorySourceRetirementFactReactivation>>;
  rematerializations: ReadonlyArray<Readonly<MemorySourceRetirementFactRematerialization>>;
} {
  const survivors: MemorySourceRetirementFactSurvivor[] = [];
  const tombstones: MemorySourceRetirementFactTombstone[] = [];
  const reactivations: MemorySourceRetirementFactReactivation[] = [];
  const rematerializations: MemorySourceRetirementFactRematerialization[] = [];
  const { survivingTargets, retiredTargetTimes } = collectSupersessionTargets(
    graph.aggregateNodes,
    closure.newlyRetiredContributionIds,
  );
  const facts = [...graph.factsById.values()].sort((left, right) =>
    compareSourceRetirementOrdinal(left.factId, right.factId),
  );

  for (const fact of facts) {
    const surviving = fact.aggregates.filter(
      (node) => !closure.newlyRetiredContributionIds.has(node.aggregate.contributionId),
    );
    const newlyRetired = fact.aggregates.filter((node) =>
      closure.newlyRetiredContributionIds.has(node.aggregate.contributionId),
    );
    if (surviving.length === 0) {
      if (!closure.tombstonedFactIds.has(fact.factId) || newlyRetired.length === 0) {
        fail('memory_source_retirement_plan_graph_invalid');
      }
      tombstones.push(
        Object.freeze({
          factId: fact.factId,
          newlyRetiredContributionIds: freezeOrdinalIds(
            newlyRetired.map((node) => node.aggregate.contributionId),
          ),
        }),
      );
      continue;
    }
    const survivingContributionIds = freezeOrdinalIds(
      surviving.map((node) => node.aggregate.contributionId),
    );
    if (closure.tombstonedFactIds.has(fact.factId)) {
      fail('memory_source_retirement_plan_graph_invalid');
    }
    survivors.push(Object.freeze({ factId: fact.factId, survivingContributionIds }));
    if (isExactReactivation({ fact, survivingTargets, retiredTargetTimes })) {
      const invalidatedAt = fact.evidence.invalidAt;
      if (invalidatedAt === null) fail('memory_source_retirement_plan_graph_invalid');
      reactivations.push(
        Object.freeze({
          factId: fact.factId,
          invalidatedAt,
          survivingContributionIds,
          projection: projectSurvivingFact(fact, surviving),
        }),
      );
    } else if (newlyRetired.length > 0 && fact.evidence.deletedAt === null) {
      rematerializations.push(
        Object.freeze({
          factId: fact.factId,
          survivingContributionIds,
          projection: projectSurvivingFact(fact, surviving),
        }),
      );
    }
  }
  return {
    survivors: Object.freeze(survivors),
    tombstones: Object.freeze(tombstones),
    reactivations: Object.freeze(reactivations),
    rematerializations: Object.freeze(rematerializations),
  };
}

/**
 * Compute the exact monotonic source/contribution closure and immutable fact mutation plan.
 * No persisted state is read or changed, and no user-authored text participates in closure.
 */
export function planExactSourceRetirement(
  input: MemorySourceRetirementPlanInput,
): Readonly<MemorySourceRetirementPlan> {
  const graph = buildSourceRetirementPlanningGraph(input);
  const closure = closeRetirementGraph(graph);
  const actions = planFactActions(graph, closure);
  const closedSources = [...closure.closedSourcesByKey.values()]
    .map((source) => Object.freeze({ ...source }))
    .sort(compareSourceRetirementIdentity);
  return Object.freeze({
    version: MEMORY_SOURCE_RETIREMENT_PLAN_VERSION,
    requestedSources: Object.freeze(
      graph.requestedSources.map((source) => Object.freeze({ ...source })),
    ),
    closedSources: Object.freeze(closedSources),
    newlyRetiredContributionIds: freezeOrdinalIds(
      closure.newlyRetiredContributionIds,
    ),
    ...actions,
  });
}
