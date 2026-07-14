import type { VerifiedFactContributionAggregate } from './factContributionAggregateTypes';
import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import type { FactContributionProjection } from './facts/factContributionProjection';

export const MEMORY_SOURCE_RETIREMENT_PLAN_VERSION = 1 as const;

/**
 * One closed-world graph can span multiple aggregate-loader pages, but remains bounded for a
 * single atomic retirement operation on a mobile device.
 */
export const MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS = Object.freeze({
  activeAggregates: 4_096,
  facts: 4_096,
  payloadBytes: 32 * 1024 * 1024,
  sourceAliases: 4_096,
  supersessionEdges: 8_192,
});

export interface MemorySourceRetirementPlanInput {
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  /**
   * Complete verified active aggregate graph for the operation. The coordinator must exclude
   * contributions sealed by every earlier retirement group. Every active supersession predecessor
   * must be represented. Database discovery and aggregate loading are outside this pure planner.
   */
  activeAggregates: ReadonlyArray<Readonly<VerifiedFactContributionAggregate>>;
}

export interface MemorySourceRetirementFactSurvivor {
  factId: string;
  survivingContributionIds: ReadonlyArray<string>;
}

export interface MemorySourceRetirementFactTombstone {
  factId: string;
  newlyRetiredContributionIds: ReadonlyArray<string>;
}

export interface MemorySourceRetirementFactReactivation {
  factId: string;
  invalidatedAt: number;
  survivingContributionIds: ReadonlyArray<string>;
  projection: Readonly<FactContributionProjection>;
}

export interface MemorySourceRetirementFactRematerialization {
  factId: string;
  survivingContributionIds: ReadonlyArray<string>;
  projection: Readonly<FactContributionProjection>;
}

/** Immutable, deterministic instructions for a later transactional executor. */
export interface MemorySourceRetirementPlan {
  version: typeof MEMORY_SOURCE_RETIREMENT_PLAN_VERSION;
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  closedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  newlyRetiredContributionIds: ReadonlyArray<string>;
  survivors: ReadonlyArray<Readonly<MemorySourceRetirementFactSurvivor>>;
  tombstones: ReadonlyArray<Readonly<MemorySourceRetirementFactTombstone>>;
  reactivations: ReadonlyArray<Readonly<MemorySourceRetirementFactReactivation>>;
  rematerializations: ReadonlyArray<
    Readonly<MemorySourceRetirementFactRematerialization>
  >;
}
