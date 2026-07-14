import {
  buildSourceRetirementClosedSourcesCommitment,
  buildSourceRetirementContributionIdsCommitment,
  buildSourceRetirementFactIdsCommitment,
  buildSourceRetirementRequestedSourcesCommitment,
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS,
  type MemorySourceRetirementChildCommitment,
} from './sourceRetirementChildCommitments';
import {
  requireExactMemorySourceKind,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export const MEMORY_SOURCE_RETIREMENT_REASONS = [
  'fact_withdrawal',
  'message_edit',
  'message_retry',
  'message_delete',
  'conversation_delete',
  'memory_opt_out',
  'memory_reset',
  'ingestion_conflict',
] as const;

export type MemorySourceRetirementReason =
  (typeof MEMORY_SOURCE_RETIREMENT_REASONS)[number];

export interface SourceRetirementOperationInput {
  retirementGroupId: string;
  memoryOwnerId: string;
  reason: MemorySourceRetirementReason;
  retiredAt: number;
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  closedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  retiredContributionIds: ReadonlyArray<string>;
  retiredFactIds: ReadonlyArray<string>;
}

export interface ValidatedSourceRetirementOperation extends SourceRetirementOperationInput {
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  closedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  retiredContributionIds: ReadonlyArray<string>;
  retiredFactIds: ReadonlyArray<string>;
  requestedSourcesCommitment: Readonly<MemorySourceRetirementChildCommitment>;
  closedSourcesCommitment: Readonly<MemorySourceRetirementChildCommitment>;
  retiredContributionsCommitment: Readonly<MemorySourceRetirementChildCommitment>;
  retiredFactsCommitment: Readonly<MemorySourceRetirementChildCommitment>;
}

const OPERATION_KEYS = [
  'closedSources',
  'memoryOwnerId',
  'reason',
  'requestedSources',
  'retiredAt',
  'retiredContributionIds',
  'retiredFactIds',
  'retirementGroupId',
] as const;
const SOURCE_KEYS = [
  'memoryConversationId',
  'memoryOwnerId',
  'sourceId',
  'sourceKind',
  'sourceThreadId',
  'taskId',
] as const;
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;

function fail(code: string): never {
  throw new Error(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceKey(source: PersistedExactMemorySourceIdentity): string {
  return JSON.stringify([
    source.memoryOwnerId,
    source.memoryConversationId,
    source.sourceThreadId,
    source.taskId,
    source.sourceKind,
    source.sourceId,
  ]);
}

function compareSources(
  left: PersistedExactMemorySourceIdentity,
  right: PersistedExactMemorySourceIdentity,
): number {
  const leftTuple = [
    left.memoryOwnerId,
    left.memoryConversationId,
    left.sourceThreadId,
    left.taskId,
    left.sourceKind,
    left.sourceId,
  ];
  const rightTuple = [
    right.memoryOwnerId,
    right.memoryConversationId,
    right.sourceThreadId,
    right.taskId,
    right.sourceKind,
    right.sourceId,
  ];
  for (let index = 0; index < leftTuple.length; index += 1) {
    const compared = compareOrdinal(leftTuple[index]!, rightTuple[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function requirePersistedSource(
  value: unknown,
  expectedOwnerId: string | null,
  code: string,
): Readonly<PersistedExactMemorySourceIdentity> {
  if (!isPlainRecord(value) || !hasExactKeys(value, SOURCE_KEYS)) fail(code);
  if (
    !isExactMemoryScopeId(value.memoryOwnerId) ||
    (expectedOwnerId !== null && value.memoryOwnerId !== expectedOwnerId) ||
    !isExactMemoryScopeId(value.memoryConversationId) ||
    !isExactMemoryScopeId(value.sourceThreadId) ||
    (value.taskId !== '' && !isExactMemoryScopeId(value.taskId)) ||
    !isExactMemoryProvenanceId(value.sourceId)
  ) {
    fail(code);
  }
  return Object.freeze({
    memoryOwnerId: value.memoryOwnerId,
    memoryConversationId: value.memoryConversationId,
    sourceThreadId: value.sourceThreadId,
    taskId: value.taskId,
    sourceKind: requireExactMemorySourceKind(value.sourceKind, code),
    sourceId: value.sourceId,
  });
}

export function requireCanonicalRetirementSources(
  value: unknown,
  input: Readonly<{
    expectedOwnerId: string | null;
    minimum: number;
    limit: number;
    code: string;
  }>,
): ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>> {
  if (!Array.isArray(value) || value.length < input.minimum || value.length > input.limit) {
    fail(input.code);
  }
  const seen = new Set<string>();
  const sources = value.map((candidate) => {
    const source = requirePersistedSource(candidate, input.expectedOwnerId, input.code);
    const key = sourceKey(source);
    if (seen.has(key)) fail(input.code);
    seen.add(key);
    return source;
  });
  return Object.freeze(sources.sort(compareSources));
}

export function requireCanonicalRetirementContributionIds(
  value: unknown,
  code: string,
  limit: number = MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions,
): ReadonlyArray<string> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions
  ) {
    fail(code);
  }
  if (!Array.isArray(value) || value.length > limit) {
    fail(code);
  }
  const seen = new Set<string>();
  const ids = value.map((candidate) => {
    if (typeof candidate !== 'string' || !CONTRIBUTION_ID_PATTERN.test(candidate)) fail(code);
    if (seen.has(candidate)) fail(code);
    seen.add(candidate);
    return candidate;
  });
  return Object.freeze(ids.sort(compareOrdinal));
}

function requireCanonicalRetirementFactIds(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredFacts) {
    fail('memory_source_retirement_fact_ids_invalid');
  }
  const seen = new Set<string>();
  const ids = value.map((candidate) => {
    if (!isExactMemoryProvenanceId(candidate) || seen.has(candidate)) {
      fail('memory_source_retirement_fact_ids_invalid');
    }
    seen.add(candidate);
    return candidate;
  });
  return Object.freeze(ids.sort(compareOrdinal));
}

function isRetirementReason(value: unknown): value is MemorySourceRetirementReason {
  return MEMORY_SOURCE_RETIREMENT_REASONS.some((reason) => reason === value);
}

export function validateSourceRetirementOperation(
  input: unknown,
): Readonly<ValidatedSourceRetirementOperation> {
  if (!isPlainRecord(input) || !hasExactKeys(input, OPERATION_KEYS)) {
    fail('memory_source_retirement_operation_invalid');
  }
  if (!isExactMemoryProvenanceId(input.retirementGroupId)) {
    fail('memory_source_retirement_group_id_invalid');
  }
  if (!isExactMemoryScopeId(input.memoryOwnerId)) {
    fail('memory_source_retirement_owner_id_invalid');
  }
  if (!isRetirementReason(input.reason)) fail('memory_source_retirement_reason_invalid');
  if (!Number.isSafeInteger(input.retiredAt) || (input.retiredAt as number) < 0) {
    fail('memory_source_retirement_timestamp_invalid');
  }

  const requestedSources = requireCanonicalRetirementSources(input.requestedSources, {
    expectedOwnerId: input.memoryOwnerId,
    minimum: 1,
    limit: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
    code: 'memory_source_retirement_requested_sources_invalid',
  });
  const closedSources = requireCanonicalRetirementSources(input.closedSources, {
    expectedOwnerId: input.memoryOwnerId,
    minimum: 1,
    limit: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources,
    code: 'memory_source_retirement_closed_sources_invalid',
  });
  const closedKeys = new Set(closedSources.map(sourceKey));
  if (requestedSources.some((source) => !closedKeys.has(sourceKey(source)))) {
    fail('memory_source_retirement_requested_sources_not_closed');
  }
  const retiredContributionIds = requireCanonicalRetirementContributionIds(
    input.retiredContributionIds,
    'memory_source_retirement_contribution_ids_invalid',
  );
  const retiredFactIds = requireCanonicalRetirementFactIds(input.retiredFactIds);
  const retirementGroupId = input.retirementGroupId;
  const retiredAt = input.retiredAt as number;

  return Object.freeze({
    retirementGroupId,
    memoryOwnerId: input.memoryOwnerId,
    reason: input.reason,
    retiredAt,
    requestedSources,
    closedSources,
    retiredContributionIds,
    retiredFactIds,
    requestedSourcesCommitment: buildSourceRetirementRequestedSourcesCommitment({
      retirementGroupId,
      sources: requestedSources,
    }),
    closedSourcesCommitment: buildSourceRetirementClosedSourcesCommitment({
      retirementGroupId,
      sources: closedSources,
    }),
    retiredContributionsCommitment: buildSourceRetirementContributionIdsCommitment({
      retirementGroupId,
      contributionIds: retiredContributionIds,
    }),
    retiredFactsCommitment: buildSourceRetirementFactIdsCommitment({
      retirementGroupId,
      factIds: retiredFactIds,
    }),
  });
}
