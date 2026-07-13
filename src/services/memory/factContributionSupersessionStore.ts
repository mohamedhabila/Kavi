import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { decodeMemoryFactContributionPayload } from './factContributionCodec';
import type { MemoryFactContributionWriteReceipt } from './factContributionStore';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import type { FactRow, MemoryFact } from './facts/types';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from './memorySensitivityPolicy';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

const SNAPSHOT_VERSION = 1;
const MAX_POLICY_VERSION = 2_147_483_647;
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;

interface ContributionRow {
  fact_id: string;
  memory_owner_id: string;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  payload_byte_length: number;
  contributed_at: number;
}

interface SupersessionSnapshotRow {
  contribution_id: string;
  successor_fact_id: string;
  superseded_at: number;
  snapshot_version: number;
  pinned_input_explicit: number;
  review_state_input_explicit: number;
  successor_pinned_baseline: number;
  successor_review_state_baseline: string;
  successor_sensitivity_floor: string;
  successor_sensitivity_policy_version: number;
}

interface SupersessionEdgeRow {
  predecessor_fact_id: string;
  successor_fact_id: string;
  superseded_at: number;
}

interface ExpectedSupersessionEdge {
  predecessorFactId: string;
  successorFactId: string;
  supersededAt: number;
}

export interface PersistFactContributionSupersessionsInput {
  contributionId: string;
  contributionStatus: MemoryFactContributionWriteReceipt['status'];
  successor: MemoryFact;
  superseded: ReadonlyArray<Pick<MemoryFact, 'id' | 'invalidAt'>>;
  pinnedInputExplicit: boolean;
  reviewStateInputExplicit: boolean;
}

function fail(code: string): never {
  throw new Error(code);
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

function requirePolicyVersion(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_POLICY_VERSION
  ) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return value as number;
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

function requireContributionStatus(value: unknown): MemoryFactContributionWriteReceipt['status'] {
  if (value !== 'created' && value !== 'replayed') {
    fail('memory_fact_contribution_supersession_status_invalid');
  }
  return value;
}

function requireSuccessor(input: unknown): MemoryFact {
  if (!input || typeof input !== 'object') {
    fail('memory_fact_contribution_supersession_successor_invalid');
  }
  const successor = input as MemoryFact;
  if (
    typeof successor.id !== 'string' ||
    successor.id.length < 1 ||
    successor.id.length > 512 ||
    typeof successor.pinned !== 'boolean' ||
    !closedMemoryFactReviewState(successor.reviewState) ||
    !closedMemoryFactSensitivity(successor.sensitivity)
  ) {
    fail('memory_fact_contribution_supersession_successor_invalid');
  }
  requireSafeTimestamp(successor.createdAt);
  return successor;
}

function normalizeExpectedEdges(
  superseded: unknown,
  successorFactId: string,
): ExpectedSupersessionEdge[] {
  if (!Array.isArray(superseded)) {
    fail('memory_fact_contribution_supersession_invalid');
  }
  const seen = new Set<string>();
  const edges = superseded.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      fail('memory_fact_contribution_supersession_invalid');
    }
    const predecessor = candidate as Pick<MemoryFact, 'id' | 'invalidAt'>;
    if (
      typeof predecessor.id !== 'string' ||
      predecessor.id.length < 1 ||
      predecessor.id.length > 512 ||
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
  edges.sort((left, right) => left.predecessorFactId.localeCompare(right.predecessorFactId));
  if (edges.length > 1) {
    const expectedTimestamp = edges[0]!.supersededAt;
    if (edges.some((edge) => edge.supersededAt !== expectedTimestamp)) {
      fail('memory_fact_contribution_supersession_timestamp_mismatch');
    }
  }
  return edges;
}

function readSnapshot(contributionId: string): SupersessionSnapshotRow | null {
  return getSchemaReadyMemoryDb().getFirstSync<SupersessionSnapshotRow>(
    `SELECT contribution_id, successor_fact_id, superseded_at, snapshot_version,
            pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
            successor_review_state_baseline, successor_sensitivity_floor,
            successor_sensitivity_policy_version
       FROM memory_fact_contribution_supersession_snapshots
      WHERE contribution_id = ?
      LIMIT 1`,
    contributionId,
  );
}

function readEdges(contributionId: string): SupersessionEdgeRow[] {
  return getSchemaReadyMemoryDb().getAllSync<SupersessionEdgeRow>(
    `SELECT predecessor_fact_id, successor_fact_id, superseded_at
       FROM memory_fact_contribution_supersessions
      WHERE contribution_id = ?
      ORDER BY predecessor_fact_id ASC`,
    contributionId,
  );
}

function requireContribution(
  contributionId: string,
  successor: MemoryFact,
): { contribution: ContributionRow; successorCreatedAt: number } {
  const db = getSchemaReadyMemoryDb();
  const contribution = db.getFirstSync<ContributionRow>(
    `SELECT fact_id, memory_owner_id, payload_version, payload_json, payload_sha256,
            payload_byte_length, contributed_at
       FROM memory_fact_contributions
      WHERE id = ?
      LIMIT 1`,
    contributionId,
  );
  if (!contribution) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  const contributedAt = requireSafeTimestamp(contribution.contributed_at);
  const persistedSuccessor = db.getFirstSync<
    Pick<FactRow, 'id' | 'memory_owner_id' | 'invalid_at' | 'deleted_at' | 'created_at'>
  >(
    `SELECT id, memory_owner_id, invalid_at, deleted_at, created_at
       FROM memory_facts
      WHERE id = ?
      LIMIT 1`,
    successor.id,
  );
  if (!persistedSuccessor) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  const successorCreatedAt = requireSafeTimestamp(persistedSuccessor.created_at);
  if (
    contribution.fact_id !== successor.id ||
    contribution.memory_owner_id !== getLocalMemoryVaultOwnerId(db) ||
    successor.memoryOwnerId !== contribution.memory_owner_id ||
    successor.createdAt !== successorCreatedAt ||
    persistedSuccessor.memory_owner_id !== contribution.memory_owner_id
  ) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  if (persistedSuccessor.invalid_at !== null || persistedSuccessor.deleted_at !== null) {
    fail('memory_fact_contribution_replay_target_changed');
  }
  return {
    contribution: { ...contribution, contributed_at: contributedAt },
    successorCreatedAt,
  };
}

function assertSnapshotHeader(
  snapshot: SupersessionSnapshotRow,
  input: {
    contributionId: string;
    successorFactId: string;
    pinnedInputExplicit: 0 | 1;
    reviewStateInputExplicit: 0 | 1;
    contributedAt: number;
    successorCreatedAt: number;
  },
): void {
  if (
    snapshot.contribution_id !== input.contributionId ||
    snapshot.successor_fact_id !== input.successorFactId ||
    snapshot.snapshot_version !== SNAPSHOT_VERSION ||
    snapshot.superseded_at !== input.contributedAt ||
    snapshot.superseded_at !== input.successorCreatedAt ||
    requireStoredBooleanFlag(snapshot.pinned_input_explicit) !== input.pinnedInputExplicit ||
    requireStoredBooleanFlag(snapshot.review_state_input_explicit) !==
      input.reviewStateInputExplicit
  ) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  requireSafeTimestamp(snapshot.superseded_at);
  requireStoredBooleanFlag(snapshot.successor_pinned_baseline);
  requireReviewState(snapshot.successor_review_state_baseline);
  requireSensitivity(snapshot.successor_sensitivity_floor);
  const policyVersion = requirePolicyVersion(snapshot.successor_sensitivity_policy_version);
  if (policyVersion > MEMORY_FACT_SENSITIVITY_POLICY_VERSION) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
}

function assertExactEdges(
  actual: ReadonlyArray<SupersessionEdgeRow>,
  expected: ReadonlyArray<ExpectedSupersessionEdge>,
  snapshot: SupersessionSnapshotRow,
): void {
  if (actual.length !== expected.length || actual.length === 0) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  for (let index = 0; index < actual.length; index += 1) {
    const row = actual[index]!;
    const edge = expected[index]!;
    if (
      row.predecessor_fact_id !== edge.predecessorFactId ||
      row.successor_fact_id !== edge.successorFactId ||
      row.superseded_at !== edge.supersededAt ||
      row.successor_fact_id !== snapshot.successor_fact_id ||
      row.superseded_at !== snapshot.superseded_at
    ) {
      fail('memory_fact_contribution_supersession_replay_mismatch');
    }
  }
}

function assertSealedReplayChildren(
  input: {
    contributionId: string;
    successorFactId: string;
    pinnedInputExplicit: 0 | 1;
    reviewStateInputExplicit: 0 | 1;
    contributedAt: number;
    successorCreatedAt: number;
  },
  expectedEdges: ReadonlyArray<ExpectedSupersessionEdge>,
): void {
  const snapshot = readSnapshot(input.contributionId);
  const actualEdges = readEdges(input.contributionId);
  if (!snapshot) {
    if (actualEdges.length !== 0 || expectedEdges.length !== 0) {
      fail('memory_fact_contribution_supersession_replay_mismatch');
    }
    return;
  }
  assertSnapshotHeader(snapshot, input);
  if (actualEdges.length === 0) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  if (expectedEdges.length === 0) {
    for (const edge of actualEdges) {
      if (
        edge.successor_fact_id !== snapshot.successor_fact_id ||
        edge.superseded_at !== snapshot.superseded_at ||
        typeof edge.predecessor_fact_id !== 'string' ||
        edge.predecessor_fact_id.length < 1 ||
        edge.predecessor_fact_id.length > 512
      ) {
        fail('memory_fact_contribution_supersession_replay_mismatch');
      }
    }
    return;
  }
  assertExactEdges(actualEdges, expectedEdges, snapshot);
}

function requireCreatedSuccessorProjection(input: {
  contribution: ContributionRow;
  successor: MemoryFact;
  supersededAt: number;
}): {
  pinned: 0 | 1;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
  sensitivityPolicyVersion: number;
} {
  const db = getSchemaReadyMemoryDb();
  const row = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    input.successor.id,
  );
  if (!row) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  const rowPinned = requireStoredBooleanFlag(row.pinned);
  const rowReviewState = requireReviewState(row.review_state);
  const rowSensitivity = requireSensitivity(row.sensitivity);
  const rowPolicyVersion = requirePolicyVersion(row.sensitivity_policy_version);
  if (
    row.id !== input.successor.id ||
    row.memory_owner_id !== getLocalMemoryVaultOwnerId(db) ||
    input.contribution.fact_id !== row.id ||
    input.contribution.memory_owner_id !== row.memory_owner_id ||
    input.contribution.contributed_at !== input.supersededAt ||
    row.created_at !== input.supersededAt ||
    input.successor.createdAt !== row.created_at ||
    input.successor.memoryOwnerId !== row.memory_owner_id ||
    input.successor.pinned !== (rowPinned === 1) ||
    input.successor.reviewState !== rowReviewState ||
    input.successor.sensitivity !== rowSensitivity
  ) {
    fail('memory_fact_contribution_supersession_successor_mismatch');
  }
  if (rowPolicyVersion !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return {
    pinned: rowPinned,
    reviewState: rowReviewState,
    sensitivity: rowSensitivity,
    sensitivityPolicyVersion: rowPolicyVersion,
  };
}

function assertBaselineMatchesCausalPresence(input: {
  contribution: ContributionRow;
  projection: {
    pinned: 0 | 1;
    reviewState: MemoryFactReviewState;
  };
  pinnedInputExplicit: 0 | 1;
  reviewStateInputExplicit: 0 | 1;
}): void {
  const payload = decodeMemoryFactContributionPayload({
    payloadVersion: input.contribution.payload_version,
    payloadJson: input.contribution.payload_json,
    payloadSha256: input.contribution.payload_sha256,
    payloadByteLength: input.contribution.payload_byte_length,
  });
  if (
    (input.pinnedInputExplicit === 1
      ? payload.input.pinned !== (input.projection.pinned === 1)
      : payload.input.pinned !== false) ||
    (input.reviewStateInputExplicit === 1
      ? payload.input.reviewState !== input.projection.reviewState
      : payload.input.reviewState !== 'auto')
  ) {
    fail('memory_fact_contribution_supersession_projection_mismatch');
  }
}

/** Persist or validate the sealed child set for one contributed fact supersession. */
export function persistFactContributionSupersessionsInTransaction(
  input: PersistFactContributionSupersessionsInput,
): void {
  if (
    typeof input?.contributionId !== 'string' ||
    !CONTRIBUTION_ID_PATTERN.test(input.contributionId)
  ) {
    fail('memory_fact_contribution_supersession_contribution_id_invalid');
  }
  const contributionStatus = requireContributionStatus(input.contributionStatus);
  const successor = requireSuccessor(input.successor);
  const pinnedInputExplicit = requireBooleanFlag(input.pinnedInputExplicit);
  const reviewStateInputExplicit = requireBooleanFlag(input.reviewStateInputExplicit);
  const expectedEdges = normalizeExpectedEdges(input.superseded, successor.id);
  const parent = requireContribution(input.contributionId, successor);
  const contribution = parent.contribution;
  const validationInput = {
    contributionId: input.contributionId,
    successorFactId: successor.id,
    pinnedInputExplicit,
    reviewStateInputExplicit,
    contributedAt: contribution.contributed_at,
    successorCreatedAt: parent.successorCreatedAt,
  };

  if (contributionStatus === 'replayed') {
    assertSealedReplayChildren(validationInput, expectedEdges);
    return;
  }

  const existingSnapshot = readSnapshot(input.contributionId);
  const existingEdges = readEdges(input.contributionId);
  if (existingSnapshot || existingEdges.length > 0) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }
  if (expectedEdges.length === 0) return;

  const db = getSchemaReadyMemoryDb();
  const supersededAt = expectedEdges[0]!.supersededAt;
  const projection = requireCreatedSuccessorProjection({ contribution, successor, supersededAt });
  assertBaselineMatchesCausalPresence({
    contribution,
    projection,
    pinnedInputExplicit,
    reviewStateInputExplicit,
  });

  db.runSync(
    `INSERT INTO memory_fact_contribution_supersession_snapshots(
       contribution_id, successor_fact_id, superseded_at, snapshot_version,
       pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
       successor_review_state_baseline, successor_sensitivity_floor,
       successor_sensitivity_policy_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.contributionId,
    successor.id,
    supersededAt,
    SNAPSHOT_VERSION,
    pinnedInputExplicit,
    reviewStateInputExplicit,
    projection.pinned,
    projection.reviewState,
    projection.sensitivity,
    projection.sensitivityPolicyVersion,
  );
  for (const edge of expectedEdges) {
    db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, ?)`,
      input.contributionId,
      edge.predecessorFactId,
      edge.successorFactId,
      edge.supersededAt,
    );
  }
}
