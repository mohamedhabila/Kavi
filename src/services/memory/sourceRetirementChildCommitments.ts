import { sha256HexUtf8 } from '../../utils/sha256';
import {
  requireExactMemorySourceKind,
  type PersistedExactMemorySourceIdentity,
} from './exactMemorySourceIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export const MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION = 1 as const;
export const MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS = Object.freeze({
  requestedSources: 256,
  retiredSources: 4_096,
  retiredContributions: 4_096,
  retiredFacts: 4_096,
});

const REQUESTED_SOURCES_DOMAIN = 'kavi.memory-source-retirement.requested-sources.v1';
const RETIRED_SOURCES_DOMAIN = 'kavi.memory-source-retirement.retired-sources.v1';
const RETIRED_CONTRIBUTIONS_DOMAIN = 'kavi.memory-source-retirement.retired-contributions.v1';
const RETIRED_FACTS_DOMAIN = 'kavi.memory-source-retirement.retired-facts.v1';
const CONTRIBUTION_ID_PATTERN = /^mfc_[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SOURCE_KEYS = [
  'memoryConversationId',
  'memoryOwnerId',
  'sourceId',
  'sourceKind',
  'sourceThreadId',
  'taskId',
] as const;
const SOURCE_INPUT_KEYS = ['retirementGroupId', 'sources'] as const;
const CONTRIBUTION_INPUT_KEYS = ['contributionIds', 'retirementGroupId'] as const;
const FACT_INPUT_KEYS = ['factIds', 'retirementGroupId'] as const;
const COMMITMENT_KEYS = ['count', 'sha256', 'version'] as const;

type CanonicalSourceTuple = readonly [string, string, string, string, string, string];

export interface MemorySourceRetirementChildCommitment {
  version: typeof MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION;
  count: number;
  sha256: string;
}

interface SourceCommitmentInput {
  retirementGroupId: string;
  sources: ReadonlyArray<PersistedExactMemorySourceIdentity>;
}

interface ContributionCommitmentInput {
  retirementGroupId: string;
  contributionIds: ReadonlyArray<string>;
}

interface FactCommitmentInput {
  retirementGroupId: string;
  factIds: ReadonlyArray<string>;
}

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

/** ECMAScript relational order over UTF-16 code units, independent of locale. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSourceTuple(left: CanonicalSourceTuple, right: CanonicalSourceTuple): number {
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareOrdinal(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function requireRetirementGroupId(value: unknown): string {
  if (!isExactMemoryProvenanceId(value)) {
    fail('memory_source_retirement_child_commitment_group_id_invalid');
  }
  return value;
}

function requireSourceTuple(value: unknown, code: string): CanonicalSourceTuple {
  if (!isPlainRecord(value) || !hasExactKeys(value, SOURCE_KEYS)) fail(code);
  if (
    !isExactMemoryScopeId(value.memoryOwnerId) ||
    !isExactMemoryScopeId(value.memoryConversationId) ||
    !isExactMemoryScopeId(value.sourceThreadId) ||
    (value.taskId !== '' && !isExactMemoryScopeId(value.taskId)) ||
    !isExactMemoryProvenanceId(value.sourceId)
  ) {
    fail(code);
  }
  return [
    value.memoryOwnerId,
    value.memoryConversationId,
    value.sourceThreadId,
    value.taskId,
    requireExactMemorySourceKind(value.sourceKind, code),
    value.sourceId,
  ];
}

function requireSources(value: unknown, limit: number, code: string): CanonicalSourceTuple[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) fail(code);
  const seen = new Set<string>();
  const sources = value.map((candidate) => {
    const tuple = requireSourceTuple(candidate, code);
    const key = JSON.stringify(tuple);
    if (seen.has(key)) fail(code);
    seen.add(key);
    return tuple;
  });
  return sources.sort(compareSourceTuple);
}

function requireOpaqueIds(
  value: unknown,
  limit: number,
  predicate: (candidate: unknown) => candidate is string,
  code: string,
): string[] {
  if (!Array.isArray(value) || value.length > limit) fail(code);
  const seen = new Set<string>();
  const ids = value.map((candidate) => {
    if (!predicate(candidate) || seen.has(candidate)) fail(code);
    seen.add(candidate);
    return candidate;
  });
  return ids.sort(compareOrdinal);
}

function isExactContributionId(value: unknown): value is string {
  return typeof value === 'string' && CONTRIBUTION_ID_PATTERN.test(value);
}

function buildCommitment(
  domain: string,
  retirementGroupId: string,
  rows: readonly unknown[],
): MemorySourceRetirementChildCommitment {
  return Object.freeze({
    version: MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION,
    count: rows.length,
    sha256: sha256HexUtf8(
      JSON.stringify([
        domain,
        MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION,
        retirementGroupId,
        rows,
      ]),
    ),
  });
}

function requireSourceInput(input: unknown, code: string): Record<string, unknown> {
  if (!isPlainRecord(input) || !hasExactKeys(input, SOURCE_INPUT_KEYS)) fail(code);
  return input;
}

/** Commit the exact requested source tuples before fixed-point closure. */
export function buildSourceRetirementRequestedSourcesCommitment(
  input: SourceCommitmentInput,
): MemorySourceRetirementChildCommitment {
  const exact = requireSourceInput(
    input,
    'memory_source_retirement_requested_sources_commitment_input_invalid',
  );
  const groupId = requireRetirementGroupId(exact.retirementGroupId);
  const rows = requireSources(
    exact.sources,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
    'memory_source_retirement_requested_sources_invalid',
  );
  return buildCommitment(REQUESTED_SOURCES_DOMAIN, groupId, rows);
}

/** Commit the complete closed set of exact retired source tuples. */
export function buildSourceRetirementClosedSourcesCommitment(
  input: SourceCommitmentInput,
): MemorySourceRetirementChildCommitment {
  const exact = requireSourceInput(
    input,
    'memory_source_retirement_closed_sources_commitment_input_invalid',
  );
  const groupId = requireRetirementGroupId(exact.retirementGroupId);
  const rows = requireSources(
    exact.sources,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources,
    'memory_source_retirement_closed_sources_invalid',
  );
  return buildCommitment(RETIRED_SOURCES_DOMAIN, groupId, rows);
}

/** Commit only opaque contribution IDs; fact content and producer payload never enter the digest. */
export function buildSourceRetirementContributionIdsCommitment(
  input: ContributionCommitmentInput,
): MemorySourceRetirementChildCommitment {
  if (!isPlainRecord(input) || !hasExactKeys(input, CONTRIBUTION_INPUT_KEYS)) {
    fail('memory_source_retirement_contribution_ids_commitment_input_invalid');
  }
  const groupId = requireRetirementGroupId(input.retirementGroupId);
  const rows = requireOpaqueIds(
    input.contributionIds,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions,
    isExactContributionId,
    'memory_source_retirement_contribution_ids_invalid',
  );
  return buildCommitment(RETIRED_CONTRIBUTIONS_DOMAIN, groupId, rows);
}

/** Commit only opaque fact provenance IDs; fact content never enters the digest. */
export function buildSourceRetirementFactIdsCommitment(
  input: FactCommitmentInput,
): MemorySourceRetirementChildCommitment {
  if (!isPlainRecord(input) || !hasExactKeys(input, FACT_INPUT_KEYS)) {
    fail('memory_source_retirement_fact_ids_commitment_input_invalid');
  }
  const groupId = requireRetirementGroupId(input.retirementGroupId);
  const rows = requireOpaqueIds(
    input.factIds,
    MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredFacts,
    isExactMemoryProvenanceId,
    'memory_source_retirement_fact_ids_invalid',
  );
  return buildCommitment(RETIRED_FACTS_DOMAIN, groupId, rows);
}

/** Verify sealed metadata against a commitment rebuilt from the exact persisted child rows. */
export function assertSourceRetirementChildCommitment(
  actual: unknown,
  expected: MemorySourceRetirementChildCommitment,
): void {
  if (!isPlainRecord(actual) || !hasExactKeys(actual, COMMITMENT_KEYS)) {
    fail('memory_source_retirement_child_commitment_metadata_invalid');
  }
  if (
    actual.version !== MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION ||
    !Number.isSafeInteger(actual.count) ||
    (actual.count as number) < 0 ||
    (actual.count as number) > MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources ||
    typeof actual.sha256 !== 'string' ||
    !SHA256_PATTERN.test(actual.sha256)
  ) {
    fail('memory_source_retirement_child_commitment_metadata_invalid');
  }
  if (
    actual.version !== expected.version ||
    actual.count !== expected.count ||
    actual.sha256 !== expected.sha256
  ) {
    fail('memory_source_retirement_child_commitment_mismatch');
  }
}
