import type { RawFactEvidenceRow } from './factContributionAggregateQueries';
import type { FactContributionFactEvidence } from './factContributionAggregateTypes';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import type { FactContributionExplicitProjection } from './facts/factContributionProjection';
import { maxMemoryFactSensitivity } from './memorySensitivityPolicy';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

const ABSENT_OVERRIDE_FIELDS = [
  'override_memory_owner_id',
  'override_pinned_override',
  'override_pinned_at',
  'override_review_state_override',
  'override_review_state_at',
  'override_sensitivity_floor',
  'override_sensitivity_floor_at',
  'override_explicit_invalidated_at',
  'override_created_at',
  'override_updated_at',
] as const;

function fail(): never {
  throw new Error('memory_fact_contribution_aggregate_integrity_invalid');
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function requireNullableTimestamp(value: unknown): number | null {
  return value === null ? null : requireTimestamp(value);
}

function requireNullablePinned(value: unknown): boolean | null {
  if (value === null) return null;
  if (value === 0) return false;
  if (value === 1) return true;
  return fail();
}

function requirePairedClock(
  valuePresent: boolean,
  rawClock: unknown,
  createdAt: number,
  updatedAt: number,
): number | null {
  const clock = requireNullableTimestamp(rawClock);
  if (valuePresent !== (clock !== null)) fail();
  if (clock !== null && (clock < createdAt || clock > updatedAt)) fail();
  return clock;
}

function requireAbsentOverride(row: RawFactEvidenceRow): null {
  if (ABSENT_OVERRIDE_FIELDS.some((field) => row[field] !== null)) fail();
  return null;
}

function requireExplicitProjection(
  row: RawFactEvidenceRow,
  fact: Readonly<FactContributionFactEvidence>,
  allowRepairableProjectionDrift: boolean,
): Readonly<FactContributionExplicitProjection> | null {
  if (row.override_fact_id === null) return requireAbsentOverride(row);
  if (
    !isExactMemoryProvenanceId(row.override_fact_id) ||
    !isExactMemoryScopeId(row.override_memory_owner_id) ||
    row.override_fact_id !== fact.id ||
    row.override_memory_owner_id !== fact.memoryOwnerId ||
    fact.deletedAt !== null
  ) {
    return fail();
  }

  const createdAt = requireTimestamp(row.override_created_at);
  const updatedAt = requireTimestamp(row.override_updated_at);
  const pinnedOverride = requireNullablePinned(row.override_pinned_override);
  const reviewStateOverride =
    row.override_review_state_override === null
      ? null
      : (closedMemoryFactReviewState(row.override_review_state_override) ?? fail());
  const sensitivityFloor =
    row.override_sensitivity_floor === null
      ? null
      : (closedMemoryFactSensitivity(row.override_sensitivity_floor) ?? fail());
  const explicitInvalidatedAt = requireNullableTimestamp(row.override_explicit_invalidated_at);
  if (
    createdAt < fact.createdAt ||
    updatedAt < createdAt ||
    (explicitInvalidatedAt !== null &&
      (explicitInvalidatedAt < fact.createdAt || explicitInvalidatedAt > updatedAt))
  ) {
    return fail();
  }
  requirePairedClock(pinnedOverride !== null, row.override_pinned_at, createdAt, updatedAt);
  requirePairedClock(
    reviewStateOverride !== null,
    row.override_review_state_at,
    createdAt,
    updatedAt,
  );
  requirePairedClock(
    sensitivityFloor !== null,
    row.override_sensitivity_floor_at,
    createdAt,
    updatedAt,
  );
  if (
    (pinnedOverride === null &&
      reviewStateOverride === null &&
      sensitivityFloor === null &&
      explicitInvalidatedAt === null) ||
    (!allowRepairableProjectionDrift &&
      pinnedOverride !== null &&
      fact.pinned !== pinnedOverride) ||
    (!allowRepairableProjectionDrift &&
      reviewStateOverride !== null &&
      fact.reviewState !== reviewStateOverride) ||
    (!allowRepairableProjectionDrift &&
      sensitivityFloor !== null &&
      maxMemoryFactSensitivity(fact.sensitivity, sensitivityFloor) !== fact.sensitivity) ||
    (explicitInvalidatedAt !== null && fact.invalidAt !== explicitInvalidatedAt)
  ) {
    return fail();
  }
  return Object.freeze({
    pinnedOverride,
    reviewStateOverride,
    sensitivityFloor,
    explicitInvalidatedAt,
  });
}

/** Decode and cross-check fact-owned explicit intent against its canonical projection. */
export function requireFactContributionExplicitProjection(
  row: RawFactEvidenceRow,
  fact: Readonly<FactContributionFactEvidence>,
): Readonly<FactContributionExplicitProjection> | null {
  return requireExplicitProjection(row, fact, false);
}

/**
 * Replay-only view: pin, review, and sensitivity overlays may be repaired from verified intent.
 * Deletion and explicit invalidation remain unconditional fences.
 */
export function requireFactContributionExplicitProjectionForReplay(
  row: RawFactEvidenceRow,
  fact: Readonly<FactContributionFactEvidence>,
): Readonly<FactContributionExplicitProjection> | null {
  return requireExplicitProjection(row, fact, true);
}
