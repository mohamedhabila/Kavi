import type { MemoryFactContributionOperationV1 } from './factContributionCodec';

export interface FactContributionSupersessionAuthorization {
  operation: MemoryFactContributionOperationV1;
  supersedePrior: boolean;
  contributedFactId: string;
  predecessorFactIds: ReadonlyArray<string>;
}

/** Decide whether the sealed contribution operation authorizes its supersession children. */
export function isFactContributionSupersessionAuthorized(
  input: FactContributionSupersessionAuthorization,
): boolean {
  if (input.operation.kind === 'record') {
    return input.supersedePrior || input.predecessorFactIds.length === 0;
  }
  if (input.supersedePrior) return false;
  if (input.predecessorFactIds.length === 0) {
    return input.contributedFactId === input.operation.expectedCurrentFactId;
  }
  return (
    input.predecessorFactIds.length === 1 &&
    input.predecessorFactIds[0] === input.operation.expectedCurrentFactId
  );
}
