export type MemoryTurnPublicationValidationSkipReason =
  | 'opt_out'
  | 'no_closed_turn'
  | 'source_identity_invalid';

export interface MemoryTurnPublicationValidation {
  processed: boolean;
  sourceEndMessageId: string | null;
  sourceStartMessageId: string | null;
  priorUserMessageId: string | null;
  skipped?: MemoryTurnPublicationValidationSkipReason;
}

export function skippedMemoryTurnPublicationValidation(
  skipped: MemoryTurnPublicationValidationSkipReason,
): MemoryTurnPublicationValidation {
  return {
    processed: false,
    sourceEndMessageId: null,
    sourceStartMessageId: null,
    priorUserMessageId: null,
    skipped,
  };
}
