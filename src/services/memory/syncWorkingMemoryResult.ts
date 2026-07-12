export type SyncWorkingMemorySkipReason = 'opt_out' | 'no_closed_turn' | 'source_identity_invalid';

export interface SyncWorkingMemoryResult {
  processed: boolean;
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  sourceEndMessageId: string | null;
  sourceStartMessageId: string | null;
  priorUserMessageId: string | null;
  skipped?: SyncWorkingMemorySkipReason;
}

export function skippedSyncWorkingMemoryResult(
  skipped: SyncWorkingMemorySkipReason,
): SyncWorkingMemoryResult {
  return {
    processed: false,
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    sourceEndMessageId: null,
    sourceStartMessageId: null,
    priorUserMessageId: null,
    skipped,
  };
}
