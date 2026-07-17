import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import {
  buildFactContributionSupersessionChildCommitment,
  MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION,
  MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES,
  type FactContributionSupersessionEdgeCommitmentRow,
  type FactContributionSupersessionSnapshotCommitmentRow,
  type MemoryFactContributionChildCommitment,
} from './factContributionChildCommitments';
import {
  encodeMemoryFactContributionPayload,
  type MemoryFactContributionPayloadV2,
} from './factContributionCodec';
import { isFactContributionSupersessionAuthorized } from './factContributionOperation';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { hasExactFactContentIdentity } from './facts/contentIdentity';
import type { FactRow, MemoryFact } from './facts/types';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from './memorySensitivityPolicy';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

const SNAPSHOT_VERSION = 1;
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

type StoredSuccessorProjection = Readonly<{
  pinned: 0 | 1;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
  sensitivityPolicyVersion: number;
}>;

type ExpectedSupersessionEdge = Readonly<{
  predecessorFactId: string;
  successorFactId: string;
  supersededAt: number;
}>;

interface ParentCommitmentRow {
  supersession_set_version: number;
  supersession_set_count: number;
  supersession_set_sha256: string;
}

export interface FactContributionSupersessionParentMetadata {
  contributionId: string;
  factId: string;
  memoryOwnerId: string;
  contributedAt: number;
  payload: MemoryFactContributionPayloadV2;
}

export interface FactContributionSupersessionSemantics {
  superseded: ReadonlyArray<Pick<MemoryFact, 'id' | 'invalidAt'>>;
  pinnedInputExplicit: boolean;
  reviewStateInputExplicit: boolean;
}

export interface FactContributionSupersessionPlan {
  contributionId: string;
  snapshot: Readonly<FactContributionSupersessionSnapshotCommitmentRow> | null;
  edges: ReadonlyArray<Readonly<FactContributionSupersessionEdgeCommitmentRow>>;
  commitment: Readonly<MemoryFactContributionChildCommitment>;
}

function fail(code: string): never {
  throw new Error(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireContributionId(value: unknown): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value)) {
    fail('memory_fact_contribution_supersession_contribution_id_invalid');
  }
  return value;
}

function requireFactId(value: unknown): string {
  if (!isExactMemoryProvenanceId(value)) {
    fail('memory_fact_contribution_supersession_successor_invalid');
  }
  return value;
}

function requireMemoryOwnerId(value: unknown): string {
  if (!isExactMemoryScopeId(value)) {
    fail('memory_fact_contribution_supersession_owner_invalid');
  }
  return value;
}

function requireSafeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('memory_fact_contribution_supersession_timestamp_invalid');
  }
  return value as number;
}

function requireBooleanFlag(value: unknown): 0 | 1 {
  if (typeof value !== 'boolean') {
    fail('memory_fact_contribution_supersession_projection_intent_invalid');
  }
  return value ? 1 : 0;
}

function requireStoredBooleanFlag(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return value;
}

function requireReviewState(value: unknown): MemoryFactReviewState {
  const reviewState = closedMemoryFactReviewState(value);
  if (!reviewState) fail('memory_fact_contribution_supersession_snapshot_invalid');
  return reviewState;
}

function requireSensitivity(value: unknown): MemoryFactSensitivity {
  const sensitivity = closedMemoryFactSensitivity(value);
  if (!sensitivity) fail('memory_fact_contribution_supersession_snapshot_invalid');
  return sensitivity;
}

function requireCurrentPolicyVersion(value: unknown): number {
  if (value !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return value;
}

function requireCommittedPolicyVersion(value: unknown): number {
  if (value !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return MEMORY_FACT_SENSITIVITY_POLICY_VERSION;
}

function normalizeParent(
  input: FactContributionSupersessionParentMetadata,
): FactContributionSupersessionParentMetadata {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_parent_invalid');
  }
  const parent = {
    contributionId: requireContributionId(input.contributionId),
    factId: requireFactId(input.factId),
    memoryOwnerId: requireMemoryOwnerId(input.memoryOwnerId),
    contributedAt: requireSafeTimestamp(input.contributedAt),
    payload: input.payload,
  };
  encodeMemoryFactContributionPayload(parent.payload);
  if (parent.payload.input.now !== parent.contributedAt) {
    fail('memory_fact_contribution_supersession_timestamp_mismatch');
  }
  return parent;
}

function normalizeExpectedEdges(
  superseded: unknown,
  successorFactId: string,
): ExpectedSupersessionEdge[] {
  if (!Array.isArray(superseded)) {
    fail('memory_fact_contribution_supersession_invalid');
  }
  if (superseded.length > MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES) {
    fail('memory_fact_contribution_supersession_invalid');
  }
  const seen = new Set<string>();
  const edges = superseded.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      fail('memory_fact_contribution_supersession_invalid');
    }
    const predecessor = candidate as Pick<MemoryFact, 'id' | 'invalidAt'>;
    if (
      !isExactMemoryProvenanceId(predecessor.id) ||
      predecessor.id === successorFactId ||
      seen.has(predecessor.id)
    ) {
      fail('memory_fact_contribution_supersession_invalid');
    }
    seen.add(predecessor.id);
    return {
      predecessorFactId: predecessor.id,
      successorFactId,
      supersededAt: requireSafeTimestamp(predecessor.invalidAt),
    };
  });
  edges.sort((left, right) => compareOrdinal(left.predecessorFactId, right.predecessorFactId));
  if (edges.length > 1) {
    const expectedTimestamp = edges[0]!.supersededAt;
    if (edges.some((edge) => edge.supersededAt !== expectedTimestamp)) {
      fail('memory_fact_contribution_supersession_timestamp_mismatch');
    }
  }
  return edges;
}

function expectedEdgesForSemantics(
  input: FactContributionSupersessionSemantics,
  successorFactId: string,
): {
  expectedEdges: ExpectedSupersessionEdge[];
  pinnedInputExplicit: 0 | 1;
  reviewStateInputExplicit: 0 | 1;
} {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_invalid');
  }
  return {
    expectedEdges: normalizeExpectedEdges(input.superseded, successorFactId),
    pinnedInputExplicit: requireBooleanFlag(input.pinnedInputExplicit),
    reviewStateInputExplicit: requireBooleanFlag(input.reviewStateInputExplicit),
  };
}

function requireActiveSuccessor(parentInput: FactContributionSupersessionParentMetadata): {
  parent: FactContributionSupersessionParentMetadata;
  successorCreatedAt: number;
  projection: StoredSuccessorProjection;
} {
  const parent = normalizeParent(parentInput);
  const db = getSchemaReadyMemoryDb();
  const row = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    parent.factId,
  );
  if (!row) fail('memory_fact_contribution_supersession_successor_mismatch');
  const memoryOwnerId = row.memory_owner_id ?? null;
  const createdAt = requireSafeTimestamp(row.created_at);
  if (
    parent.memoryOwnerId !== getLocalMemoryVaultOwnerId(db) ||
    memoryOwnerId !== parent.memoryOwnerId ||
    createdAt > parent.contributedAt ||
    !hasExactFactContentIdentity(
      {
        memoryOwnerId: row.memory_owner_id,
        memoryKind: row.memory_kind,
        scope: row.scope,
        originConversationId: row.origin_conversation_id,
        originThreadId: row.origin_thread_id,
        originTaskId: row.origin_task_id,
        personaId: row.persona_id,
        subjectId: row.subject_id,
        predicate: row.predicate,
        objectText: row.object_text,
        objectEntityId: row.object_entity_id,
      },
      {
        ...parent.payload.input,
        memoryOwnerId: parent.memoryOwnerId,
        personaId: parent.payload.applicability.personaId,
      },
    )
  ) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  if (row.invalid_at !== null || row.deleted_at !== null) {
    fail('memory_fact_contribution_replay_target_changed');
  }
  return {
    parent,
    successorCreatedAt: createdAt,
    projection: Object.freeze({
      pinned: requireStoredBooleanFlag(row.pinned),
      reviewState: requireReviewState(row.review_state),
      sensitivity: requireSensitivity(row.sensitivity),
      sensitivityPolicyVersion: requireCurrentPolicyVersion(row.sensitivity_policy_version),
    }),
  };
}

function assertProjectionIntent(input: {
  payload: MemoryFactContributionPayloadV2;
  projection: Pick<StoredSuccessorProjection, 'pinned' | 'reviewState'>;
  pinnedInputExplicit: 0 | 1;
  reviewStateInputExplicit: 0 | 1;
}): void {
  if (
    (input.pinnedInputExplicit === 1
      ? input.payload.input.pinned !== (input.projection.pinned === 1)
      : input.payload.input.pinned !== false) ||
    (input.reviewStateInputExplicit === 1
      ? input.payload.input.reviewState !== input.projection.reviewState
      : input.payload.input.reviewState !== 'auto')
  ) {
    fail('memory_fact_contribution_supersession_projection_mismatch');
  }
}

function freezePlan(input: {
  contributionId: string;
  snapshot: FactContributionSupersessionSnapshotCommitmentRow | null;
  edges: ReadonlyArray<FactContributionSupersessionEdgeCommitmentRow>;
  commitment: MemoryFactContributionChildCommitment;
}): FactContributionSupersessionPlan {
  const snapshot = input.snapshot ? Object.freeze({ ...input.snapshot }) : null;
  const edges = Object.freeze(input.edges.map((edge) => Object.freeze({ ...edge })));
  return Object.freeze({
    contributionId: input.contributionId,
    snapshot,
    edges,
    commitment: Object.freeze({ ...input.commitment }),
  });
}

function buildPlan(input: {
  contributionId: string;
  snapshot: FactContributionSupersessionSnapshotCommitmentRow | null;
  edges: ReadonlyArray<FactContributionSupersessionEdgeCommitmentRow>;
}): FactContributionSupersessionPlan {
  const commitment = buildFactContributionSupersessionChildCommitment(input);
  return freezePlan({ ...input, commitment });
}

function readSnapshot(
  contributionId: string,
): FactContributionSupersessionSnapshotCommitmentRow | null {
  const row =
    getSchemaReadyMemoryDb().getFirstSync<FactContributionSupersessionSnapshotCommitmentRow>(
      `SELECT contribution_id, successor_fact_id, superseded_at, snapshot_version,
            pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
            successor_review_state_baseline, successor_sensitivity_floor,
            successor_sensitivity_policy_version
       FROM memory_fact_contribution_supersession_snapshots
      WHERE contribution_id = ?
      LIMIT 1`,
      contributionId,
    );
  return row ? { ...row } : null;
}

function readEdges(contributionId: string): FactContributionSupersessionEdgeCommitmentRow[] {
  return getSchemaReadyMemoryDb()
    .getAllSync<FactContributionSupersessionEdgeCommitmentRow>(
      `SELECT contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
         FROM memory_fact_contribution_supersessions
        WHERE contribution_id = ?
        ORDER BY predecessor_fact_id ASC`,
      contributionId,
    )
    .map((row) => ({ ...row }))
    .sort((left, right) => compareOrdinal(left.predecessor_fact_id, right.predecessor_fact_id));
}

function commitmentMatches(
  actual: MemoryFactContributionChildCommitment,
  expected: MemoryFactContributionChildCommitment,
): boolean {
  return (
    actual.version === expected.version &&
    actual.count === expected.count &&
    actual.sha256 === expected.sha256
  );
}

function requireCommitment(input: unknown): MemoryFactContributionChildCommitment {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  const commitment = input as MemoryFactContributionChildCommitment;
  if (
    commitment.version !== MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION ||
    !Number.isSafeInteger(commitment.count) ||
    commitment.count < 0 ||
    typeof commitment.sha256 !== 'string' ||
    !SHA256_PATTERN.test(commitment.sha256)
  ) {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  return commitment;
}

function assertVerifiedSnapshotSafety(plan: FactContributionSupersessionPlan): void {
  const snapshot = plan.snapshot;
  if (!snapshot) return;
  requireStoredBooleanFlag(snapshot.pinned_input_explicit);
  requireStoredBooleanFlag(snapshot.review_state_input_explicit);
  requireStoredBooleanFlag(snapshot.successor_pinned_baseline);
  requireReviewState(snapshot.successor_review_state_baseline);
  requireSensitivity(snapshot.successor_sensitivity_floor);
  requireCommittedPolicyVersion(snapshot.successor_sensitivity_policy_version);
}

function assertPlanIntegrity(plan: FactContributionSupersessionPlan): void {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.edges)) {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  let rebuilt: MemoryFactContributionChildCommitment;
  try {
    rebuilt = buildFactContributionSupersessionChildCommitment({
      contributionId: requireContributionId(plan.contributionId),
      snapshot: plan.snapshot,
      edges: plan.edges,
    });
  } catch {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  if (!commitmentMatches(rebuilt, requireCommitment(plan.commitment))) {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  assertVerifiedSnapshotSafety(plan);
}

function assertOperationMatchesPredecessors(
  parent: FactContributionSupersessionParentMetadata,
  predecessorFactIds: ReadonlyArray<string>,
): void {
  if (
    !isFactContributionSupersessionAuthorized({
      operation: parent.payload.operation,
      supersedePrior: parent.payload.input.supersedePrior,
      contributedFactId: parent.factId,
      predecessorFactIds,
    })
  ) {
    fail('memory_fact_contribution_supersession_operation_mismatch');
  }
}

/** Prove that the committed children are authorized by the payload's sealed operation. */
export function assertFactContributionSupersessionOperation(input: {
  parent: FactContributionSupersessionParentMetadata;
  plan: FactContributionSupersessionPlan;
}): void {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_operation_mismatch');
  }
  const parent = normalizeParent(input.parent);
  assertPlanIntegrity(input.plan);
  if (input.plan.contributionId !== parent.contributionId) {
    fail('memory_fact_contribution_supersession_operation_mismatch');
  }
  assertOperationMatchesPredecessors(
    parent,
    input.plan.edges.map((edge) => edge.predecessor_fact_id),
  );
}

/** Prepare the exact supersession children and their parent commitment before parent insertion. */
export function prepareFactContributionSupersessionPlanInTransaction(input: {
  parent: FactContributionSupersessionParentMetadata;
  semantics: FactContributionSupersessionSemantics;
}): FactContributionSupersessionPlan {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_invalid');
  }
  const { parent, projection, successorCreatedAt } = requireActiveSuccessor(input.parent);
  const semantics = expectedEdgesForSemantics(input.semantics, parent.factId);
  assertOperationMatchesPredecessors(
    parent,
    semantics.expectedEdges.map((edge) => edge.predecessorFactId),
  );
  if (semantics.expectedEdges.length === 0) {
    return buildPlan({ contributionId: parent.contributionId, snapshot: null, edges: [] });
  }
  const supersededAt = semantics.expectedEdges[0]!.supersededAt;
  if (supersededAt !== parent.contributedAt || successorCreatedAt !== parent.contributedAt) {
    fail('memory_fact_contribution_supersession_timestamp_mismatch');
  }
  assertProjectionIntent({
    payload: parent.payload,
    projection,
    pinnedInputExplicit: semantics.pinnedInputExplicit,
    reviewStateInputExplicit: semantics.reviewStateInputExplicit,
  });
  const snapshot: FactContributionSupersessionSnapshotCommitmentRow = {
    contribution_id: parent.contributionId,
    successor_fact_id: parent.factId,
    superseded_at: supersededAt,
    snapshot_version: SNAPSHOT_VERSION,
    pinned_input_explicit: semantics.pinnedInputExplicit,
    review_state_input_explicit: semantics.reviewStateInputExplicit,
    successor_pinned_baseline: projection.pinned,
    successor_review_state_baseline: projection.reviewState,
    successor_sensitivity_floor: projection.sensitivity,
    successor_sensitivity_policy_version: projection.sensitivityPolicyVersion,
  };
  const edges = semantics.expectedEdges.map((edge) => ({
    contribution_id: parent.contributionId,
    predecessor_fact_id: edge.predecessorFactId,
    successor_fact_id: edge.successorFactId,
    superseded_at: edge.supersededAt,
  }));
  return buildPlan({ contributionId: parent.contributionId, snapshot, edges });
}

/** Load children only after their exact set matches the immutable parent commitment. */
export function loadVerifiedFactContributionSupersessionPlanInTransaction(input: {
  contributionId: string;
  commitment: MemoryFactContributionChildCommitment;
}): FactContributionSupersessionPlan {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  const contributionId = requireContributionId(input.contributionId);
  const expectedCommitment = requireCommitment(input.commitment);
  const snapshot = readSnapshot(contributionId);
  const edges = readEdges(contributionId);
  let plan: FactContributionSupersessionPlan;
  try {
    plan = buildPlan({ contributionId, snapshot, edges });
  } catch {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  if (!commitmentMatches(plan.commitment, expectedCommitment)) {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  assertVerifiedSnapshotSafety(plan);
  return plan;
}

/** Persist a prepared child set beneath the already-inserted committed parent. */
export function persistFactContributionSupersessionPlanInTransaction(
  plan: FactContributionSupersessionPlan,
): void {
  assertPlanIntegrity(plan);
  const db = getSchemaReadyMemoryDb();
  const parent = db.getFirstSync<ParentCommitmentRow>(
    `SELECT supersession_set_version, supersession_set_count, supersession_set_sha256
       FROM memory_fact_contributions
      WHERE id = ?
      LIMIT 1`,
    plan.contributionId,
  );
  if (
    !parent ||
    !commitmentMatches(plan.commitment, {
      version: parent.supersession_set_version as 1,
      count: parent.supersession_set_count,
      sha256: parent.supersession_set_sha256,
    })
  ) {
    fail('memory_fact_contribution_supersession_commitment_mismatch');
  }
  if (readSnapshot(plan.contributionId) || readEdges(plan.contributionId).length > 0) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  if (!plan.snapshot) return;
  db.runSync(
    `INSERT INTO memory_fact_contribution_supersession_snapshots(
       contribution_id, successor_fact_id, superseded_at, snapshot_version,
       pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
       successor_review_state_baseline, successor_sensitivity_floor,
       successor_sensitivity_policy_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    plan.snapshot.contribution_id,
    plan.snapshot.successor_fact_id,
    plan.snapshot.superseded_at,
    plan.snapshot.snapshot_version,
    plan.snapshot.pinned_input_explicit,
    plan.snapshot.review_state_input_explicit,
    plan.snapshot.successor_pinned_baseline,
    plan.snapshot.successor_review_state_baseline,
    plan.snapshot.successor_sensitivity_floor,
    plan.snapshot.successor_sensitivity_policy_version,
  );
  for (const edge of plan.edges) {
    db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, ?)`,
      edge.contribution_id,
      edge.predecessor_fact_id,
      edge.successor_fact_id,
      edge.superseded_at,
    );
  }
  loadVerifiedFactContributionSupersessionPlanInTransaction({
    contributionId: plan.contributionId,
    commitment: plan.commitment,
  });
}

/** Verify replay intent against an already commitment-verified immutable child set. */
export function assertFactContributionSupersessionReplayInTransaction(input: {
  parent: FactContributionSupersessionParentMetadata;
  plan: FactContributionSupersessionPlan;
  semantics: FactContributionSupersessionSemantics;
}): void {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  assertPlanIntegrity(input.plan);
  const { parent, successorCreatedAt } = requireActiveSuccessor(input.parent);
  if (input.plan.contributionId !== parent.contributionId) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  assertOperationMatchesPredecessors(
    parent,
    input.plan.edges.map((edge) => edge.predecessor_fact_id),
  );
  const semantics = expectedEdgesForSemantics(input.semantics, parent.factId);
  const snapshot = input.plan.snapshot;
  if (!snapshot) {
    if (input.plan.edges.length !== 0 || semantics.expectedEdges.length !== 0) {
      fail('memory_fact_contribution_supersession_replay_mismatch');
    }
    assertProjectionIntent({
      payload: parent.payload,
      projection: {
        pinned: parent.payload.input.pinned ? 1 : 0,
        reviewState: parent.payload.input.reviewState,
      },
      pinnedInputExplicit: semantics.pinnedInputExplicit,
      reviewStateInputExplicit: semantics.reviewStateInputExplicit,
    });
    return;
  }
  if (
    snapshot.successor_fact_id !== parent.factId ||
    snapshot.superseded_at !== parent.contributedAt ||
    successorCreatedAt !== parent.contributedAt ||
    snapshot.snapshot_version !== SNAPSHOT_VERSION ||
    snapshot.pinned_input_explicit !== semantics.pinnedInputExplicit ||
    snapshot.review_state_input_explicit !== semantics.reviewStateInputExplicit
  ) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  assertProjectionIntent({
    payload: parent.payload,
    projection: {
      pinned: requireStoredBooleanFlag(snapshot.successor_pinned_baseline),
      reviewState: requireReviewState(snapshot.successor_review_state_baseline),
    },
    pinnedInputExplicit: semantics.pinnedInputExplicit,
    reviewStateInputExplicit: semantics.reviewStateInputExplicit,
  });
  if (semantics.expectedEdges.length === 0) return;
  if (semantics.expectedEdges.length !== input.plan.edges.length) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  for (let index = 0; index < semantics.expectedEdges.length; index += 1) {
    const expected = semantics.expectedEdges[index]!;
    const actual = input.plan.edges[index]!;
    if (
      actual.predecessor_fact_id !== expected.predecessorFactId ||
      actual.successor_fact_id !== expected.successorFactId ||
      actual.superseded_at !== expected.supersededAt
    ) {
      fail('memory_fact_contribution_supersession_replay_mismatch');
    }
  }
}
