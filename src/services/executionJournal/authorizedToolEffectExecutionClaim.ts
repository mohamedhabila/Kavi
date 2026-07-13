/**
 * Minimal code-owned authority handed to a builtin effect executor only after
 * its durable dispatch claim has been persisted.
 */
export interface AuthorizedToolEffectExecutionClaim {
  readonly executionRunId: string;
  readonly toolCallId: string;
  readonly claimedAt: number;
}
