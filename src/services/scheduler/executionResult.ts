import type { PendingVerifiedProcedureObservation } from '../memory/verifiedProcedure/executionSession';
import type { VerifiedProcedureMemoryLineage } from '../memory/verifiedProcedure/provenanceHash';

export type PendingScheduledVerifiedProcedureCommit = Readonly<{
  memoryLineage: VerifiedProcedureMemoryLineage;
  observation: PendingVerifiedProcedureObservation;
}>;

export interface SchedulerExecutionResult {
  output: string;
  conversationId?: string;
  conversationDurable?: boolean;
  warnings?: string[];
  /** Transient evidence; never persisted into retry or completion state. */
  pendingVerifiedProcedureCommit?: PendingScheduledVerifiedProcedureCommit;
}
