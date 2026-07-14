import type { MemoryDatabase } from './access/schemaGuard';
import {
  assertFactContributionSourceChildCommitment,
  type FactContributionAdmissionSourceRow,
  type FactContributionAdmissionSupersessionRow,
  type FactContributionAdmissionSupersessionSnapshotRow,
} from './factContributionAdmissionCommitments';
import {
  MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES,
  type MemoryFactContributionChildCommitment,
} from './factContributionChildCommitments';
import {
  buildMemoryFactContributionId,
  decodeMemoryFactContributionPayload,
  MEMORY_FACT_CONTRIBUTION_LIMITS,
  normalizeMemoryFactContributionSourceScope,
  requireMemoryFactContributionProducerIdentity,
  type MemoryFactContributionPayloadV1,
  type MemoryFactContributionSourceAlias,
  type MemoryFactContributionSourceScope,
} from './factContributionCodec';
import {
  assertFactContributionSupersessionOperation,
  type FactContributionSupersessionPlan,
} from './factContributionSupersessionStore';
import {
  hasMatchingFactSupersessionScope,
  sqliteNoCaseEquals,
} from './factContributionSupersessionRelations';
import {
  loadRawContributionAggregateRows,
  loadRawContributionEvidenceBudget,
  loadRawContributionParents,
  type RawContributionParentRow,
  type RawContributionSourceRow,
  type RawFactEvidenceRow,
  type RawPredecessorEvidenceRow,
  type RawSupersessionEdgeRow,
  type RawSupersessionSnapshotRow,
} from './factContributionAggregateQueries';
import {
  assertFactContributionEvidenceResourceBudget,
  VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS,
} from './factContributionAggregateResourceBudget';
import type {
  FactContributionFactEvidence,
  FactContributionPredecessorEvidence,
  NormalizedContributionParent,
  VerifiedFactContributionAggregate,
  VerifiedFactContributionLoadResult,
} from './factContributionAggregateTypes';
import {
  requireFactContributionExplicitProjection,
  requireFactContributionExplicitProjectionForReplay,
} from './factContributionExplicitProjection';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import type {
  FactContributionClassifierContext,
  FactContributionExplicitProjection,
} from './facts/factContributionProjection';
import { isMemoryFactScope, normalizeFactKind } from './facts/types';
import {
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from './memorySensitivityPolicy';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function fail(code = 'memory_fact_contribution_aggregate_integrity_invalid'): never {
  throw new Error(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireContributionId(value: unknown): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value)) return fail();
  return value;
}

function requireFactId(value: unknown): string {
  if (!isExactMemoryProvenanceId(value)) return fail();
  return value;
}

function requireScopeId(value: unknown): string {
  if (!isExactMemoryScopeId(value)) return fail();
  return value;
}

function requireNullableScopeId(value: unknown): string | null {
  if (value === null) return null;
  return requireScopeId(value);
}

function requireNullableFactId(value: unknown): string | null {
  if (value === null) return null;
  return requireFactId(value);
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') return fail();
  return value;
}

function freezeJsonValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJsonValue(child);
  return Object.freeze(value);
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail();
  return value as number;
}

function requireNullableTimestamp(value: unknown): number | null {
  if (value === null) return null;
  return requireTimestamp(value);
}

function requireCommitment(input: {
  version: unknown;
  count: unknown;
  sha256: unknown;
  kind: 'source' | 'supersession';
}): MemoryFactContributionChildCommitment {
  const validCount =
    input.kind === 'source'
      ? Number.isSafeInteger(input.count) &&
        (input.count as number) >= 1 &&
        (input.count as number) <= MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases
      : Number.isSafeInteger(input.count) &&
        (input.count === 0 ||
          ((input.count as number) >= 2 &&
            (input.count as number) <= MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES + 1));
  if (
    input.version !== 1 ||
    !validCount ||
    typeof input.sha256 !== 'string' ||
    !SHA256_PATTERN.test(input.sha256)
  ) {
    return fail();
  }
  return Object.freeze({ version: 1, count: input.count as number, sha256: input.sha256 });
}

function assertPayloadScope(
  payload: MemoryFactContributionPayloadV1,
  scope: MemoryFactContributionSourceScope,
): void {
  const fact = payload.input;
  if (fact.scope === 'global' || fact.scope === 'persona') return;
  if (
    fact.originConversationId !== scope.memoryConversationId ||
    (fact.originThreadId !== null && fact.originThreadId !== scope.sourceThreadId) ||
    (fact.scope === 'session' && fact.originTaskId !== scope.taskId)
  ) {
    fail();
  }
}

function normalizeParent(
  row: RawContributionParentRow,
  localOwnerId: string,
): NormalizedContributionParent {
  const id = requireContributionId(row.id);
  const factId = requireFactId(row.fact_id);
  const taskId = requireString(row.task_id);
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: requireScopeId(row.memory_owner_id),
    memoryConversationId: requireScopeId(row.memory_conversation_id),
    sourceThreadId: requireScopeId(row.source_thread_id),
    taskId,
  });
  if (scope.memoryOwnerId !== localOwnerId || scope.taskId !== taskId) return fail();
  const producer = requireMemoryFactContributionProducerIdentity({
    producerId: row.producer_id,
    producerEventId: row.producer_event_id,
  });
  if (buildMemoryFactContributionId({ scope, producer }) !== id) return fail();
  const sourceCommitment = requireCommitment({
    version: row.source_set_version,
    count: row.source_set_count,
    sha256: row.source_set_sha256,
    kind: 'source',
  });
  const supersessionCommitment = requireCommitment({
    version: row.supersession_set_version,
    count: row.supersession_set_count,
    sha256: row.supersession_set_sha256,
    kind: 'supersession',
  });
  const payloadByteLength = row.payload_byte_length;
  if (
    !Number.isSafeInteger(payloadByteLength) ||
    (payloadByteLength as number) < 1 ||
    (payloadByteLength as number) > MEMORY_FACT_CONTRIBUTION_LIMITS.payloadBytes
  ) {
    return fail();
  }
  const payload = freezeJsonValue(
    decodeMemoryFactContributionPayload({
      payloadVersion: row.payload_version,
      payloadJson: row.payload_json,
      payloadSha256: row.payload_sha256,
      payloadByteLength,
    }),
  );
  const contributedAt = requireTimestamp(row.contributed_at);
  if (payload.input.now !== contributedAt) return fail();
  assertPayloadScope(payload, scope);
  return {
    id,
    factId,
    memoryOwnerId: localOwnerId,
    scope,
    producer,
    sourceCommitment,
    supersessionCommitment,
    payload,
    payloadByteLength: payloadByteLength as number,
    contributedAt,
  };
}

function requireSourceRow(row: RawContributionSourceRow): FactContributionAdmissionSourceRow {
  return {
    contribution_id: requireContributionId(row.contribution_id),
    memory_owner_id: requireScopeId(row.memory_owner_id),
    memory_conversation_id: requireScopeId(row.memory_conversation_id),
    source_thread_id: requireScopeId(row.source_thread_id),
    task_id: requireString(row.task_id),
    source_kind: requireString(row.source_kind),
    source_id: requireFactId(row.source_id),
  };
}

function requireSnapshotRow(
  row: RawSupersessionSnapshotRow,
): FactContributionAdmissionSupersessionSnapshotRow {
  return { ...row } as FactContributionAdmissionSupersessionSnapshotRow;
}

function requireEdgeRow(row: RawSupersessionEdgeRow): FactContributionAdmissionSupersessionRow {
  return { ...row } as FactContributionAdmissionSupersessionRow;
}

function requireFactEvidence(
  row: RawFactEvidenceRow,
  allowRepairableProjectionDrift: boolean,
): {
  evidence: FactContributionFactEvidence;
  classifierContext: FactContributionClassifierContext;
  explicitProjection: Readonly<FactContributionExplicitProjection> | null;
} {
  const scope = isMemoryFactScope(row.scope) ? row.scope : fail();
  const memoryKind = normalizeFactKind(row.memory_kind);
  if (memoryKind !== row.memory_kind) return fail();
  const pinned = row.pinned === 0 ? false : row.pinned === 1 ? true : fail();
  const reviewState = closedMemoryFactReviewState(row.review_state) ?? fail();
  const sensitivity = closedMemoryFactSensitivity(row.sensitivity) ?? fail();
  const sensitivityPolicyVersion = requireTimestamp(row.sensitivity_policy_version);
  if (
    sensitivityPolicyVersion < 1 ||
    sensitivityPolicyVersion > MEMORY_FACT_SENSITIVITY_POLICY_VERSION
  ) {
    return fail();
  }
  const subjectName = row.subject_name === null ? null : requireString(row.subject_name);
  const subjectType = row.subject_type === null ? null : requireString(row.subject_type);
  if ((subjectName === null) !== (subjectType === null)) return fail();
  const evidence = Object.freeze({
    id: requireFactId(row.id),
    memoryOwnerId: requireScopeId(row.memory_owner_id),
    memoryKind,
    scope,
    originConversationId: requireNullableScopeId(row.origin_conversation_id),
    originThreadId: requireNullableScopeId(row.origin_thread_id),
    originTaskId: requireNullableScopeId(row.origin_task_id),
    personaId: requireNullableScopeId(row.persona_id),
    subjectId: requireFactId(row.subject_id),
    predicate: requireString(row.predicate),
    objectText: requireString(row.object_text),
    objectEntityId: requireNullableFactId(row.object_entity_id),
    createdAt: requireTimestamp(row.created_at),
    invalidAt: requireNullableTimestamp(row.invalid_at),
    deletedAt: requireNullableTimestamp(row.deleted_at),
    pinned,
    reviewState,
    sensitivity,
    sensitivityPolicyVersion,
  });
  return {
    evidence,
    classifierContext: Object.freeze({ subject: subjectName, subjectType }),
    explicitProjection: allowRepairableProjectionDrift
      ? requireFactContributionExplicitProjectionForReplay(row, evidence)
      : requireFactContributionExplicitProjection(row, evidence),
  };
}

function requirePredecessorEvidence(
  row: RawPredecessorEvidenceRow,
): FactContributionPredecessorEvidence {
  return Object.freeze({
    id: requireFactId(row.id),
    memoryOwnerId: requireScopeId(row.memory_owner_id),
    subjectId: requireFactId(row.subject_id),
    predicate: requireString(row.predicate),
    scope: isMemoryFactScope(row.scope) ? row.scope : fail(),
    personaId: requireNullableScopeId(row.persona_id),
    originConversationId: requireNullableScopeId(row.origin_conversation_id),
    originThreadId: requireNullableScopeId(row.origin_thread_id),
    originTaskId: requireNullableScopeId(row.origin_task_id),
    invalidAt: requireNullableTimestamp(row.invalid_at),
    deletedAt: requireNullableTimestamp(row.deleted_at),
  });
}

function exactAliasKey(alias: MemoryFactContributionSourceAlias): string {
  return `${alias.sourceKind}\u0000${alias.sourceId}`;
}

function assertPayloadAliases(
  payload: MemoryFactContributionPayloadV1,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): void {
  const keys = new Set(aliases.map(exactAliasKey));
  for (const required of [
    { sourceKind: 'message' as const, sourceId: payload.input.sourceMessageId },
    { sourceKind: 'turn' as const, sourceId: payload.input.sourceTurnId },
    { sourceKind: 'run' as const, sourceId: payload.input.sourceRunId },
  ]) {
    if (
      required.sourceId !== null &&
      !keys.has(exactAliasKey(required as MemoryFactContributionSourceAlias))
    ) {
      fail();
    }
  }
}

function assertFactIdentity(
  parent: NormalizedContributionParent,
  fact: FactContributionFactEvidence,
): void {
  if (
    fact.id !== parent.factId ||
    fact.memoryOwnerId !== parent.memoryOwnerId ||
    fact.createdAt > parent.contributedAt ||
    !hasExactFactContentIdentity(
      {
        memoryOwnerId: fact.memoryOwnerId,
        memoryKind: fact.memoryKind,
        scope: fact.scope,
        originConversationId: fact.originConversationId,
        originThreadId: fact.originThreadId,
        originTaskId: fact.originTaskId,
        personaId: fact.personaId,
        subjectId: fact.subjectId,
        predicate: fact.predicate,
        objectText: fact.objectText,
        objectEntityId: fact.objectEntityId,
      },
      {
        ...parent.payload.input,
        memoryOwnerId: parent.memoryOwnerId,
        personaId: parent.payload.applicability.personaId,
      },
    )
  ) {
    fail();
  }
}

function assertSnapshotProjection(
  parent: NormalizedContributionParent,
  fact: FactContributionFactEvidence,
  snapshot: FactContributionAdmissionSupersessionSnapshotRow | null,
): void {
  if (!snapshot) return;
  const reviewState = closedMemoryFactReviewState(snapshot.successor_review_state_baseline);
  const sensitivityFloor = closedMemoryFactSensitivity(snapshot.successor_sensitivity_floor);
  const protectedSensitivity =
    fact.sensitivityPolicyVersion === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
      ? fact.sensitivity
      : 'restricted';
  if (
    snapshot.contribution_id !== parent.id ||
    snapshot.successor_fact_id !== parent.factId ||
    snapshot.superseded_at !== parent.contributedAt ||
    fact.createdAt !== parent.contributedAt ||
    !reviewState ||
    !sensitivityFloor ||
    maxMemoryFactSensitivity(protectedSensitivity, sensitivityFloor) !== protectedSensitivity ||
    (snapshot.pinned_input_explicit === 0 && parent.payload.input.pinned !== false) ||
    (snapshot.review_state_input_explicit === 0 && parent.payload.input.reviewState !== 'auto') ||
    (snapshot.pinned_input_explicit === 1 &&
      (snapshot.successor_pinned_baseline === 1) !== parent.payload.input.pinned) ||
    (snapshot.review_state_input_explicit === 1 && reviewState !== parent.payload.input.reviewState)
  ) {
    fail();
  }
}

/** Verify immutable identity/scope evidence; only sealed parent retirement relaxes lifecycle drift. */
function assertPredecessorRelation(
  parent: NormalizedContributionParent,
  successor: FactContributionFactEvidence,
  edge: FactContributionAdmissionSupersessionRow,
  predecessor: FactContributionPredecessorEvidence | undefined,
  parentContributionRetired: boolean,
): void {
  const lifecycleMatchesCommittedEdge =
    predecessor?.invalidAt === edge.superseded_at && predecessor.deletedAt === null;
  if (
    !predecessor ||
    edge.successor_fact_id !== parent.factId ||
    predecessor.id === successor.id ||
    predecessor.memoryOwnerId !== parent.memoryOwnerId ||
    predecessor.subjectId !== successor.subjectId ||
    !sqliteNoCaseEquals(predecessor.predicate, successor.predicate) ||
    predecessor.scope !== successor.scope ||
    !hasMatchingFactSupersessionScope(predecessor, successor) ||
    (!parentContributionRetired && !lifecycleMatchesCommittedEdge) ||
    edge.superseded_at !== parent.contributedAt
  ) {
    fail();
  }
}

function groupRows<T extends { contribution_id: string }>(
  rows: ReadonlyArray<T>,
  parentIds: ReadonlySet<string>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!parentIds.has(row.contribution_id)) return fail();
    const group = grouped.get(row.contribution_id) ?? [];
    group.push(row);
    grouped.set(row.contribution_id, group);
  }
  return grouped;
}

/**
 * Load immutable contribution evidence without applying source retirement or write authorization.
 * Callers own the surrounding transaction and decide whether missing producer events are allowed.
 */
function loadVerifiedFactContributionAggregates(
  db: MemoryDatabase,
  contributionIds: ReadonlyArray<string>,
  allowRepairableProjectionDrift: boolean,
): VerifiedFactContributionLoadResult {
  if (
    !Array.isArray(contributionIds) ||
    contributionIds.length < 1 ||
    contributionIds.length > VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.parents
  ) {
    fail('memory_fact_contribution_aggregate_request_invalid');
  }
  const requestedIds = contributionIds.map(requireContributionId).sort(compareOrdinal);
  if (new Set(requestedIds).size !== requestedIds.length) {
    fail('memory_fact_contribution_aggregate_request_invalid');
  }
  const rawParents = loadRawContributionParents(db, requestedIds);
  if (rawParents.length !== requestedIds.length) return fail();
  const parents: NormalizedContributionParent[] = [];
  const retiredContributionIds = new Set<string>();
  const missingContributionIds: string[] = [];
  let localOwnerId: string | null = null;
  for (let index = 0; index < rawParents.length; index += 1) {
    const row = rawParents[index]!;
    const requestedId = requireContributionId(row.requested_id);
    const rowOwnerId = requireScopeId(row.local_owner_id);
    if (
      requestedId !== requestedIds[index] ||
      (localOwnerId !== null && localOwnerId !== rowOwnerId)
    ) {
      return fail();
    }
    localOwnerId = rowOwnerId;
    if (row.id === null) {
      missingContributionIds.push(requestedId);
      continue;
    }
    if (row.id !== requestedId) return fail();
    const parent = normalizeParent(row, rowOwnerId);
    if (row.retirement_group_id !== null) {
      requireFactId(row.retirement_group_id);
      retiredContributionIds.add(parent.id);
    }
    parents.push(parent);
  }
  const parentIds = new Set(parents.map((parent) => parent.id));
  const payloadBytes = parents.reduce((sum, parent) => sum + parent.payloadByteLength, 0);
  const sourceChildren = parents.reduce((sum, parent) => sum + parent.sourceCommitment.count, 0);
  const expectedSnapshots = parents.filter(
    (parent) => parent.supersessionCommitment.count > 0,
  ).length;
  const expectedEdges = parents.reduce(
    (sum, parent) =>
      sum +
      (parent.supersessionCommitment.count === 0 ? 0 : parent.supersessionCommitment.count - 1),
    0,
  );
  if (
    payloadBytes > VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.payloadBytes ||
    sourceChildren > VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.sourceChildren ||
    expectedSnapshots + expectedEdges > VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.supersessionChildren
  ) {
    fail('memory_fact_contribution_aggregate_resource_limit');
  }

  const factIds = new Set(parents.map((parent) => parent.factId));
  assertFactContributionEvidenceResourceBudget(
    loadRawContributionEvidenceBudget(db, {
      requestedIds,
      factCount: factIds.size,
      expectedEdges,
    }),
    factIds.size + expectedEdges,
  );
  const raw = loadRawContributionAggregateRows(db, {
    requestedIds,
    sourceChildren,
    expectedSnapshots,
    expectedEdges,
    factCount: factIds.size,
  });
  if (
    raw.sources.length > sourceChildren ||
    raw.snapshots.length > expectedSnapshots ||
    raw.edges.length > expectedEdges ||
    raw.facts.length > factIds.size ||
    raw.predecessors.length > expectedEdges
  ) {
    return fail();
  }
  const sources = raw.sources.map(requireSourceRow);
  const snapshots = raw.snapshots.map(requireSnapshotRow);
  const edges = raw.edges.map(requireEdgeRow);
  const sourcesByParent = groupRows(sources, parentIds);
  const snapshotsByParent = groupRows(snapshots, parentIds);
  const edgesByParent = groupRows(edges, parentIds);
  if (Array.from(snapshotsByParent.values()).some((rows) => rows.length !== 1)) return fail();

  const facts = new Map<
    string,
    {
      evidence: FactContributionFactEvidence;
      classifierContext: FactContributionClassifierContext;
      explicitProjection: Readonly<FactContributionExplicitProjection> | null;
    }
  >();
  for (const rawFact of raw.facts) {
    const fact = requireFactEvidence(rawFact, allowRepairableProjectionDrift);
    if (facts.has(fact.evidence.id)) return fail();
    facts.set(fact.evidence.id, fact);
  }

  const predecessors = new Map<string, FactContributionPredecessorEvidence>();
  for (const row of raw.predecessors) {
    const predecessor = requirePredecessorEvidence(row);
    if (predecessors.has(predecessor.id)) return fail();
    predecessors.set(predecessor.id, predecessor);
  }

  const aggregates = parents.map((parent): Readonly<VerifiedFactContributionAggregate> => {
    const fact = facts.get(parent.factId) ?? fail();
    assertFactIdentity(parent, fact.evidence);
    const aliases = assertFactContributionSourceChildCommitment(
      {
        id: parent.id,
        memory_owner_id: parent.scope.memoryOwnerId,
        memory_conversation_id: parent.scope.memoryConversationId,
        source_thread_id: parent.scope.sourceThreadId,
        task_id: parent.scope.taskId,
        source_set_version: parent.sourceCommitment.version,
        source_set_count: parent.sourceCommitment.count,
        source_set_sha256: parent.sourceCommitment.sha256,
        supersession_set_version: parent.supersessionCommitment.version,
        supersession_set_count: parent.supersessionCommitment.count,
        supersession_set_sha256: parent.supersessionCommitment.sha256,
      },
      sourcesByParent.get(parent.id) ?? [],
    )
      .map((alias) => Object.freeze({ ...alias }))
      .sort(
        (left, right) =>
          compareOrdinal(left.sourceKind, right.sourceKind) ||
          compareOrdinal(left.sourceId, right.sourceId),
      );
    assertPayloadAliases(parent.payload, aliases);
    const snapshot = snapshotsByParent.get(parent.id)?.[0] ?? null;
    const plan: FactContributionSupersessionPlan = Object.freeze({
      contributionId: parent.id,
      snapshot: snapshot ? Object.freeze({ ...snapshot }) : null,
      edges: Object.freeze(
        (edgesByParent.get(parent.id) ?? [])
          .map((edge) => Object.freeze({ ...edge }))
          .sort((left, right) =>
            compareOrdinal(left.predecessor_fact_id, right.predecessor_fact_id),
          ),
      ),
      commitment: parent.supersessionCommitment,
    });
    assertFactContributionSupersessionOperation({
      parent: {
        contributionId: parent.id,
        factId: parent.factId,
        memoryOwnerId: parent.memoryOwnerId,
        contributedAt: parent.contributedAt,
        payload: parent.payload,
      },
      plan,
    });
    assertSnapshotProjection(parent, fact.evidence, plan.snapshot);
    for (const edge of plan.edges) {
      assertPredecessorRelation(
        parent,
        fact.evidence,
        edge,
        predecessors.get(edge.predecessor_fact_id),
        retiredContributionIds.has(parent.id),
      );
    }
    return Object.freeze({
      contributionId: parent.id,
      factId: parent.factId,
      memoryOwnerId: parent.memoryOwnerId,
      sourceScope: Object.freeze({ ...parent.scope }),
      producer: Object.freeze({ ...parent.producer }),
      contributedAt: parent.contributedAt,
      payload: parent.payload,
      sourceAliases: Object.freeze(aliases),
      supersessionPlan: plan,
      factEvidence: fact.evidence,
      classifierContext: fact.classifierContext,
      explicitProjection: fact.explicitProjection,
    });
  });
  aggregates.sort(
    (left, right) =>
      left.contributedAt - right.contributedAt ||
      compareOrdinal(left.contributionId, right.contributionId),
  );
  return Object.freeze({
    aggregates: Object.freeze(aggregates),
    missingContributionIds: Object.freeze(missingContributionIds),
  });
}

/** Strict aggregate view used by admission, planning, integrity audits, and materialization. */
export function loadVerifiedFactContributionAggregatesInTransaction(
  db: MemoryDatabase,
  contributionIds: ReadonlyArray<string>,
): VerifiedFactContributionLoadResult {
  return loadVerifiedFactContributionAggregates(db, contributionIds, false);
}

/** Replay-only view that permits repairable explicit projection drift after source preflight. */
export function loadVerifiedFactContributionAggregatesForReplayInTransaction(
  db: MemoryDatabase,
  contributionIds: ReadonlyArray<string>,
): VerifiedFactContributionLoadResult {
  return loadVerifiedFactContributionAggregates(db, contributionIds, true);
}
