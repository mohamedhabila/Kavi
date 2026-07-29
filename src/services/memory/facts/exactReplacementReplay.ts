import { getSchemaReadyMemoryDb } from '../access/schemaGuard';
import { runAfterMemoryTransactionCommit } from '../access/transaction';
import { advanceRestrictiveMemoryAuthorityInTransaction } from '../memoryAuthority';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import type { MemoryFactContributionPayloadV2 } from '../factContributionCodec';
import {
  persistFactContributionInTransaction,
  type MemoryFactContributionReplay,
  type MemoryFactContributionWriteContext,
} from '../factContributionStore';
import { loadVerifiedFactContributionAggregatesForReplayInTransaction } from '../factContributionAggregateStore';
import { loadFactExplicitOverrideInTransaction } from '../factExplicitOverrideState';
import {
  classifyMemoryFactSensitivity,
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from '../memorySensitivityPolicy';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './applicabilityProvenance';
import { mergeDuplicateReviewState } from './duplicateMetadata';
import { projectFactFromSurvivingContributions } from './factContributionProjection';
import { rowToFact, type FactRow, type MemoryFact, type ReplaceCurrentFactResult } from './types';

const SNAPSHOT_VERSION = 1;
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;

export interface ExactReplacementReplayState {
  contributionId: string;
  predecessor: FactRow;
  successor: FactRow;
  supersededAt: number;
  pinnedInputExplicit: boolean;
  reviewStateInputExplicit: boolean;
  successorPinnedBaseline: boolean;
  successorReviewStateBaseline: MemoryFactReviewState;
  successorSensitivityFloor: MemoryFactSensitivity;
}

export class ExactReplacementReplayTargetChanged extends Error {
  constructor() {
    super('memory_fact_contribution_replay_target_changed');
  }
}

function fail(code: string): never {
  throw new Error(code);
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return value as number;
}

function requireFlag(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) {
    fail('memory_fact_contribution_supersession_snapshot_invalid');
  }
  return value;
}

function requirePinned(row: FactRow): boolean {
  if (row.pinned !== 0 && row.pinned !== 1) {
    fail('memory_fact_projection_invalid');
  }
  return row.pinned === 1;
}

function requireReviewState(value: unknown): MemoryFactReviewState {
  return closedMemoryFactReviewState(value) ?? fail('memory_fact_projection_invalid');
}

function requireSensitivity(value: unknown): MemoryFactSensitivity {
  return closedMemoryFactSensitivity(value) ?? fail('memory_fact_projection_invalid');
}

function classifiedSensitivity(row: FactRow): MemoryFactSensitivity {
  const db = getSchemaReadyMemoryDb();
  const subject = db.getFirstSync<{ canonical_name: string }>(
    'SELECT canonical_name FROM memory_entities WHERE id = ? LIMIT 1',
    row.subject_id,
  );
  let attributes: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.attributes) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'restricted';
    attributes = parsed as Record<string, unknown>;
  } catch {
    return 'restricted';
  }
  return classifyMemoryFactSensitivity({
    declaredSensitivity:
      row.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
        ? row.sensitivity
        : 'restricted',
    subject: subject?.canonical_name,
    predicate: row.predicate,
    objectText: row.object_text,
    attributes,
    sourceSummary: row.source_summary ?? undefined,
  });
}

function currentProtectedSensitivity(row: FactRow): MemoryFactSensitivity {
  const stored =
    row.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
      ? (closedMemoryFactSensitivity(row.sensitivity) ?? 'restricted')
      : 'restricted';
  const db = getSchemaReadyMemoryDb();
  const contributionIds = db
    .getAllSync<{ id: string }>(
      `SELECT contribution.id
         FROM memory_fact_contributions AS contribution
         LEFT JOIN memory_retired_fact_contributions AS retired
           ON retired.contribution_id = contribution.id
        WHERE contribution.fact_id = ?
          AND retired.contribution_id IS NULL
        ORDER BY contribution.contributed_at ASC, contribution.id ASC`,
      row.id,
    )
    .map((candidate) => candidate.id);
  if (contributionIds.length === 0) {
    return maxMemoryFactSensitivity(stored, classifiedSensitivity(row));
  }
  const loaded = loadVerifiedFactContributionAggregatesForReplayInTransaction(db, contributionIds);
  if (
    loaded.missingContributionIds.length > 0 ||
    loaded.aggregates.length !== contributionIds.length ||
    loaded.aggregates.some((aggregate) => aggregate.factId !== row.id)
  ) {
    fail('memory_fact_contribution_replay_aggregate_invalid');
  }
  const first = loaded.aggregates[0]!;
  const projection = projectFactFromSurvivingContributions({
    factId: row.id,
    contributions: loaded.aggregates.map((aggregate) => ({
      contributionId: aggregate.contributionId,
      contributedAt: aggregate.contributedAt,
      payload: aggregate.payload,
      supersessionSnapshot: aggregate.supersessionPlan.snapshot,
    })),
    classifierContext: first.classifierContext,
    explicitProjection: first.explicitProjection,
  });
  return maxMemoryFactSensitivity(stored, classifiedSensitivity(row), projection.sensitivity);
}

function applyExplicitProjection(input: {
  row: FactRow;
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
}): {
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
} {
  const override = loadFactExplicitOverrideInTransaction(input.row.id);
  if (
    override?.memoryOwnerId !== undefined &&
    override.memoryOwnerId !== input.row.memory_owner_id
  ) {
    fail('memory_fact_explicit_override_owner_mismatch');
  }
  if (override?.explicitInvalidatedAt !== null && override?.explicitInvalidatedAt !== undefined) {
    throw new ExactReplacementReplayTargetChanged();
  }
  return {
    pinned: override?.pinnedOverride ?? input.pinned,
    reviewState: override?.reviewStateOverride ?? input.reviewState,
    sensitivity: override?.sensitivityFloor
      ? maxMemoryFactSensitivity(input.sensitivity, override.sensitivityFloor)
      : input.sensitivity,
  };
}

function writeProjection(input: {
  row: FactRow;
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
  notify: boolean;
}): FactRow {
  const memoryOwnerId = input.row.memory_owner_id;
  if (!memoryOwnerId) fail('memory_fact_projection_invalid');
  const changed =
    input.row.pinned !== (input.pinned ? 1 : 0) ||
    input.row.review_state !== input.reviewState ||
    input.row.sensitivity !== input.sensitivity ||
    input.row.sensitivity_policy_version !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION;
  if (!changed) return input.row;

  const result = getSchemaReadyMemoryDb().runSync(
    `UPDATE memory_facts
        SET pinned = ?, review_state = ?, sensitivity = ?, sensitivity_policy_version = ?
      WHERE id = ? AND memory_owner_id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
    input.pinned ? 1 : 0,
    input.reviewState,
    input.sensitivity,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    input.row.id,
    memoryOwnerId,
  );
  if ((result.changes ?? 0) !== 1) throw new ExactReplacementReplayTargetChanged();
  advanceRestrictiveMemoryAuthorityInTransaction(getSchemaReadyMemoryDb(), memoryOwnerId);
  if (input.notify) {
    runAfterMemoryTransactionCommit(() =>
      notifyStructuredMemoryChanged(input.row.origin_conversation_id),
    );
  }
  return {
    ...input.row,
    pinned: input.pinned ? 1 : 0,
    review_state: input.reviewState,
    sensitivity: input.sensitivity,
    sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
  };
}

/** Repair the active predecessor projection from canonical explicit intent before inheritance. */
export function canonicalizeExactReplacementPredecessorInTransaction(row: FactRow): FactRow {
  const projection = applyExplicitProjection({
    row,
    pinned: requirePinned(row),
    reviewState: closedMemoryFactReviewState(row.review_state) ?? 'rejected',
    sensitivity: currentProtectedSensitivity(row),
  });
  return writeProjection({ row, ...projection, notify: false });
}

/** Load the one immutable predecessor edge owned by a prior exact replacement event. */
export function loadExactReplacementReplayInTransaction(
  replay: MemoryFactContributionReplay,
): ExactReplacementReplayState | null {
  if (!CONTRIBUTION_ID_PATTERN.test(replay.id)) {
    fail('memory_fact_contribution_supersession_contribution_id_invalid');
  }
  const { snapshot, edges } = replay.supersessionPlan;
  if (!snapshot) {
    if (edges.length > 0) fail('memory_fact_contribution_supersession_replay_mismatch');
    return null;
  }
  if (edges.length !== 1) fail('memory_fact_contribution_supersession_replay_mismatch');

  const edge = edges[0]!;
  const supersededAt = requireTimestamp(snapshot.superseded_at);
  const pinnedInputExplicit = requireFlag(snapshot.pinned_input_explicit);
  const reviewStateInputExplicit = requireFlag(snapshot.review_state_input_explicit);
  const successorPinnedBaseline = requireFlag(snapshot.successor_pinned_baseline);
  const successorReviewStateBaseline = requireReviewState(snapshot.successor_review_state_baseline);
  const successorSensitivityFloor = requireSensitivity(snapshot.successor_sensitivity_floor);
  if (
    snapshot.contribution_id !== replay.id ||
    snapshot.successor_fact_id !== replay.factId ||
    snapshot.snapshot_version !== SNAPSHOT_VERSION ||
    snapshot.successor_sensitivity_policy_version !== MEMORY_FACT_SENSITIVITY_POLICY_VERSION ||
    edge.successor_fact_id !== snapshot.successor_fact_id ||
    edge.superseded_at !== supersededAt ||
    edge.predecessor_fact_id === edge.successor_fact_id
  ) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }

  const db = getSchemaReadyMemoryDb();
  const successor = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    snapshot.successor_fact_id,
  );
  const predecessor = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    edge.predecessor_fact_id,
  );
  if (
    !successor ||
    !predecessor ||
    successor.invalid_at !== null ||
    successor.deleted_at !== null ||
    predecessor.deleted_at !== null
  ) {
    throw new ExactReplacementReplayTargetChanged();
  }
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  if (
    successor.memory_owner_id !== memoryOwnerId ||
    predecessor.memory_owner_id !== memoryOwnerId ||
    successor.created_at !== supersededAt ||
    predecessor.invalid_at !== supersededAt
  ) {
    fail('memory_fact_contribution_supersession_replay_mismatch');
  }

  return {
    contributionId: replay.id,
    predecessor,
    successor,
    supersededAt,
    pinnedInputExplicit: pinnedInputExplicit === 1,
    reviewStateInputExplicit: reviewStateInputExplicit === 1,
    successorPinnedBaseline: successorPinnedBaseline === 1,
    successorReviewStateBaseline,
    successorSensitivityFloor,
  };
}

function repairReplaySuccessorProjection(state: ExactReplacementReplayState): MemoryFact {
  const currentReviewState =
    closedMemoryFactReviewState(state.successor.review_state) ?? 'rejected';
  const projection = applyExplicitProjection({
    row: state.successor,
    pinned: state.successorPinnedBaseline,
    reviewState: mergeDuplicateReviewState(state.successorReviewStateBaseline, currentReviewState),
    sensitivity: maxMemoryFactSensitivity(
      state.successorSensitivityFloor,
      currentProtectedSensitivity(state.successor),
    ),
  });
  return rowToFact(writeProjection({ row: state.successor, ...projection, notify: true }));
}

/** Validate and replay a prior exact replacement without reinforcing or recreating either fact. */
export function finalizeExactReplacementReplayInTransaction(input: {
  replay: MemoryFactContributionReplay;
  state: ExactReplacementReplayState;
  payload: MemoryFactContributionPayloadV2;
  context: MemoryFactContributionWriteContext;
}): ReplaceCurrentFactResult {
  if (
    input.payload.operation.kind !== 'exact_replacement' ||
    input.payload.operation.expectedCurrentFactId !== input.state.predecessor.id
  ) {
    fail('memory_fact_contribution_replay_mismatch');
  }
  const fact = repairReplaySuccessorProjection(input.state);
  const superseded = rowToFact(input.state.predecessor);
  const contribution = persistFactContributionInTransaction({
    fact,
    payload: input.payload,
    context: input.context,
    supersession: {
      superseded: [superseded],
      pinnedInputExplicit: input.state.pinnedInputExplicit,
      reviewStateInputExplicit: input.state.reviewStateInputExplicit,
    },
  });
  if (contribution.id !== input.replay.id || contribution.status !== 'replayed') {
    fail('memory_fact_contribution_replay_mismatch');
  }
  return { fact, status: 'duplicate', superseded: [] };
}
