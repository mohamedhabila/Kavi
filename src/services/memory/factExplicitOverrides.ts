import { runAfterMemoryTransactionCommit, runMemoryTransaction } from './access/transaction';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from './access/schemaGuard';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  requireMemoryFactReviewState,
  requireMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { rowToFact, type FactRow, type MemoryFact } from './facts/types';
import { canManageMemoryFactFromScope } from './memoryFactActionAuthorization';
import {
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from './memorySensitivityPolicy';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

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

interface AuthorizedFact {
  db: MemoryDatabase;
  row: FactRow;
  fact: MemoryFact;
  memoryOwnerId: string;
}

export interface FactExplicitOverrideMutationResult {
  status: 'updated' | 'unchanged';
  fact: MemoryFact;
  override: FactExplicitOverride;
}

export interface FactExplicitInvalidationResult extends FactExplicitOverrideMutationResult {
  invalidatedAt: number;
}

function fail(code: FactExplicitOverrideMutationErrorCode): never {
  throw new FactExplicitOverrideMutationError(code);
}

function requireClock(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) fail('clock_invalid');
  return value;
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

function requirePinned(value: unknown): boolean {
  if (typeof value !== 'boolean') fail('pinned_invalid');
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
    [pinnedAt, reviewStateAt, sensitivityFloorAt, explicitInvalidatedAt].some(
      (clock) => clock !== null && (clock < createdAt || clock > updatedAt),
    )
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

export function overlayFactExplicitApplicabilityInTransaction(input: {
  factId: string;
  derivedReviewState: MemoryFactReviewState;
  derivedSensitivity: MemoryFactSensitivity;
}): { reviewState: MemoryFactReviewState; sensitivity: MemoryFactSensitivity } {
  const override = loadFactExplicitOverrideInTransaction(input.factId);
  return {
    reviewState: override?.reviewStateOverride ?? input.derivedReviewState,
    sensitivity: override?.sensitivityFloor
      ? maxMemoryFactSensitivity(input.derivedSensitivity, override.sensitivityFloor)
      : input.derivedSensitivity,
  };
}

function loadFact(db: MemoryDatabase, factId: string): FactRow {
  const row = db.getFirstSync<FactRow>('SELECT * FROM memory_facts WHERE id = ? LIMIT 1', factId);
  if (!row || row.deleted_at !== null) fail('not_found');
  return row;
}

function requireLocalFact(row: FactRow, memoryOwnerId: string): MemoryFact {
  if (row.memory_owner_id !== memoryOwnerId) fail('owner_mismatch');
  const fact = rowToFact(row);
  if (fact.memoryOwnerId !== memoryOwnerId) fail('owner_mismatch');
  return fact;
}

function authorizeManagedFact(factId: string): AuthorizedFact {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const row = loadFact(db, factId);
  return { db, row, fact: requireLocalFact(row, memoryOwnerId), memoryOwnerId };
}

function authorizeScopedFact(
  factId: string,
  currentScope: MemoryAccessScopeIdentity,
): AuthorizedFact {
  const db = getSchemaReadyMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const scope: RequiredMemoryAccessScopeIdentity = requireMemoryAccessScopeIdentity(currentScope);
  if (scope.memoryOwnerId !== memoryOwnerId) fail('owner_mismatch');
  const row = loadFact(db, factId);
  const fact = requireLocalFact(row, memoryOwnerId);
  if (!canManageMemoryFactFromScope(fact, scope)) fail('scope_mismatch');
  return { db, row, fact, memoryOwnerId };
}

function requireTemporalShape(row: FactRow): void {
  if (
    !Number.isSafeInteger(row.created_at) ||
    !Number.isSafeInteger(row.valid_at) ||
    !Number.isSafeInteger(row.updated_at) ||
    (row.invalid_at !== null && !Number.isSafeInteger(row.invalid_at)) ||
    (row.expires_at !== null && !Number.isSafeInteger(row.expires_at)) ||
    row.created_at < 0 ||
    row.valid_at < 0 ||
    row.updated_at < 0 ||
    row.updated_at < row.created_at ||
    (row.invalid_at !== null && row.invalid_at < 0) ||
    (row.expires_at !== null && row.expires_at < 0)
  ) {
    fail('inactive');
  }
}

function requireActiveAt(row: FactRow, now: number): void {
  requireTemporalShape(row);
  if (
    row.created_at > now ||
    row.valid_at > now ||
    (row.invalid_at !== null && row.invalid_at <= now) ||
    (row.expires_at !== null && row.expires_at <= now)
  ) {
    fail('inactive');
  }
}

function emptyOverride(target: AuthorizedFact, now: number): FactExplicitOverride {
  return {
    factId: target.fact.id,
    memoryOwnerId: target.memoryOwnerId,
    pinnedOverride: null,
    pinnedAt: null,
    reviewStateOverride: null,
    reviewStateAt: null,
    sensitivityFloor: null,
    sensitivityFloorAt: null,
    explicitInvalidatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function persistOverride(
  target: AuthorizedFact,
  value: FactExplicitOverride,
  exists: boolean,
): void {
  if (exists) {
    const result = target.db.runSync(
      `UPDATE memory_fact_explicit_overrides
          SET pinned_override = ?, pinned_at = ?, review_state_override = ?, review_state_at = ?,
              sensitivity_floor = ?, sensitivity_floor_at = ?, explicit_invalidated_at = ?,
              updated_at = ?
        WHERE fact_id = ? AND memory_owner_id = ?`,
      value.pinnedOverride === null ? null : value.pinnedOverride ? 1 : 0,
      value.pinnedAt,
      value.reviewStateOverride,
      value.reviewStateAt,
      value.sensitivityFloor,
      value.sensitivityFloorAt,
      value.explicitInvalidatedAt,
      value.updatedAt,
      value.factId,
      value.memoryOwnerId,
    );
    if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
    return;
  }
  target.db.runSync(
    `INSERT INTO memory_fact_explicit_overrides(
       fact_id, memory_owner_id, pinned_override, pinned_at, review_state_override,
       review_state_at, sensitivity_floor, sensitivity_floor_at, explicit_invalidated_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    value.factId,
    value.memoryOwnerId,
    value.pinnedOverride === null ? null : value.pinnedOverride ? 1 : 0,
    value.pinnedAt,
    value.reviewStateOverride,
    value.reviewStateAt,
    value.sensitivityFloor,
    value.sensitivityFloorAt,
    value.explicitInvalidatedAt,
    value.createdAt,
    value.updatedAt,
  );
}

function updatedOverride(
  target: AuthorizedFact,
  now: number,
  change: (current: FactExplicitOverride) => FactExplicitOverride,
): { previous: FactExplicitOverride | null; next: FactExplicitOverride } {
  const previous = loadFactExplicitOverrideInTransaction(target.fact.id);
  const baseline = previous ?? emptyOverride(target, now);
  if (previous && previous.memoryOwnerId !== target.memoryOwnerId) fail('owner_mismatch');
  if (now < baseline.createdAt) fail('clock_regression');
  const next = change(baseline);
  persistOverride(target, next, previous !== null);
  return { previous, next };
}

function rereadFact(target: AuthorizedFact): MemoryFact {
  return rowToFact(loadFact(target.db, target.fact.id));
}

function notifyAfterCommit(target: AuthorizedFact): void {
  runAfterMemoryTransactionCommit(() =>
    notifyStructuredMemoryChanged(target.fact.originConversationId),
  );
}

function setPinnedProjection(target: AuthorizedFact, pinned: boolean): boolean {
  if (target.row.pinned === (pinned ? 1 : 0)) return false;
  const result = target.db.runSync(
    `UPDATE memory_facts SET pinned = ?
      WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL`,
    pinned ? 1 : 0,
    target.fact.id,
    target.memoryOwnerId,
  );
  if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
  return true;
}

function setReviewStateProjection(
  target: AuthorizedFact,
  reviewState: MemoryFactReviewState,
): boolean {
  if (target.row.review_state === reviewState) return false;
  const result = target.db.runSync(
    `UPDATE memory_facts SET review_state = ?
      WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL`,
    reviewState,
    target.fact.id,
    target.memoryOwnerId,
  );
  if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
  return true;
}

function effectiveSensitivityProjection(
  target: AuthorizedFact,
  floor: MemoryFactSensitivity,
): MemoryFactSensitivity {
  const policySensitivity =
    target.row.sensitivity_policy_version === MEMORY_FACT_SENSITIVITY_POLICY_VERSION
      ? (closedMemoryFactSensitivity(target.row.sensitivity) ?? 'restricted')
      : 'restricted';
  return maxMemoryFactSensitivity(policySensitivity, floor);
}

function setSensitivityProjection(target: AuthorizedFact, floor: MemoryFactSensitivity): boolean {
  const effectiveSensitivity = effectiveSensitivityProjection(target, floor);
  if (target.row.sensitivity === effectiveSensitivity) return false;
  const result = target.db.runSync(
    `UPDATE memory_facts SET sensitivity = ?
      WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL`,
    effectiveSensitivity,
    target.fact.id,
    target.memoryOwnerId,
  );
  if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
  return true;
}

function setPinned(
  target: AuthorizedFact,
  pinned: boolean,
  now: number,
): FactExplicitOverrideMutationResult {
  requireTemporalShape(target.row);
  if (now < target.row.created_at) fail('clock_regression');
  const previous = loadFactExplicitOverrideInTransaction(target.fact.id);
  if (previous?.pinnedOverride === pinned) {
    const repaired = setPinnedProjection(target, pinned);
    if (repaired) notifyAfterCommit(target);
    return {
      status: 'unchanged',
      fact: repaired ? rereadFact(target) : target.fact,
      override: previous,
    };
  }
  if (previous?.pinnedAt !== null && previous?.pinnedAt !== undefined && now <= previous.pinnedAt) {
    fail('clock_regression');
  }
  const { next } = updatedOverride(target, now, (current) => ({
    ...current,
    pinnedOverride: pinned,
    pinnedAt: now,
    updatedAt: Math.max(current.updatedAt, now),
  }));
  setPinnedProjection(target, pinned);
  const fact = rereadFact(target);
  notifyAfterCommit(target);
  return { status: 'updated', fact, override: next };
}

function setReviewState(
  target: AuthorizedFact,
  reviewState: MemoryFactReviewState,
  now: number,
): FactExplicitOverrideMutationResult {
  requireActiveAt(target.row, now);
  const previous = loadFactExplicitOverrideInTransaction(target.fact.id);
  if (previous?.reviewStateOverride === reviewState) {
    const repaired = setReviewStateProjection(target, reviewState);
    if (repaired) notifyAfterCommit(target);
    return {
      status: 'unchanged',
      fact: repaired ? rereadFact(target) : target.fact,
      override: previous,
    };
  }
  if (
    previous?.reviewStateAt !== null &&
    previous?.reviewStateAt !== undefined &&
    now <= previous.reviewStateAt
  ) {
    fail('clock_regression');
  }
  const { next } = updatedOverride(target, now, (current) => ({
    ...current,
    reviewStateOverride: reviewState,
    reviewStateAt: now,
    updatedAt: Math.max(current.updatedAt, now),
  }));
  setReviewStateProjection(target, reviewState);
  const fact = rereadFact(target);
  notifyAfterCommit(target);
  return { status: 'updated', fact, override: next };
}

function sensitivityRank(value: MemoryFactSensitivity): number {
  return value === 'normal' ? 0 : value === 'personal' ? 1 : value === 'sensitive' ? 2 : 3;
}

function raiseSensitivityFloor(
  target: AuthorizedFact,
  requestedFloor: MemoryFactSensitivity,
  now: number,
): FactExplicitOverrideMutationResult {
  requireActiveAt(target.row, now);
  const previous = loadFactExplicitOverrideInTransaction(target.fact.id);
  if (
    previous?.sensitivityFloor &&
    sensitivityRank(previous.sensitivityFloor) >= sensitivityRank(requestedFloor)
  ) {
    const repaired = setSensitivityProjection(target, previous.sensitivityFloor);
    if (repaired) notifyAfterCommit(target);
    return {
      status: 'unchanged',
      fact: repaired ? rereadFact(target) : target.fact,
      override: previous,
    };
  }
  if (
    previous?.sensitivityFloorAt !== null &&
    previous?.sensitivityFloorAt !== undefined &&
    now <= previous.sensitivityFloorAt
  ) {
    fail('clock_regression');
  }
  const { next } = updatedOverride(target, now, (current) => ({
    ...current,
    sensitivityFloor: requestedFloor,
    sensitivityFloorAt: now,
    updatedAt: Math.max(current.updatedAt, now),
  }));
  setSensitivityProjection(target, requestedFloor);
  const fact = rereadFact(target);
  notifyAfterCommit(target);
  return { status: 'updated', fact, override: next };
}

function invalidate(target: AuthorizedFact, now: number): FactExplicitInvalidationResult {
  requireTemporalShape(target.row);
  const previous = loadFactExplicitOverrideInTransaction(target.fact.id);
  if (previous?.explicitInvalidatedAt !== null && previous?.explicitInvalidatedAt !== undefined) {
    const effectiveInvalidatedAt =
      target.row.invalid_at === null
        ? previous.explicitInvalidatedAt
        : Math.min(target.row.invalid_at, previous.explicitInvalidatedAt);
    const repaired = target.row.invalid_at !== effectiveInvalidatedAt;
    if (repaired) {
      const result = target.db.runSync(
        `UPDATE memory_facts SET invalid_at = ?, updated_at = ?
          WHERE id = ? AND memory_owner_id = ? AND deleted_at IS NULL`,
        effectiveInvalidatedAt,
        Math.max(target.row.updated_at, effectiveInvalidatedAt),
        target.fact.id,
        target.memoryOwnerId,
      );
      if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
      notifyAfterCommit(target);
    }
    return {
      status: 'unchanged',
      fact: repaired ? rereadFact(target) : target.fact,
      override: previous,
      invalidatedAt: previous.explicitInvalidatedAt,
    };
  }
  if (target.row.invalid_at !== null) fail('already_invalidated');
  if (!Number.isSafeInteger(target.row.updated_at) || now < target.row.updated_at) {
    fail('clock_regression');
  }
  const { next } = updatedOverride(target, now, (current) => ({
    ...current,
    explicitInvalidatedAt: now,
    updatedAt: Math.max(current.updatedAt, now),
  }));
  const result = target.db.runSync(
    `UPDATE memory_facts SET invalid_at = ?, updated_at = ?
      WHERE id = ? AND memory_owner_id = ? AND invalid_at IS NULL AND deleted_at IS NULL`,
    now,
    now,
    target.fact.id,
    target.memoryOwnerId,
  );
  if ((result.changes ?? 0) !== 1) fail('projection_update_failed');
  const fact = rereadFact(target);
  notifyAfterCommit(target);
  return { status: 'updated', fact, override: next, invalidatedAt: now };
}

export function setScopedMemoryFactPinned(input: {
  factId: string;
  currentScope: MemoryAccessScopeIdentity;
  pinned: boolean;
  now?: number;
}): FactExplicitOverrideMutationResult {
  const factId = requireFactId(input.factId);
  const pinned = requirePinned(input.pinned);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() =>
    setPinned(authorizeScopedFact(factId, input.currentScope), pinned, now),
  );
}

export function setManagedMemoryFactPinned(input: {
  factId: string;
  pinned: boolean;
  now?: number;
}): FactExplicitOverrideMutationResult {
  const factId = requireFactId(input.factId);
  const pinned = requirePinned(input.pinned);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() => setPinned(authorizeManagedFact(factId), pinned, now));
}

export function setScopedMemoryFactReviewState(input: {
  factId: string;
  currentScope: MemoryAccessScopeIdentity;
  reviewState: MemoryFactReviewState;
  now?: number;
}): FactExplicitOverrideMutationResult {
  const factId = requireFactId(input.factId);
  const reviewState = requireMemoryFactReviewState(input.reviewState);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() =>
    setReviewState(authorizeScopedFact(factId, input.currentScope), reviewState, now),
  );
}

export function raiseScopedMemoryFactSensitivityFloor(input: {
  factId: string;
  currentScope: MemoryAccessScopeIdentity;
  sensitivityFloor: MemoryFactSensitivity;
  now?: number;
}): FactExplicitOverrideMutationResult {
  const factId = requireFactId(input.factId);
  const sensitivityFloor = requireMemoryFactSensitivity(input.sensitivityFloor);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() =>
    raiseSensitivityFloor(authorizeScopedFact(factId, input.currentScope), sensitivityFloor, now),
  );
}

export function invalidateScopedMemoryFact(input: {
  factId: string;
  currentScope: MemoryAccessScopeIdentity;
  now?: number;
}): FactExplicitInvalidationResult {
  const factId = requireFactId(input.factId);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() =>
    invalidate(authorizeScopedFact(factId, input.currentScope), now),
  );
}

export function invalidateManagedMemoryFact(input: {
  factId: string;
  now?: number;
}): FactExplicitInvalidationResult {
  const factId = requireFactId(input.factId);
  const now = requireClock(input.now ?? Date.now());
  return runMemoryTransaction(() => invalidate(authorizeManagedFact(factId), now));
}
