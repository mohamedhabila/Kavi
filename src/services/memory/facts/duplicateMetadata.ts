import type {
  MemoryFactClass,
  MemoryFactReviewState,
  MemoryFactSensitivity,
  MemorySourceAuthority,
  ResolvedFactApplicabilityProvenance,
} from './applicabilityProvenance';

const REVIEW_PROTECTION = new Map<MemoryFactReviewState, number>([
  ['verified', 0],
  ['pending_review', 1],
  ['stale', 2],
  ['conflicted', 3],
  ['rejected', 4],
]);

const SENSITIVITY_PROTECTION = new Map<MemoryFactSensitivity, number>([
  ['normal', 0],
  ['personal', 1],
  ['sensitive', 2],
  ['restricted', 3],
]);

const AUTHORITY_TIER = new Map<MemorySourceAuthority, number>([
  ['unknown', 0],
  ['assistant_inferred', 1],
  ['grounded_user', 2],
  ['tool_observed', 2],
  ['external_source', 2],
]);

/** Duplicate ingestion may add caution, but cannot erase an explicit review decision. */
export function mergeDuplicateReviewState(
  existing: MemoryFactReviewState,
  incoming: MemoryFactReviewState,
): MemoryFactReviewState {
  if (incoming === 'auto') return existing;
  if (existing === 'auto') return incoming;
  return (REVIEW_PROTECTION.get(incoming) ?? Number.POSITIVE_INFINITY) >
    (REVIEW_PROTECTION.get(existing) ?? Number.POSITIVE_INFINITY)
    ? incoming
    : existing;
}

/** Sensitivity is monotonic at duplicate-ingestion boundaries. */
export function mergeDuplicateSensitivity(
  existing: MemoryFactSensitivity,
  incoming: MemoryFactSensitivity,
): MemoryFactSensitivity {
  return (SENSITIVITY_PROTECTION.get(incoming) ?? Number.POSITIVE_INFINITY) >
    (SENSITIVITY_PROTECTION.get(existing) ?? Number.POSITIVE_INFINITY)
    ? incoming
    : existing;
}

export interface DuplicateProvenanceInput {
  existingFactClass: MemoryFactClass;
  existingSourceAuthority: MemorySourceAuthority;
  incoming: ResolvedFactApplicabilityProvenance;
  incomingIsSealed: boolean;
}

/**
 * Only product-code-sealed provenance may upgrade a duplicate. Grounded
 * authority kinds are peers: one cannot silently relabel another.
 */
export function mergeDuplicateProvenance(
  input: DuplicateProvenanceInput,
): Pick<ResolvedFactApplicabilityProvenance, 'factClass' | 'sourceAuthority'> {
  const existing = {
    factClass: input.existingFactClass,
    sourceAuthority: input.existingSourceAuthority,
  };
  if (!input.incomingIsSealed) return existing;

  const existingTier = AUTHORITY_TIER.get(input.existingSourceAuthority) ?? 0;
  const incomingTier = AUTHORITY_TIER.get(input.incoming.sourceAuthority) ?? 0;
  if (incomingTier > existingTier) {
    return {
      factClass: input.incoming.factClass,
      sourceAuthority: input.incoming.sourceAuthority,
    };
  }
  if (
    incomingTier === existingTier &&
    input.incoming.sourceAuthority === input.existingSourceAuthority &&
    input.existingFactClass === 'unknown' &&
    input.incoming.factClass !== 'unknown'
  ) {
    return {
      factClass: input.incoming.factClass,
      sourceAuthority: input.incoming.sourceAuthority,
    };
  }
  return existing;
}
