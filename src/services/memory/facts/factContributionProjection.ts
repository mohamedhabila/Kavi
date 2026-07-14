import type { FactContributionSupersessionSnapshotCommitmentRow } from '../factContributionChildCommitments';
import type { MemoryFactContributionPayloadV1 } from '../factContributionCodec';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactClass,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
  type MemorySourceAuthority,
} from './applicabilityProvenance';
import {
  mergeDuplicateProvenance,
  mergeDuplicateReviewState,
  mergeDuplicateSensitivity,
} from './duplicateMetadata';
import { hasExactFactContentIdentity } from './contentIdentity';
import {
  classifyMemoryFactSensitivity,
  maxMemoryFactSensitivity,
  MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
} from '../memorySensitivityPolicy';
import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import type { MemoryDecayPolicy, MemoryFactKind, MemoryFactScope } from './types';

const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;

export interface FactContributionClassifierContext {
  subject: string | null;
  subjectType: string | null;
}

/** A parent and child set that the caller has already verified against its commitments. */
export interface VerifiedFactContributionProjectionInput {
  contributionId: string;
  contributedAt: number;
  payload: MemoryFactContributionPayloadV1;
  supersessionSnapshot: Readonly<FactContributionSupersessionSnapshotCommitmentRow> | null;
}

export interface FactContributionExplicitProjection {
  pinnedOverride: boolean | null;
  reviewStateOverride: MemoryFactReviewState | null;
  sensitivityFloor: MemoryFactSensitivity | null;
  explicitInvalidatedAt: number | null;
}

/**
 * Columns causally owned by contribution payloads and immutable replacement snapshots.
 *
 * The fact id and memory owner come from the aggregate parent. Lifecycle columns (`invalid_at`,
 * `deleted_at`), access and presentation telemetry (`access_count`, `last_recalled_at`,
 * `last_accessed_at`, `last_presented_at`, `last_confirmed_at`, `last_conflicted_at`), and derived
 * indexes (`content_hash`, retrieval terms, local-similarity columns) are intentionally excluded.
 * Their respective lifecycle, telemetry, and indexing owners preserve or rebuild them after this
 * projection is materialized. `firstContributionId` and `lastContributionId` are reducer metadata,
 * not fact-table columns; they make the exported pairwise order precondition enforceable.
 */
export interface FactContributionProjection {
  firstContributionId: string;
  lastContributionId: string;
  subjectId: string;
  predicate: string;
  objectText: string;
  objectEntityId: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
  sourceMessageId: string | null;
  sourceRunId: string | null;
  personaId: string | null;
  factClass: MemoryFactClass;
  sourceAuthority: MemorySourceAuthority;
  scope: MemoryFactScope;
  originConversationId: string | null;
  originThreadId: string | null;
  originTaskId: string | null;
  sourceTurnId: string | null;
  sourceSummary: string | null;
  importance: number;
  repeatedMentionCount: number;
  lastReinforcedAt: number | null;
  decayPolicy: MemoryDecayPolicy;
  expiresAt: number | null;
  validAt: number;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  sourceActorId: string | null;
  retrievability: number;
  stability: number;
  decayRate: number;
  reviewState: MemoryFactReviewState;
  sensitivity: MemoryFactSensitivity;
  sensitivityPolicyVersion: number;
  memoryKind: MemoryFactKind;
}

function fail(code: string): never {
  throw new Error(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareFactContributionProjectionOrder(
  left: Pick<VerifiedFactContributionProjectionInput, 'contributedAt' | 'contributionId'>,
  right: Pick<VerifiedFactContributionProjectionInput, 'contributedAt' | 'contributionId'>,
): number {
  if (left.contributedAt !== right.contributedAt) {
    return left.contributedAt < right.contributedAt ? -1 : 1;
  }
  return compareOrdinal(left.contributionId, right.contributionId);
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('memory_fact_contribution_projection_timestamp_invalid');
  }
  return value as number;
}

function requireContributionId(value: unknown): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value)) {
    fail('memory_fact_contribution_projection_id_invalid');
  }
  return value;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        cloneJsonValue(entry),
      ]),
    );
  }
  return value;
}

function cloneAttributes(value: Record<string, unknown>): Record<string, unknown> {
  return cloneJsonValue(value) as Record<string, unknown>;
}

function requireFactId(value: unknown): string {
  if (!isExactMemoryProvenanceId(value)) {
    fail('memory_fact_contribution_projection_fact_id_invalid');
  }
  return value;
}

function snapshotProjection(
  factId: string,
  input: VerifiedFactContributionProjectionInput,
): {
  pinned: boolean;
  reviewState: MemoryFactReviewState;
  sensitivityFloor: MemoryFactSensitivity | null;
} {
  const snapshot = input.supersessionSnapshot;
  if (!snapshot) {
    if (
      input.payload.operation.kind === 'exact_replacement' &&
      input.payload.operation.expectedCurrentFactId !== factId
    ) {
      fail('memory_fact_contribution_projection_snapshot_missing');
    }
    return {
      pinned: input.payload.input.pinned,
      reviewState: input.payload.input.reviewState,
      sensitivityFloor: null,
    };
  }
  const reviewState = closedMemoryFactReviewState(snapshot.successor_review_state_baseline);
  const sensitivityFloor = closedMemoryFactSensitivity(snapshot.successor_sensitivity_floor);
  const snapshotAuthorized =
    input.payload.operation.kind === 'record'
      ? input.payload.input.supersedePrior
      : !input.payload.input.supersedePrior &&
        input.payload.operation.expectedCurrentFactId !== factId;
  if (
    !snapshotAuthorized ||
    snapshot.contribution_id !== input.contributionId ||
    snapshot.successor_fact_id !== factId ||
    snapshot.superseded_at !== input.contributedAt ||
    snapshot.snapshot_version !== 1 ||
    (snapshot.pinned_input_explicit !== 0 && snapshot.pinned_input_explicit !== 1) ||
    (snapshot.review_state_input_explicit !== 0 &&
      snapshot.review_state_input_explicit !== 1) ||
    (snapshot.successor_pinned_baseline !== 0 && snapshot.successor_pinned_baseline !== 1) ||
    !reviewState ||
    !sensitivityFloor ||
    !Number.isSafeInteger(snapshot.successor_sensitivity_policy_version) ||
    snapshot.successor_sensitivity_policy_version < 1 ||
    snapshot.successor_sensitivity_policy_version > MEMORY_FACT_SENSITIVITY_POLICY_VERSION
  ) {
    fail('memory_fact_contribution_projection_snapshot_invalid');
  }
  return {
    pinned: snapshot.successor_pinned_baseline === 1,
    reviewState,
    sensitivityFloor,
  };
}

function classifyProjectionSensitivity(
  projection: Pick<
    FactContributionProjection,
    'predicate' | 'objectText' | 'attributes' | 'sourceSummary' | 'memoryKind'
  >,
  context: FactContributionClassifierContext,
): MemoryFactSensitivity {
  return classifyMemoryFactSensitivity({
    subject: context.subject,
    subjectType: context.subjectType,
    predicate: projection.predicate,
    objectText: projection.objectText,
    attributes: projection.attributes,
    sourceSummary: projection.sourceSummary,
    memoryKind: projection.memoryKind,
  });
}

function baselineFactContributionProjection(
  factId: string,
  input: VerifiedFactContributionProjectionInput,
  context: FactContributionClassifierContext,
): FactContributionProjection {
  const contributedAt = requireTimestamp(input.contributedAt);
  requireContributionId(input.contributionId);
  if (input.payload.input.now !== contributedAt) {
    fail('memory_fact_contribution_projection_timestamp_mismatch');
  }
  requireFactId(factId);
  const snapshot = snapshotProjection(factId, input);
  const payload = input.payload;
  const baseline: FactContributionProjection = {
    firstContributionId: input.contributionId,
    lastContributionId: input.contributionId,
    subjectId: payload.input.subjectId,
    predicate: payload.input.predicate,
    objectText: payload.input.objectText,
    objectEntityId: payload.input.objectEntityId,
    attributes: cloneAttributes(payload.input.attributes),
    confidence: payload.input.confidence,
    sourceMessageId: payload.input.sourceMessageId,
    sourceRunId: payload.input.sourceRunId,
    personaId: payload.applicability.personaId,
    factClass: payload.applicability.factClass,
    sourceAuthority: payload.applicability.sourceAuthority,
    scope: payload.input.scope,
    originConversationId: payload.input.originConversationId,
    originThreadId: payload.input.originThreadId,
    originTaskId: payload.input.originTaskId,
    sourceTurnId: payload.input.sourceTurnId,
    sourceSummary: payload.input.sourceSummary,
    importance: payload.input.importance,
    repeatedMentionCount: 0,
    lastReinforcedAt: null,
    decayPolicy: payload.input.decayPolicy,
    expiresAt: payload.input.expiresAt,
    validAt: payload.input.validAt,
    createdAt: contributedAt,
    updatedAt: contributedAt,
    pinned: snapshot.pinned,
    sourceActorId: payload.input.sourceActorId,
    retrievability: payload.input.retrievability,
    stability: payload.input.stability,
    decayRate: payload.input.decayRate,
    reviewState: snapshot.reviewState,
    sensitivity: 'normal',
    sensitivityPolicyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    memoryKind: payload.input.memoryKind,
  };
  const classified = classifyProjectionSensitivity(baseline, context);
  return {
    ...baseline,
    sensitivity: snapshot.sensitivityFloor
      ? maxMemoryFactSensitivity(classified, snapshot.sensitivityFloor)
      : classified,
  };
}

/**
 * Merge one canonically later contribution into a derived projection. Product writes must first
 * verify the complete aggregate and canonicalize all inputs; append-only arrival order is unsafe.
 */
export function mergeFactContributionProjection(
  existing: FactContributionProjection,
  factId: string,
  incoming: VerifiedFactContributionProjectionInput,
  context: FactContributionClassifierContext,
): FactContributionProjection {
  const next = baselineFactContributionProjection(factId, incoming, context);
  if (
    compareFactContributionProjectionOrder(
      { contributedAt: existing.updatedAt, contributionId: existing.lastContributionId },
      incoming,
    ) >= 0
  ) {
    fail('memory_fact_contribution_projection_order_invalid');
  }
  if (
    !hasExactFactContentIdentity(
      {
        memoryKind: existing.memoryKind,
        scope: existing.scope,
        originConversationId: existing.originConversationId,
        originThreadId: existing.originThreadId,
        originTaskId: existing.originTaskId,
        personaId: existing.personaId,
        subjectId: existing.subjectId,
        predicate: existing.predicate,
        objectText: existing.objectText,
        objectEntityId: existing.objectEntityId,
      },
      {
        memoryKind: next.memoryKind,
        scope: next.scope,
        originConversationId: next.originConversationId,
        originThreadId: next.originThreadId,
        originTaskId: next.originTaskId,
        personaId: next.personaId,
        subjectId: next.subjectId,
        predicate: next.predicate,
        objectText: next.objectText,
        objectEntityId: next.objectEntityId,
      },
    )
  ) {
    fail('memory_fact_contribution_projection_identity_mismatch');
  }
  const attributes = { ...cloneAttributes(existing.attributes), ...next.attributes };
  const incomingSensitivity = classifyProjectionSensitivity(
    {
      predicate: existing.predicate,
      objectText: existing.objectText,
      attributes,
      sourceSummary: [existing.sourceSummary, next.sourceSummary]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n'),
      memoryKind: next.memoryKind,
    },
    context,
  );
  const provenance = mergeDuplicateProvenance({
    existingFactClass: existing.factClass,
    existingSourceAuthority: existing.sourceAuthority,
    incoming: {
      factClass: next.factClass,
      sourceAuthority: next.sourceAuthority,
      personaId: next.personaId,
    },
    incomingIsSealed: true,
  });
  return {
    ...existing,
    lastContributionId: next.lastContributionId,
    attributes,
    confidence: Math.max(existing.confidence, next.confidence),
    factClass: provenance.factClass,
    sourceAuthority: provenance.sourceAuthority,
    importance: Math.max(existing.importance, next.importance),
    repeatedMentionCount: existing.repeatedMentionCount + 1,
    lastReinforcedAt: next.updatedAt,
    retrievability: Math.max(existing.retrievability, next.retrievability),
    stability: Math.max(existing.stability, next.stability),
    decayRate: Math.min(existing.decayRate, next.decayRate),
    reviewState: mergeDuplicateReviewState(existing.reviewState, next.reviewState),
    sensitivity: mergeDuplicateSensitivity(
      existing.sensitivity,
      maxMemoryFactSensitivity(incomingSensitivity, next.sensitivity),
    ),
    sensitivityPolicyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    memoryKind: next.memoryKind,
    updatedAt: next.updatedAt,
  };
}

function overlayExplicitProjection(
  projection: FactContributionProjection,
  explicit: FactContributionExplicitProjection | null,
): FactContributionProjection {
  if (!explicit) return projection;
  if (
    (explicit.pinnedOverride !== null && typeof explicit.pinnedOverride !== 'boolean') ||
    (explicit.reviewStateOverride !== null &&
      !closedMemoryFactReviewState(explicit.reviewStateOverride)) ||
    (explicit.sensitivityFloor !== null &&
      !closedMemoryFactSensitivity(explicit.sensitivityFloor)) ||
    (explicit.explicitInvalidatedAt !== null &&
      (!Number.isSafeInteger(explicit.explicitInvalidatedAt) ||
        explicit.explicitInvalidatedAt < 0))
  ) {
    fail('memory_fact_contribution_projection_explicit_invalid');
  }
  if (explicit.explicitInvalidatedAt !== null) {
    fail('memory_fact_contribution_projection_explicitly_invalidated');
  }
  return {
    ...projection,
    pinned: explicit.pinnedOverride ?? projection.pinned,
    reviewState: explicit.reviewStateOverride ?? projection.reviewState,
    sensitivity: explicit.sensitivityFloor
      ? maxMemoryFactSensitivity(projection.sensitivity, explicit.sensitivityFloor)
      : projection.sensitivity,
  };
}

/** Reduce surviving contributions without mutating caller order or payload-owned objects. */
export function projectFactFromSurvivingContributions(input: {
  factId: string;
  contributions: ReadonlyArray<Readonly<VerifiedFactContributionProjectionInput>>;
  classifierContext: FactContributionClassifierContext;
  explicitProjection?: FactContributionExplicitProjection | null;
}): FactContributionProjection {
  const factId = requireFactId(input.factId);
  if (input.contributions.length === 0) {
    fail('memory_fact_contribution_projection_empty');
  }
  const ordered = [...input.contributions].sort(compareFactContributionProjectionOrder);
  const seen = new Set<string>();
  for (const contribution of ordered) {
    const contributionId = requireContributionId(contribution.contributionId);
    if (seen.has(contributionId)) {
      fail('memory_fact_contribution_projection_duplicate');
    }
    seen.add(contributionId);
  }
  let projection = baselineFactContributionProjection(
    factId,
    ordered[0]!,
    input.classifierContext,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    projection = mergeFactContributionProjection(
      projection,
      factId,
      ordered[index]!,
      input.classifierContext,
    );
  }
  return overlayExplicitProjection(projection, input.explicitProjection ?? null);
}
