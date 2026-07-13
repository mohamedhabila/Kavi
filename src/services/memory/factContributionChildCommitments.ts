import { sha256HexUtf8 } from '../../utils/sha256';
import {
  MEMORY_FACT_CONTRIBUTION_LIMITS,
  type MemoryFactContributionSourceAlias,
  type MemoryFactContributionSourceScope,
} from './factContributionCodec';
import {
  closedMemoryFactReviewState,
  closedMemoryFactSensitivity,
  type MemoryFactReviewState,
  type MemoryFactSensitivity,
} from './facts/applicabilityProvenance';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export const MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION = 1 as const;
export const MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES = 256 as const;

const SOURCE_CHILDREN_DOMAIN = 'kavi.memory-fact-contribution.source-children.v1';
const SUPERSESSION_CHILDREN_DOMAIN = 'kavi.memory-fact-contribution.supersession-children.v1';
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;
const MAX_POLICY_VERSION = 2_147_483_647;
const SOURCE_SCOPE_KEYS = [
  'memoryConversationId',
  'memoryOwnerId',
  'sourceThreadId',
  'taskId',
] as const;
const SOURCE_ALIAS_KEYS = ['sourceId', 'sourceKind'] as const;
const SOURCE_INPUT_KEYS = ['contributionId', 'scope', 'sourceAliases'] as const;
const SUPERSESSION_INPUT_KEYS = ['contributionId', 'edges', 'snapshot'] as const;
const SNAPSHOT_KEYS = [
  'contribution_id',
  'pinned_input_explicit',
  'review_state_input_explicit',
  'snapshot_version',
  'successor_fact_id',
  'successor_pinned_baseline',
  'successor_review_state_baseline',
  'successor_sensitivity_floor',
  'successor_sensitivity_policy_version',
  'superseded_at',
] as const;
const EDGE_KEYS = [
  'contribution_id',
  'predecessor_fact_id',
  'successor_fact_id',
  'superseded_at',
] as const;

export interface MemoryFactContributionChildCommitment {
  version: typeof MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION;
  count: number;
  sha256: string;
}

/** Exact persisted row projected into the supersession child-set commitment. */
export interface FactContributionSupersessionSnapshotCommitmentRow {
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

/** Exact persisted row projected into the supersession child-set commitment. */
export interface FactContributionSupersessionEdgeCommitmentRow {
  contribution_id: string;
  predecessor_fact_id: string;
  successor_fact_id: string;
  superseded_at: number;
}

type NormalizedSnapshot = Readonly<{
  contributionId: string;
  successorFactId: string;
  supersededAt: number;
  snapshotVersion: 1;
  pinnedInputExplicit: 0 | 1;
  reviewStateInputExplicit: 0 | 1;
  successorPinnedBaseline: 0 | 1;
  successorReviewStateBaseline: MemoryFactReviewState;
  successorSensitivityFloor: MemoryFactSensitivity;
  successorSensitivityPolicyVersion: number;
}>;

type NormalizedEdge = Readonly<{
  contributionId: string;
  predecessorFactId: string;
  successorFactId: string;
  supersededAt: number;
}>;

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

/** ECMAScript string relational order over UTF-16 code units, independent of locale. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireContributionId(value: unknown): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value)) {
    fail('memory_fact_contribution_child_commitment_contribution_id_invalid');
  }
  return value;
}

function requireFactId(value: unknown, code: string): string {
  if (!isExactMemoryProvenanceId(value)) fail(code);
  return value;
}

function requireSafeTimestamp(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function requireStoredBoolean(value: unknown, code: string): 0 | 1 {
  if (value !== 0 && value !== 1) fail(code);
  return value;
}

function requireSourceKind(value: unknown): MemoryFactContributionSourceAlias['sourceKind'] {
  if (value !== 'message' && value !== 'turn' && value !== 'run') {
    fail('memory_fact_contribution_child_commitment_source_aliases_invalid');
  }
  return value;
}

function requireSourceScope(value: unknown): MemoryFactContributionSourceScope {
  if (!isPlainRecord(value) || !hasExactKeys(value, SOURCE_SCOPE_KEYS)) {
    fail('memory_fact_contribution_child_commitment_source_scope_invalid');
  }
  if (
    !isExactMemoryScopeId(value.memoryOwnerId) ||
    !isExactMemoryScopeId(value.memoryConversationId) ||
    !isExactMemoryScopeId(value.sourceThreadId) ||
    (value.taskId !== '' && !isExactMemoryScopeId(value.taskId))
  ) {
    fail('memory_fact_contribution_child_commitment_source_scope_invalid');
  }
  return {
    memoryOwnerId: value.memoryOwnerId,
    memoryConversationId: value.memoryConversationId,
    sourceThreadId: value.sourceThreadId,
    taskId: value.taskId,
  };
}

function requireSourceAliases(value: unknown): MemoryFactContributionSourceAlias[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases
  ) {
    fail('memory_fact_contribution_child_commitment_source_aliases_invalid');
  }
  const seen = new Set<string>();
  const aliases = value.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, SOURCE_ALIAS_KEYS) ||
      !isExactMemoryProvenanceId(candidate.sourceId)
    ) {
      fail('memory_fact_contribution_child_commitment_source_aliases_invalid');
    }
    const sourceKind = requireSourceKind(candidate.sourceKind);
    const key = `${sourceKind}\u0000${candidate.sourceId}`;
    if (seen.has(key)) {
      fail('memory_fact_contribution_child_commitment_source_aliases_invalid');
    }
    seen.add(key);
    return { sourceKind, sourceId: candidate.sourceId };
  });
  return aliases.sort(
    (left, right) =>
      compareOrdinal(left.sourceKind, right.sourceKind) ||
      compareOrdinal(left.sourceId, right.sourceId),
  );
}

function requireSnapshot(value: unknown, contributionId: string): NormalizedSnapshot | null {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) {
    fail('memory_fact_contribution_child_commitment_supersession_snapshot_invalid');
  }
  if (value.contribution_id !== contributionId) {
    fail('memory_fact_contribution_child_commitment_supersession_snapshot_invalid');
  }
  const reviewState = closedMemoryFactReviewState(value.successor_review_state_baseline);
  const sensitivity = closedMemoryFactSensitivity(value.successor_sensitivity_floor);
  if (
    value.snapshot_version !== 1 ||
    !reviewState ||
    !sensitivity ||
    !Number.isSafeInteger(value.successor_sensitivity_policy_version) ||
    (value.successor_sensitivity_policy_version as number) < 1 ||
    (value.successor_sensitivity_policy_version as number) > MAX_POLICY_VERSION
  ) {
    fail('memory_fact_contribution_child_commitment_supersession_snapshot_invalid');
  }
  return {
    contributionId,
    successorFactId: requireFactId(
      value.successor_fact_id,
      'memory_fact_contribution_child_commitment_supersession_snapshot_invalid',
    ),
    supersededAt: requireSafeTimestamp(
      value.superseded_at,
      'memory_fact_contribution_child_commitment_supersession_snapshot_invalid',
    ),
    snapshotVersion: 1,
    pinnedInputExplicit: requireStoredBoolean(
      value.pinned_input_explicit,
      'memory_fact_contribution_child_commitment_supersession_snapshot_invalid',
    ),
    reviewStateInputExplicit: requireStoredBoolean(
      value.review_state_input_explicit,
      'memory_fact_contribution_child_commitment_supersession_snapshot_invalid',
    ),
    successorPinnedBaseline: requireStoredBoolean(
      value.successor_pinned_baseline,
      'memory_fact_contribution_child_commitment_supersession_snapshot_invalid',
    ),
    successorReviewStateBaseline: reviewState,
    successorSensitivityFloor: sensitivity,
    successorSensitivityPolicyVersion: value.successor_sensitivity_policy_version as number,
  };
}

function requireEdges(
  value: unknown,
  contributionId: string,
  snapshot: NormalizedSnapshot | null,
): NormalizedEdge[] {
  if (!Array.isArray(value)) {
    fail('memory_fact_contribution_child_commitment_supersession_edges_invalid');
  }
  if (value.length > MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES) {
    fail('memory_fact_contribution_child_commitment_supersession_edges_invalid');
  }
  if ((snapshot === null) !== (value.length === 0)) {
    fail('memory_fact_contribution_child_commitment_supersession_shape_invalid');
  }
  const predecessorIds = new Set<string>();
  const edges = value.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, EDGE_KEYS) ||
      candidate.contribution_id !== contributionId
    ) {
      fail('memory_fact_contribution_child_commitment_supersession_edges_invalid');
    }
    const predecessorFactId = requireFactId(
      candidate.predecessor_fact_id,
      'memory_fact_contribution_child_commitment_supersession_edges_invalid',
    );
    const successorFactId = requireFactId(
      candidate.successor_fact_id,
      'memory_fact_contribution_child_commitment_supersession_edges_invalid',
    );
    const supersededAt = requireSafeTimestamp(
      candidate.superseded_at,
      'memory_fact_contribution_child_commitment_supersession_edges_invalid',
    );
    if (
      predecessorFactId === successorFactId ||
      predecessorIds.has(predecessorFactId) ||
      !snapshot ||
      successorFactId !== snapshot.successorFactId ||
      supersededAt !== snapshot.supersededAt
    ) {
      fail('memory_fact_contribution_child_commitment_supersession_edges_invalid');
    }
    predecessorIds.add(predecessorFactId);
    return { contributionId, predecessorFactId, successorFactId, supersededAt };
  });
  return edges.sort(
    (left, right) =>
      compareOrdinal(left.predecessorFactId, right.predecessorFactId) ||
      compareOrdinal(left.successorFactId, right.successorFactId) ||
      left.supersededAt - right.supersededAt,
  );
}

function commitment(
  count: number,
  canonicalProjection: unknown,
): MemoryFactContributionChildCommitment {
  return Object.freeze({
    version: MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION,
    count,
    sha256: sha256HexUtf8(JSON.stringify(canonicalProjection)),
  });
}

/** Commit the exact normalized source scope and complete canonical alias set. */
export function buildFactContributionSourceChildCommitment(input: {
  contributionId: string;
  scope: MemoryFactContributionSourceScope;
  sourceAliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
}): MemoryFactContributionChildCommitment {
  if (!isPlainRecord(input) || !hasExactKeys(input, SOURCE_INPUT_KEYS)) {
    fail('memory_fact_contribution_child_commitment_source_input_invalid');
  }
  const contributionId = requireContributionId(input.contributionId);
  const scope = requireSourceScope(input.scope);
  const aliases = requireSourceAliases(input.sourceAliases);
  const projection = [
    SOURCE_CHILDREN_DOMAIN,
    MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION,
    contributionId,
    [scope.memoryOwnerId, scope.memoryConversationId, scope.sourceThreadId, scope.taskId],
    aliases.map((alias) => [alias.sourceKind, alias.sourceId]),
  ];
  return commitment(aliases.length, projection);
}

/** Commit either the canonical empty set or one exact snapshot and all exact edges. */
export function buildFactContributionSupersessionChildCommitment(input: {
  contributionId: string;
  snapshot: FactContributionSupersessionSnapshotCommitmentRow | null;
  edges: ReadonlyArray<FactContributionSupersessionEdgeCommitmentRow>;
}): MemoryFactContributionChildCommitment {
  if (!isPlainRecord(input) || !hasExactKeys(input, SUPERSESSION_INPUT_KEYS)) {
    fail('memory_fact_contribution_child_commitment_supersession_input_invalid');
  }
  const contributionId = requireContributionId(input.contributionId);
  const snapshot = requireSnapshot(input.snapshot, contributionId);
  const edges = requireEdges(input.edges, contributionId, snapshot);
  const children = snapshot
    ? ([
        [
          snapshot.contributionId,
          snapshot.successorFactId,
          snapshot.supersededAt,
          snapshot.snapshotVersion,
          snapshot.pinnedInputExplicit,
          snapshot.reviewStateInputExplicit,
          snapshot.successorPinnedBaseline,
          snapshot.successorReviewStateBaseline,
          snapshot.successorSensitivityFloor,
          snapshot.successorSensitivityPolicyVersion,
        ],
        ...edges.map((edge) => [
          edge.contributionId,
          edge.predecessorFactId,
          edge.successorFactId,
          edge.supersededAt,
        ]),
      ] as const)
    : [];
  return commitment(snapshot ? edges.length + 1 : 0, [
    SUPERSESSION_CHILDREN_DOMAIN,
    MEMORY_FACT_CONTRIBUTION_CHILD_COMMITMENT_VERSION,
    contributionId,
    children,
  ]);
}
