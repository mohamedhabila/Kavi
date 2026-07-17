import { MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES } from './factContributionChildCommitments';
import {
  encodeMemoryFactContributionPayload,
  MEMORY_FACT_CONTRIBUTION_LIMITS,
} from './factContributionCodec';
import type {
  FactContributionFactEvidence,
  VerifiedFactContributionAggregate,
} from './factContributionAggregateTypes';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import type {
  FactContributionClassifierContext,
  FactContributionExplicitProjection,
} from './facts/factContributionProjection';
import {
  requireExactMemorySourceKind,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { maxMemoryFactSensitivity } from './memorySensitivityPolicy';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import {
  MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS,
  type MemorySourceRetirementPlanInput,
} from './sourceRetirementPlan';

const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;
const PLAN_INPUT_KEYS = ['activeAggregates', 'requestedSources'] as const;
const SOURCE_KEYS = [
  'memoryOwnerId',
  'memoryConversationId',
  'sourceThreadId',
  'taskId',
  'sourceKind',
  'sourceId',
] as const;
const EXPLICIT_PROJECTION_KEYS = [
  'explicitInvalidatedAt',
  'pinnedOverride',
  'reviewStateOverride',
  'sensitivityFloor',
] as const;

export interface SourceRetirementAggregateNode {
  aggregate: Readonly<VerifiedFactContributionAggregate>;
  sources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  predecessorFactIds: ReadonlyArray<string>;
}

export interface SourceRetirementFactNode {
  factId: string;
  aggregates: SourceRetirementAggregateNode[];
  evidence: Readonly<FactContributionFactEvidence>;
  classifierContext: Readonly<FactContributionClassifierContext>;
  explicitProjection: Readonly<FactContributionExplicitProjection> | null;
}

export interface SourceRetirementPlanningGraph {
  memoryOwnerId: string;
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  aggregateNodes: ReadonlyArray<SourceRetirementAggregateNode>;
  aggregateById: ReadonlyMap<string, SourceRetirementAggregateNode>;
  aggregateIdsBySource: ReadonlyMap<string, ReadonlyArray<string>>;
  aggregateIdsByPredecessorFact: ReadonlyMap<string, ReadonlyArray<string>>;
  factsById: ReadonlyMap<string, SourceRetirementFactNode>;
}

function fail(code: string): never {
  throw new Error(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function compareSourceRetirementOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSource(
  left: Readonly<PersistedExactMemorySourceIdentity>,
  right: Readonly<PersistedExactMemorySourceIdentity>,
): number {
  for (const key of SOURCE_KEYS) {
    const compared = compareSourceRetirementOrdinal(left[key], right[key]);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function sourceRetirementIdentityKey(
  source: Readonly<PersistedExactMemorySourceIdentity>,
): string {
  return JSON.stringify(SOURCE_KEYS.map((key) => source[key]));
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  return value as number;
}

function requireNullableTimestamp(value: unknown): number | null {
  return value === null ? null : requireTimestamp(value);
}

function requireContributionId(value: unknown): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value)) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  return value;
}

function requireFactId(value: unknown): string {
  if (!isExactMemoryProvenanceId(value)) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  return value;
}

function requirePersistedSource(value: unknown, code: string): PersistedExactMemorySourceIdentity {
  if (!isPlainRecord(value) || !hasExactKeys(value, SOURCE_KEYS)) fail(code);
  if (
    !isExactMemoryScopeId(value.memoryOwnerId) ||
    !isExactMemoryScopeId(value.memoryConversationId) ||
    !isExactMemoryScopeId(value.sourceThreadId) ||
    (value.taskId !== '' && !isExactMemoryScopeId(value.taskId)) ||
    !isExactMemoryProvenanceId(value.sourceId)
  ) {
    fail(code);
  }
  return {
    memoryOwnerId: value.memoryOwnerId,
    memoryConversationId: value.memoryConversationId,
    sourceThreadId: value.sourceThreadId,
    taskId: value.taskId,
    sourceKind: requireExactMemorySourceKind(value.sourceKind, code),
    sourceId: value.sourceId,
  };
}

function normalizeRequestedSources(
  value: unknown,
): ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>> {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources
  ) {
    fail('memory_source_retirement_plan_request_invalid');
  }
  const seen = new Set<string>();
  let memoryOwnerId: string | null = null;
  const sources = value.map((candidate) => {
    const source = requirePersistedSource(
      candidate,
      'memory_source_retirement_plan_request_invalid',
    );
    const key = sourceRetirementIdentityKey(source);
    if (seen.has(key) || (memoryOwnerId !== null && source.memoryOwnerId !== memoryOwnerId)) {
      fail('memory_source_retirement_plan_request_invalid');
    }
    memoryOwnerId = source.memoryOwnerId;
    seen.add(key);
    return Object.freeze(source);
  });
  return Object.freeze(sources.sort(compareSource));
}

function exactFactEvidenceMatches(
  left: Readonly<FactContributionFactEvidence>,
  right: Readonly<FactContributionFactEvidence>,
): boolean {
  return (
    left.id === right.id &&
    left.memoryOwnerId === right.memoryOwnerId &&
    left.memoryKind === right.memoryKind &&
    left.scope === right.scope &&
    left.originConversationId === right.originConversationId &&
    left.originThreadId === right.originThreadId &&
    left.originTaskId === right.originTaskId &&
    left.personaId === right.personaId &&
    left.subjectId === right.subjectId &&
    left.predicate === right.predicate &&
    left.objectText === right.objectText &&
    left.objectEntityId === right.objectEntityId &&
    left.createdAt === right.createdAt &&
    left.invalidAt === right.invalidAt &&
    left.deletedAt === right.deletedAt &&
    left.pinned === right.pinned &&
    left.reviewState === right.reviewState &&
    left.sensitivity === right.sensitivity &&
    left.sensitivityPolicyVersion === right.sensitivityPolicyVersion
  );
}

function exactExplicitProjectionMatches(
  left: Readonly<FactContributionExplicitProjection> | null,
  right: Readonly<FactContributionExplicitProjection> | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.pinnedOverride === right.pinnedOverride &&
    left.reviewStateOverride === right.reviewStateOverride &&
    left.sensitivityFloor === right.sensitivityFloor &&
    left.explicitInvalidatedAt === right.explicitInvalidatedAt
  );
}

function assertFactEvidence(aggregate: Readonly<VerifiedFactContributionAggregate>): void {
  const fact = aggregate.factEvidence;
  if (
    !fact ||
    fact.id !== aggregate.factId ||
    fact.memoryOwnerId !== aggregate.memoryOwnerId ||
    fact.createdAt > aggregate.contributedAt ||
    requireNullableTimestamp(fact.invalidAt) !== fact.invalidAt ||
    requireNullableTimestamp(fact.deletedAt) !== fact.deletedAt
  ) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  const context = aggregate.classifierContext;
  if (!context || (context.subject !== null && typeof context.subject !== 'string')) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  const explicit = aggregate.explicitProjection;
  if (explicit === null) return;
  if (
    !isPlainRecord(explicit) ||
    !hasExactKeys(explicit, EXPLICIT_PROJECTION_KEYS) ||
    (explicit.pinnedOverride !== null && typeof explicit.pinnedOverride !== 'boolean') ||
    (explicit.reviewStateOverride !== null &&
      !closedMemoryFactReviewState(explicit.reviewStateOverride)) ||
    (explicit.sensitivityFloor !== null &&
      !closedMemoryFactSensitivity(explicit.sensitivityFloor)) ||
    (explicit.explicitInvalidatedAt !== null &&
      (!Number.isSafeInteger(explicit.explicitInvalidatedAt) ||
        explicit.explicitInvalidatedAt < 0)) ||
    (explicit.pinnedOverride !== null && explicit.pinnedOverride !== fact.pinned) ||
    (explicit.reviewStateOverride !== null && explicit.reviewStateOverride !== fact.reviewState) ||
    (explicit.sensitivityFloor !== null &&
      maxMemoryFactSensitivity(fact.sensitivity, explicit.sensitivityFloor) !== fact.sensitivity) ||
    (explicit.explicitInvalidatedAt !== null && explicit.explicitInvalidatedAt !== fact.invalidAt)
  ) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
}

function sourcesForAggregate(
  aggregate: Readonly<VerifiedFactContributionAggregate>,
): ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>> {
  const scope = aggregate.sourceScope;
  if (
    !scope ||
    scope.memoryOwnerId !== aggregate.memoryOwnerId ||
    !isExactMemoryScopeId(scope.memoryOwnerId) ||
    !isExactMemoryScopeId(scope.memoryConversationId) ||
    !isExactMemoryScopeId(scope.sourceThreadId) ||
    (scope.taskId !== '' && !isExactMemoryScopeId(scope.taskId)) ||
    !Array.isArray(aggregate.sourceAliases) ||
    aggregate.sourceAliases.length < 1 ||
    aggregate.sourceAliases.length > MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases
  ) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  const seen = new Set<string>();
  const sources = aggregate.sourceAliases.map((alias) => {
    if (!isPlainRecord(alias)) {
      fail('memory_source_retirement_plan_aggregate_invalid');
    }
    const source = requirePersistedSource(
      {
        memoryOwnerId: scope.memoryOwnerId,
        memoryConversationId: scope.memoryConversationId,
        sourceThreadId: scope.sourceThreadId,
        taskId: scope.taskId,
        sourceKind: alias.sourceKind,
        sourceId: alias.sourceId,
      },
      'memory_source_retirement_plan_aggregate_invalid',
    );
    const key = sourceRetirementIdentityKey(source);
    if (seen.has(key)) fail('memory_source_retirement_plan_aggregate_invalid');
    seen.add(key);
    return Object.freeze(source);
  });
  return Object.freeze(sources.sort(compareSource));
}

function predecessorsForAggregate(
  aggregate: Readonly<VerifiedFactContributionAggregate>,
): ReadonlyArray<string> {
  const plan = aggregate.supersessionPlan;
  if (
    !plan ||
    plan.contributionId !== aggregate.contributionId ||
    !Array.isArray(plan.edges) ||
    plan.edges.length > MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES ||
    (plan.edges.length > 0 && plan.snapshot === null)
  ) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  const seen = new Set<string>();
  const predecessors = plan.edges.map((edge) => {
    if (!isPlainRecord(edge)) {
      fail('memory_source_retirement_plan_aggregate_invalid');
    }
    const predecessorFactId = requireFactId(edge.predecessor_fact_id);
    if (
      edge.contribution_id !== aggregate.contributionId ||
      edge.successor_fact_id !== aggregate.factId ||
      edge.superseded_at !== aggregate.contributedAt ||
      predecessorFactId === aggregate.factId ||
      seen.has(predecessorFactId)
    ) {
      fail('memory_source_retirement_plan_aggregate_invalid');
    }
    seen.add(predecessorFactId);
    return predecessorFactId;
  });
  return Object.freeze(predecessors.sort(compareSourceRetirementOrdinal));
}

function addIndexValue(index: Map<string, string[]>, key: string, value: string): void {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function freezeIndex(index: Map<string, string[]>): ReadonlyMap<string, ReadonlyArray<string>> {
  for (const [key, values] of index) {
    index.set(key, Object.freeze(values.sort(compareSourceRetirementOrdinal)) as string[]);
  }
  return index;
}

/** Build the bounded closed-world indexes used by the pure fixed-point planner. */
export function buildSourceRetirementPlanningGraph(
  input: MemorySourceRetirementPlanInput,
): SourceRetirementPlanningGraph {
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, PLAN_INPUT_KEYS) ||
    !Array.isArray(input.activeAggregates)
  ) {
    fail('memory_source_retirement_plan_input_invalid');
  }
  const requestedSources = normalizeRequestedSources(input.requestedSources);
  if (input.activeAggregates.length > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.activeAggregates) {
    fail('memory_source_retirement_plan_resource_limit');
  }
  const memoryOwnerId = requestedSources[0]!.memoryOwnerId;
  const aggregateById = new Map<string, SourceRetirementAggregateNode>();
  const aggregateIdsBySource = new Map<string, string[]>();
  const aggregateIdsByPredecessorFact = new Map<string, string[]>();
  const factsById = new Map<string, SourceRetirementFactNode>();
  let sourceAliasCount = 0;
  let supersessionEdgeCount = 0;
  let payloadBytes = 0;

  if (input.activeAggregates.some((aggregate) => !aggregate || typeof aggregate !== 'object')) {
    fail('memory_source_retirement_plan_aggregate_invalid');
  }
  const orderedAggregates = [...input.activeAggregates].sort(
    (left, right) =>
      left.contributedAt - right.contributedAt ||
      compareSourceRetirementOrdinal(left.contributionId, right.contributionId),
  );
  const aggregateNodes: SourceRetirementAggregateNode[] = [];
  for (const aggregate of orderedAggregates) {
    if (!aggregate || typeof aggregate !== 'object') {
      fail('memory_source_retirement_plan_aggregate_invalid');
    }
    const contributionId = requireContributionId(aggregate.contributionId);
    const factId = requireFactId(aggregate.factId);
    const encodedPayload = encodeMemoryFactContributionPayload(aggregate.payload);
    if (
      aggregate.memoryOwnerId !== memoryOwnerId ||
      !isExactMemoryScopeId(aggregate.memoryOwnerId) ||
      aggregateById.has(contributionId) ||
      requireTimestamp(aggregate.contributedAt) !== aggregate.contributedAt ||
      aggregate.payload.input.now !== aggregate.contributedAt
    ) {
      fail('memory_source_retirement_plan_aggregate_invalid');
    }
    assertFactEvidence(aggregate);
    payloadBytes += encodedPayload.payloadByteLength;
    const sources = sourcesForAggregate(aggregate);
    const predecessorFactIds = predecessorsForAggregate(aggregate);
    sourceAliasCount += sources.length;
    supersessionEdgeCount += predecessorFactIds.length;
    if (
      payloadBytes > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.payloadBytes ||
      sourceAliasCount > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.sourceAliases ||
      supersessionEdgeCount > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.supersessionEdges
    ) {
      fail('memory_source_retirement_plan_resource_limit');
    }
    const node = Object.freeze({ aggregate, sources, predecessorFactIds });
    aggregateNodes.push(node);
    aggregateById.set(contributionId, node);
    for (const source of sources) {
      addIndexValue(aggregateIdsBySource, sourceRetirementIdentityKey(source), contributionId);
    }
    for (const predecessorFactId of predecessorFactIds) {
      addIndexValue(aggregateIdsByPredecessorFact, predecessorFactId, contributionId);
    }
    const factNode = factsById.get(factId);
    if (factNode) {
      if (
        !exactFactEvidenceMatches(factNode.evidence, aggregate.factEvidence) ||
        factNode.classifierContext.subject !== aggregate.classifierContext.subject ||
        !exactExplicitProjectionMatches(factNode.explicitProjection, aggregate.explicitProjection)
      ) {
        fail('memory_source_retirement_plan_aggregate_invalid');
      }
      factNode.aggregates.push(node);
    } else {
      factsById.set(factId, {
        factId,
        aggregates: [node],
        evidence: aggregate.factEvidence,
        classifierContext: aggregate.classifierContext,
        explicitProjection: aggregate.explicitProjection,
      });
      if (factsById.size > MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.facts) {
        fail('memory_source_retirement_plan_resource_limit');
      }
    }
  }

  for (const node of aggregateNodes) {
    for (const predecessorFactId of node.predecessorFactIds) {
      const predecessor = factsById.get(predecessorFactId);
      if (!predecessor) fail('memory_source_retirement_plan_graph_incomplete');
      if (
        predecessor.evidence.invalidAt !== node.aggregate.contributedAt ||
        predecessor.evidence.deletedAt !== null
      ) {
        fail('memory_source_retirement_plan_aggregate_invalid');
      }
    }
  }
  for (const fact of factsById.values()) {
    fact.aggregates.sort((left, right) =>
      compareSourceRetirementOrdinal(left.aggregate.contributionId, right.aggregate.contributionId),
    );
    Object.freeze(fact.aggregates);
    Object.freeze(fact);
  }
  return Object.freeze({
    memoryOwnerId,
    requestedSources,
    aggregateNodes: Object.freeze(aggregateNodes),
    aggregateById,
    aggregateIdsBySource: freezeIndex(aggregateIdsBySource),
    aggregateIdsByPredecessorFact: freezeIndex(aggregateIdsByPredecessorFact),
    factsById,
  });
}

export function compareSourceRetirementIdentity(
  left: Readonly<PersistedExactMemorySourceIdentity>,
  right: Readonly<PersistedExactMemorySourceIdentity>,
): number {
  return compareSource(left, right);
}
