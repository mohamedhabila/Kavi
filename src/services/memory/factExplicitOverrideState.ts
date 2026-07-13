import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { maxMemoryFactSensitivity } from './memorySensitivityPolicy';

export type FactExplicitOverrideMutationErrorCode =
  | 'clock_invalid'
  | 'clock_regression'
  | 'fact_invalid'
  | 'pinned_invalid'
  | 'not_found'
  | 'owner_mismatch'
  | 'scope_mismatch'
  | 'inactive'
  | 'already_invalidated'
  | 'projection_update_failed'
  | 'override_corrupt';

export class FactExplicitOverrideMutationError extends Error {
  readonly code: FactExplicitOverrideMutationErrorCode;

  constructor(code: FactExplicitOverrideMutationErrorCode) {
    super(`memory_fact_explicit_override_${code}`);
    this.name = 'FactExplicitOverrideMutationError';
    this.code = code;
  }
}

export interface FactExplicitOverride {
  factId: string;
  memoryOwnerId: string;
  pinnedOverride: boolean | null;
  pinnedAt: number | null;
  reviewStateOverride: MemoryFactReviewState | null;
  reviewStateAt: number | null;
  sensitivityFloor: MemoryFactSensitivity | null;
  sensitivityFloorAt: number | null;
  explicitInvalidatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface FactExplicitOverrideRow {
  fact_id: string;
  memory_owner_id: string;
  pinned_override: number | null;
  pinned_at: number | null;
  review_state_override: string | null;
  review_state_at: number | null;
  sensitivity_floor: string | null;
  sensitivity_floor_at: number | null;
  explicit_invalidated_at: number | null;
  created_at: number;
  updated_at: number;
}

function fail(code: FactExplicitOverrideMutationErrorCode): never {
  throw new FactExplicitOverrideMutationError(code);
}

function requireFactId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value
  ) {
    fail('fact_invalid');
  }
  return value;
}

function nullableClock(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('override_corrupt');
}

function decodeOverride(row: FactExplicitOverrideRow): FactExplicitOverride {
  const pinnedAt = nullableClock(row.pinned_at);
  const reviewStateAt = nullableClock(row.review_state_at);
  const sensitivityFloorAt = nullableClock(row.sensitivity_floor_at);
  const explicitInvalidatedAt = nullableClock(row.explicit_invalidated_at);
  const createdAt = nullableClock(row.created_at) ?? fail('override_corrupt');
  const updatedAt = nullableClock(row.updated_at) ?? fail('override_corrupt');
  const pinnedOverride =
    row.pinned_override === null
      ? null
      : row.pinned_override === 0
        ? false
        : row.pinned_override === 1
          ? true
          : fail('override_corrupt');
  const reviewStateOverride =
    row.review_state_override === null
      ? null
      : (closedMemoryFactReviewState(row.review_state_override) ?? fail('override_corrupt'));
  const sensitivityFloor =
    row.sensitivity_floor === null
      ? null
      : (closedMemoryFactSensitivity(row.sensitivity_floor) ?? fail('override_corrupt'));
  if (
    !row.fact_id ||
    !row.memory_owner_id ||
    (pinnedOverride === null) !== (pinnedAt === null) ||
    (reviewStateOverride === null) !== (reviewStateAt === null) ||
    (sensitivityFloor === null) !== (sensitivityFloorAt === null) ||
    createdAt > updatedAt ||
    [pinnedAt, reviewStateAt, sensitivityFloorAt].some(
      (clock) => clock !== null && (clock < createdAt || clock > updatedAt),
    ) ||
    (explicitInvalidatedAt !== null && explicitInvalidatedAt > updatedAt)
  ) {
    fail('override_corrupt');
  }
  return {
    factId: row.fact_id,
    memoryOwnerId: row.memory_owner_id,
    pinnedOverride,
    pinnedAt,
    reviewStateOverride,
    reviewStateAt,
    sensitivityFloor,
    sensitivityFloorAt,
    explicitInvalidatedAt,
    createdAt,
    updatedAt,
  };
}

/** Read canonical explicit intent. Callers that merge projections must already own a transaction. */
export function loadFactExplicitOverrideInTransaction(factId: string): FactExplicitOverride | null {
  const row = getSchemaReadyMemoryDb().getFirstSync<FactExplicitOverrideRow>(
    'SELECT * FROM memory_fact_explicit_overrides WHERE fact_id = ? LIMIT 1',
    requireFactId(factId),
  );
  return row ? decodeOverride(row) : null;
}

export function overlayFactExplicitProjectionInTransaction(input: {
  factId: string;
  derivedPinned: boolean;
  derivedReviewState: MemoryFactReviewState;
  derivedSensitivity: MemoryFactSensitivity;
}): {
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
} {
  const override = loadFactExplicitOverrideInTransaction(input.factId);
  return {
    pinned: override?.pinnedOverride ?? input.derivedPinned,
    reviewState: override?.reviewStateOverride ?? input.derivedReviewState,
    sensitivity: override?.sensitivityFloor
      ? maxMemoryFactSensitivity(input.derivedSensitivity, override.sensitivityFloor)
      : input.derivedSensitivity,
  };
}
