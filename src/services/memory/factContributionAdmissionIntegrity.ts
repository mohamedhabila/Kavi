import type { getMemoryDb } from './database';
import {
  buildMemoryFactContributionId,
  decodeMemoryFactContributionPayload,
  encodeMemoryFactContributionPayload,
  MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
  normalizeMemoryFactContributionSourceScope,
  requireMemoryFactContributionProducerIdentity,
  type MemoryFactContributionPayloadV2,
  type MemoryFactContributionSourceAlias,
} from './factContributionCodec';
import {
  assertFactContributionSourceChildCommitment,
  assertFactContributionSupersessionChildCommitment,
  type FactContributionAdmissionSourceRow as ContributionSourceRow,
  type FactContributionAdmissionSupersessionRow as ContributionSupersessionRow,
  type FactContributionAdmissionSupersessionSnapshotRow as ContributionSupersessionSnapshotRow,
} from './factContributionAdmissionCommitments';
import { isFactContributionSupersessionAuthorized } from './factContributionOperation';
import {
  closedMemoryFactClass,
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  closedMemorySourceAuthority,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import {
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from './memorySensitivityPolicy';
import {
  isMemoryFactScope,
  normalizeFactKind,
  type FactRow,
  type MemoryDecayPolicy,
  type MemoryFactKind,
} from './facts/types';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface ContributionRow {
  id: string;
  fact_id: string;
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  producer_id: string;
  producer_event_id: string;
  source_set_version: unknown;
  source_set_count: unknown;
  source_set_sha256: unknown;
  supersession_set_version: unknown;
  supersession_set_count: unknown;
  supersession_set_sha256: unknown;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  payload_byte_length: number;
  contributed_at: number;
}

interface RetiredSourceRow {
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

interface ContributionSupersessionSnapshot {
  contributionId: string;
  successorFactId: string;
  supersededAt: number;
  pinnedInputExplicit: boolean;
  reviewStateInputExplicit: boolean;
  successorPinnedBaseline: boolean;
  successorReviewStateBaseline: MemoryFactReviewState;
  successorSensitivityFloor: MemoryFactSensitivity;
  successorSensitivityPolicyVersion: number;
}

const MEMORY_FACT_KINDS = new Set<MemoryFactKind>([
  'semantic_fact',
  'episodic_event',
  'goal',
  'tool_result',
  'source',
  'decision',
  'risk',
  'artifact',
  'summary',
  'evidence_span',
  'agent_run',
  'gotcha',
]);
const DECAY_POLICIES = new Set<MemoryDecayPolicy>([
  'normal',
  'slow',
  'fast',
  'pinned',
  'ephemeral',
]);

function fail(code = 'memory_fact_contribution_admission_integrity_invalid'): never {
  throw new Error(code);
}

function exactSourceKey(source: RetiredSourceRow): string {
  return JSON.stringify([
    source.memory_owner_id,
    source.memory_conversation_id,
    source.source_thread_id,
    source.task_id,
    source.source_kind,
    source.source_id,
  ]);
}

function strictAttributes(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail();
    return parsed as Record<string, unknown>;
  } catch {
    return fail();
  }
}

function strictMemoryKind(value: unknown): MemoryFactKind {
  if (
    typeof value !== 'string' ||
    normalizeFactKind(value) !== value ||
    !MEMORY_FACT_KINDS.has(value as MemoryFactKind)
  ) {
    return fail();
  }
  return value as MemoryFactKind;
}

function strictDecayPolicy(value: unknown): MemoryDecayPolicy {
  if (typeof value !== 'string' || !DECAY_POLICIES.has(value as MemoryDecayPolicy)) return fail();
  return value as MemoryDecayPolicy;
}

function strictBooleanInteger(value: unknown): boolean {
  if (value !== 0 && value !== 1) return fail();
  return value === 1;
}

function strictSafeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail();
  }
  return value as number;
}

function decodeSupersessionSnapshot(
  row: ContributionSupersessionSnapshotRow,
): ContributionSupersessionSnapshot {
  if (
    typeof row.contribution_id !== 'string' ||
    row.contribution_id.length !== 68 ||
    !row.contribution_id.startsWith('mfc_') ||
    typeof row.successor_fact_id !== 'string' ||
    row.successor_fact_id.length < 1 ||
    row.successor_fact_id.length > 512 ||
    row.snapshot_version !== 1
  ) {
    return fail();
  }
  const successorReviewStateBaseline = closedMemoryFactReviewState(
    row.successor_review_state_baseline,
  );
  const successorSensitivityFloor = closedMemoryFactSensitivity(row.successor_sensitivity_floor);
  if (!successorReviewStateBaseline || !successorSensitivityFloor) return fail();
  return {
    contributionId: row.contribution_id,
    successorFactId: row.successor_fact_id,
    supersededAt: strictSafeInteger(row.superseded_at, 0),
    pinnedInputExplicit: strictBooleanInteger(row.pinned_input_explicit),
    reviewStateInputExplicit: strictBooleanInteger(row.review_state_input_explicit),
    successorPinnedBaseline: strictBooleanInteger(row.successor_pinned_baseline),
    successorReviewStateBaseline,
    successorSensitivityFloor,
    successorSensitivityPolicyVersion: strictSafeInteger(
      row.successor_sensitivity_policy_version,
      1,
      2_147_483_647,
    ),
  };
}

/** Reconstruct the exact persisted fact mutation without normalizing malformed legacy data. */
export function buildLegacyFactSnapshotPayload(row: FactRow): MemoryFactContributionPayloadV2 {
  const scope = isMemoryFactScope(row.scope) ? row.scope : fail();
  const factClass = closedMemoryFactClass(row.fact_class) ?? fail();
  const sourceAuthority = closedMemorySourceAuthority(row.source_authority) ?? fail();
  const reviewState = closedMemoryFactReviewState(row.review_state) ?? fail();
  const payload: MemoryFactContributionPayloadV2 = {
    version: MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
    operation: { kind: 'record' },
    applicability: {
      factClass,
      sourceAuthority,
      personaId: row.persona_id ?? null,
    },
    input: {
      subjectId: row.subject_id,
      predicate: row.predicate,
      objectText: row.object_text,
      objectEntityId: row.object_entity_id,
      attributes: strictAttributes(row.attributes),
      confidence: row.confidence,
      sourceMessageId: row.source_message_id,
      sourceRunId: row.source_run_id,
      scope,
      originConversationId: row.origin_conversation_id,
      originThreadId: row.origin_thread_id,
      originTaskId: row.origin_task_id,
      sourceTurnId: row.source_turn_id,
      sourceSummary: row.source_summary,
      importance: row.importance,
      decayPolicy: strictDecayPolicy(row.decay_policy),
      expiresAt: row.expires_at,
      validAt: row.valid_at,
      pinned: strictBooleanInteger(row.pinned),
      sourceActorId: row.source_actor_id ?? null,
      retrievability: row.retrievability ?? Number.NaN,
      stability: row.stability ?? Number.NaN,
      decayRate: row.decay_rate ?? Number.NaN,
      reviewState,
      sensitivityFloor:
        row.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
          ? (closedMemoryFactSensitivity(row.sensitivity) ?? 'restricted')
          : 'restricted',
      memoryKind: strictMemoryKind(row.memory_kind),
      supersedePrior: false,
      now: row.updated_at,
    },
  };
  encodeMemoryFactContributionPayload(payload);
  return payload;
}

function assertPayloadScope(
  payload: MemoryFactContributionPayloadV2,
  contribution: ContributionRow,
): void {
  const input = payload.input;
  if (input.scope === 'global' || input.scope === 'persona') return;
  if (
    input.originConversationId !== contribution.memory_conversation_id ||
    (input.originThreadId !== null && input.originThreadId !== contribution.source_thread_id) ||
    (input.scope === 'session' && input.originTaskId !== contribution.task_id)
  ) {
    fail();
  }
}

function assertPayloadAliases(
  payload: MemoryFactContributionPayloadV2,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): void {
  const keys = new Set(aliases.map((alias) => `${alias.sourceKind}\u0000${alias.sourceId}`));
  for (const alias of [
    { sourceKind: 'message', sourceId: payload.input.sourceMessageId },
    { sourceKind: 'turn', sourceId: payload.input.sourceTurnId },
    { sourceKind: 'run', sourceId: payload.input.sourceRunId },
  ] as const) {
    if (alias.sourceId !== null && !keys.has(`${alias.sourceKind}\u0000${alias.sourceId}`)) {
      fail();
    }
  }
}

function assertContributionIntegrity(
  fact: FactRow,
  contribution: ContributionRow,
  memoryOwnerId: string,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
  retiredSourceKeys: ReadonlySet<string>,
): MemoryFactContributionPayloadV2 {
  if (
    fact.memory_owner_id !== memoryOwnerId ||
    contribution.fact_id !== fact.id ||
    contribution.memory_owner_id !== memoryOwnerId
  ) {
    fail();
  }
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: contribution.memory_owner_id,
    memoryConversationId: contribution.memory_conversation_id,
    sourceThreadId: contribution.source_thread_id,
    taskId: contribution.task_id,
  });
  const producer = requireMemoryFactContributionProducerIdentity({
    producerId: contribution.producer_id,
    producerEventId: contribution.producer_event_id,
  });
  if (buildMemoryFactContributionId({ scope, producer }) !== contribution.id) fail();
  const payload = decodeMemoryFactContributionPayload({
    payloadVersion: contribution.payload_version,
    payloadJson: contribution.payload_json,
    payloadSha256: contribution.payload_sha256,
    payloadByteLength: contribution.payload_byte_length,
  });
  if (payload.input.now !== contribution.contributed_at) fail();
  if (
    !hasExactFactContentIdentity(
      {
        memoryOwnerId: fact.memory_owner_id,
        memoryKind: fact.memory_kind,
        scope: fact.scope,
        originConversationId: fact.origin_conversation_id,
        originThreadId: fact.origin_thread_id,
        originTaskId: fact.origin_task_id,
        personaId: fact.persona_id,
        subjectId: fact.subject_id,
        predicate: fact.predicate,
        objectText: fact.object_text,
        objectEntityId: fact.object_entity_id,
      },
      {
        ...payload.input,
        memoryOwnerId,
        personaId: payload.applicability.personaId,
      },
    )
  ) {
    fail();
  }
  assertPayloadScope(payload, contribution);
  assertPayloadAliases(payload, aliases);
  for (const alias of aliases) {
    if (
      retiredSourceKeys.has(
        exactSourceKey({
          memory_owner_id: memoryOwnerId,
          memory_conversation_id: contribution.memory_conversation_id,
          source_thread_id: contribution.source_thread_id,
          task_id: contribution.task_id,
          source_kind: alias.sourceKind,
          source_id: alias.sourceId,
        }),
      )
    ) {
      fail('memory_fact_contribution_admission_retired_source');
    }
  }
  return payload;
}

function hasMatchingSupersessionScope(predecessor: FactRow, successor: FactRow): boolean {
  if (successor.scope === 'global') {
    return (
      predecessor.persona_id === null &&
      successor.persona_id === null &&
      predecessor.origin_conversation_id === null &&
      successor.origin_conversation_id === null &&
      predecessor.origin_thread_id === null &&
      successor.origin_thread_id === null &&
      predecessor.origin_task_id === null &&
      successor.origin_task_id === null
    );
  }
  if (successor.scope === 'persona') {
    return (
      successor.persona_id !== null &&
      predecessor.persona_id === successor.persona_id &&
      predecessor.origin_conversation_id === null &&
      successor.origin_conversation_id === null &&
      predecessor.origin_thread_id === null &&
      successor.origin_thread_id === null &&
      predecessor.origin_task_id === null &&
      successor.origin_task_id === null
    );
  }
  if (successor.scope === 'conversation' || successor.scope === 'project') {
    return (
      successor.origin_conversation_id !== null &&
      predecessor.persona_id === null &&
      successor.persona_id === null &&
      predecessor.origin_conversation_id === successor.origin_conversation_id &&
      predecessor.origin_task_id === null &&
      successor.origin_task_id === null
    );
  }
  return (
    successor.scope === 'session' &&
    successor.origin_conversation_id !== null &&
    successor.origin_thread_id !== null &&
    successor.origin_task_id !== null &&
    predecessor.persona_id === null &&
    successor.persona_id === null &&
    predecessor.origin_conversation_id === successor.origin_conversation_id &&
    predecessor.origin_thread_id === successor.origin_thread_id &&
    predecessor.origin_task_id === successor.origin_task_id
  );
}

function sqliteNoCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function assertSupersessionSnapshotIntegrity(
  snapshot: ContributionSupersessionSnapshot,
  facts: ReadonlyMap<string, FactRow>,
  contributions: ReadonlyMap<string, ContributionRow>,
  payloads: ReadonlyMap<string, MemoryFactContributionPayloadV2>,
): void {
  const contribution = contributions.get(snapshot.contributionId) ?? fail();
  const payload = payloads.get(snapshot.contributionId) ?? fail();
  const successor = facts.get(snapshot.successorFactId) ?? fail();
  const successorSensitivity =
    successor.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
      ? (closedMemoryFactSensitivity(successor.sensitivity) ?? 'restricted')
      : 'restricted';
  if (
    contribution.fact_id !== snapshot.successorFactId ||
    contribution.memory_owner_id !== successor.memory_owner_id ||
    contribution.contributed_at !== snapshot.supersededAt ||
    payload.input.now !== snapshot.supersededAt ||
    successor.created_at !== snapshot.supersededAt ||
    snapshot.successorSensitivityPolicyVersion !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION ||
    maxMemoryFactSensitivity(successorSensitivity, snapshot.successorSensitivityFloor) !==
      successorSensitivity ||
    (!snapshot.pinnedInputExplicit && payload.input.pinned !== false) ||
    (!snapshot.reviewStateInputExplicit && payload.input.reviewState !== 'auto') ||
    (snapshot.pinnedInputExplicit && snapshot.successorPinnedBaseline !== payload.input.pinned) ||
    (snapshot.reviewStateInputExplicit &&
      snapshot.successorReviewStateBaseline !== payload.input.reviewState)
  ) {
    fail();
  }
}

function assertSupersessionIntegrity(
  row: ContributionSupersessionRow,
  facts: ReadonlyMap<string, FactRow>,
  contributions: ReadonlyMap<string, ContributionRow>,
  payloads: ReadonlyMap<string, MemoryFactContributionPayloadV2>,
  snapshots: ReadonlyMap<string, ContributionSupersessionSnapshot>,
): void {
  const contribution = contributions.get(row.contribution_id) ?? fail();
  const payload = payloads.get(row.contribution_id) ?? fail();
  const snapshot = snapshots.get(row.contribution_id) ?? fail();
  const predecessor = facts.get(row.predecessor_fact_id) ?? fail();
  const successor = facts.get(row.successor_fact_id) ?? fail();
  if (
    contribution.fact_id !== successor.id ||
    snapshot.successorFactId !== row.successor_fact_id ||
    snapshot.supersededAt !== row.superseded_at ||
    predecessor.id === successor.id ||
    predecessor.memory_owner_id !== contribution.memory_owner_id ||
    successor.memory_owner_id !== contribution.memory_owner_id ||
    predecessor.subject_id !== successor.subject_id ||
    sqliteNoCase(predecessor.predicate) !== sqliteNoCase(successor.predicate) ||
    predecessor.scope !== successor.scope ||
    !hasMatchingSupersessionScope(predecessor, successor) ||
    predecessor.invalid_at !== row.superseded_at ||
    row.superseded_at !== payload.input.now ||
    !Number.isSafeInteger(row.superseded_at) ||
    row.superseded_at < 0
  ) {
    fail();
  }
}

/** Fail closed unless every live local fact is wholly contribution-backed and valid. */
export function assertFactContributionAdmissionIntegrity(db: MemoryDb): void {
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const facts = new Map(
    db.getAllSync<FactRow>('SELECT * FROM memory_facts').map((fact) => [fact.id, fact]),
  );
  const contributions = new Map(
    db
      .getAllSync<ContributionRow>('SELECT * FROM memory_fact_contributions ORDER BY id ASC')
      .map((contribution) => [contribution.id, contribution]),
  );
  const sourceRowsByContribution = new Map<string, ContributionSourceRow[]>();
  for (const source of db.getAllSync<ContributionSourceRow>(
    `SELECT contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
            task_id, source_kind, source_id
       FROM memory_fact_contribution_sources`,
  )) {
    const rows = sourceRowsByContribution.get(source.contribution_id) ?? [];
    rows.push(source);
    sourceRowsByContribution.set(source.contribution_id, rows);
  }
  const rawSnapshots = new Map<string, ContributionSupersessionSnapshotRow>();
  for (const snapshot of db.getAllSync<ContributionSupersessionSnapshotRow>(
    `SELECT contribution_id, successor_fact_id, superseded_at, snapshot_version,
            pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
            successor_review_state_baseline, successor_sensitivity_floor,
            successor_sensitivity_policy_version
       FROM memory_fact_contribution_supersession_snapshots`,
  )) {
    if (rawSnapshots.has(snapshot.contribution_id)) fail();
    rawSnapshots.set(snapshot.contribution_id, snapshot);
  }
  const supersessionRowsByContribution = new Map<string, ContributionSupersessionRow[]>();
  for (const supersession of db.getAllSync<ContributionSupersessionRow>(
    `SELECT contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       FROM memory_fact_contribution_supersessions`,
  )) {
    const rows = supersessionRowsByContribution.get(supersession.contribution_id) ?? [];
    rows.push(supersession);
    supersessionRowsByContribution.set(supersession.contribution_id, rows);
  }
  if (
    Array.from(sourceRowsByContribution.keys()).some((id) => !contributions.has(id)) ||
    Array.from(rawSnapshots.keys()).some((id) => !contributions.has(id)) ||
    Array.from(supersessionRowsByContribution.keys()).some((id) => !contributions.has(id))
  ) {
    fail();
  }
  const retiredSourceKeys = new Set(
    db
      .getAllSync<RetiredSourceRow>(
        `SELECT memory_owner_id, memory_conversation_id, source_thread_id,
              task_id, source_kind, source_id
         FROM memory_retired_sources`,
      )
      .map(exactSourceKey),
  );
  const contributionCounts = new Map<string, number>();
  const payloads = new Map<string, MemoryFactContributionPayloadV2>();
  for (const contribution of contributions.values()) {
    const fact = facts.get(contribution.fact_id) ?? fail();
    const aliases = assertFactContributionSourceChildCommitment(
      contribution,
      sourceRowsByContribution.get(contribution.id) ?? [],
    );
    const supersessionRows = supersessionRowsByContribution.get(contribution.id) ?? [];
    assertFactContributionSupersessionChildCommitment(
      contribution,
      rawSnapshots.get(contribution.id) ?? null,
      supersessionRows,
    );
    const payload = assertContributionIntegrity(
      fact,
      contribution,
      memoryOwnerId,
      aliases,
      retiredSourceKeys,
    );
    if (
      !isFactContributionSupersessionAuthorized({
        operation: payload.operation,
        supersedePrior: payload.input.supersedePrior,
        contributedFactId: contribution.fact_id,
        predecessorFactIds: supersessionRows.map((row) => row.predecessor_fact_id),
      })
    ) {
      fail();
    }
    payloads.set(contribution.id, payload);
    contributionCounts.set(fact.id, (contributionCounts.get(fact.id) ?? 0) + 1);
  }
  const snapshots = new Map<string, ContributionSupersessionSnapshot>();
  const snapshotSuccessorFactIds = new Set<string>();
  for (const rawSnapshot of rawSnapshots.values()) {
    const snapshot = decodeSupersessionSnapshot(rawSnapshot);
    if (
      snapshots.has(snapshot.contributionId) ||
      snapshotSuccessorFactIds.has(snapshot.successorFactId)
    ) {
      fail();
    }
    assertSupersessionSnapshotIntegrity(snapshot, facts, contributions, payloads);
    snapshots.set(snapshot.contributionId, snapshot);
    snapshotSuccessorFactIds.add(snapshot.successorFactId);
  }
  const snapshotEdgeCounts = new Map<string, number>();
  const supersededPredecessorFactIds = new Set<string>();
  for (const supersessions of supersessionRowsByContribution.values()) {
    for (const supersession of supersessions) {
      if (supersededPredecessorFactIds.has(supersession.predecessor_fact_id)) fail();
      supersededPredecessorFactIds.add(supersession.predecessor_fact_id);
      assertSupersessionIntegrity(supersession, facts, contributions, payloads, snapshots);
      snapshotEdgeCounts.set(
        supersession.contribution_id,
        (snapshotEdgeCounts.get(supersession.contribution_id) ?? 0) + 1,
      );
    }
  }
  if (Array.from(snapshots.keys()).some((id) => !snapshotEdgeCounts.has(id))) fail();
  for (const fact of facts.values()) {
    if (fact.deleted_at === null) {
      if (fact.memory_owner_id !== memoryOwnerId || !contributionCounts.has(fact.id)) fail();
    }
  }
}
