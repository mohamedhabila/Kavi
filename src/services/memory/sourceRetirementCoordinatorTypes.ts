import type { PersistedExactMemorySourceIdentity } from './exactMemorySourceIdentity';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS } from './sourceRetirementChildCommitments';
import {
  MEMORY_SOURCE_RETIREMENT_REASONS,
  requireCanonicalRetirementSources,
  type MemorySourceRetirementReason,
} from './sourceRetirementOperationCodec';

const INPUT_KEYS = ['reason', 'requestedSources', 'retiredAt', 'retirementGroupId'] as const;

export interface ExactSourceRetirementInput {
  reason: MemorySourceRetirementReason;
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  retiredAt: number;
  retirementGroupId?: string;
}

export interface ValidatedExactSourceRetirementInput {
  reason: MemorySourceRetirementReason;
  requestedSources: ReadonlyArray<Readonly<PersistedExactMemorySourceIdentity>>;
  retiredAt: number;
  retirementGroupId: string | null;
}

export type ExactSourceRetirementResult =
  | Readonly<{
      status: 'already_retired';
      requestedSourceCount: number;
      closedSourceCount: 0;
      retiredContributionCount: 0;
      tombstonedFactCount: 0;
      reactivatedFactCount: 0;
      rematerializedFactCount: 0;
    }>
  | Readonly<{
      status: 'retired';
      retirementGroupId: string;
      requestedSourceCount: number;
      closedSourceCount: number;
      retiredContributionCount: number;
      tombstonedFactCount: number;
      reactivatedFactCount: number;
      rematerializedFactCount: number;
    }>;

function fail(code: string): never {
  throw new Error(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasAllowedKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length >= 3 &&
    keys.length <= INPUT_KEYS.length &&
    keys.every((key) => INPUT_KEYS.some((expected) => expected === key)) &&
    Object.hasOwn(value, 'reason') &&
    Object.hasOwn(value, 'requestedSources') &&
    Object.hasOwn(value, 'retiredAt')
  );
}

function requireReason(value: unknown): MemorySourceRetirementReason {
  const reason = MEMORY_SOURCE_RETIREMENT_REASONS.find((candidate) => candidate === value);
  return reason ?? fail('memory_source_retirement_reason_invalid');
}

export function validateExactSourceRetirementInput(
  input: unknown,
  localOwnerId: string,
): Readonly<ValidatedExactSourceRetirementInput> {
  if (!isPlainRecord(input) || !hasAllowedKeys(input)) {
    fail('memory_source_retirement_input_invalid');
  }
  if (!Number.isSafeInteger(input.retiredAt) || (input.retiredAt as number) < 0) {
    fail('memory_source_retirement_timestamp_invalid');
  }
  if (
    Object.hasOwn(input, 'retirementGroupId') &&
    !isExactMemoryProvenanceId(input.retirementGroupId)
  ) {
    fail('memory_source_retirement_group_id_invalid');
  }
  return Object.freeze({
    reason: requireReason(input.reason),
    requestedSources: requireCanonicalRetirementSources(input.requestedSources, {
      expectedOwnerId: localOwnerId,
      minimum: 1,
      limit: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources,
      code: 'memory_source_retirement_requested_sources_invalid',
    }),
    retiredAt: input.retiredAt as number,
    retirementGroupId: (input.retirementGroupId as string | undefined) ?? null,
  });
}
