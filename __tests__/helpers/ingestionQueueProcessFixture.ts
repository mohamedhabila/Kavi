import type {
  ProcessTurnInput,
  ProcessTurnResult,
  TurnPersistenceReceipt,
} from '../../src/services/memory/turnProcessor';

export function receiptFromMockedIngestionResult(
  result: ProcessTurnResult,
): TurnPersistenceReceipt {
  return {
    episodeId: result.episodeId,
    deterministicFactIds: result.deterministicFactIds,
    providerFactIds: result.providerFactIds,
    invalidatedFactIds: result.invalidatedFactIds,
    activeFocusUpdated: result.activeFocusUpdated,
    openThreadsUpdated: result.openThreadsUpdated,
    providerOutcome: result.providerOutcome,
    bridgedEvidenceFactIds: result.bridgedEvidenceFactIds,
    agentRunMemoryFactIds: result.agentRunMemoryFactIds,
  };
}

export function commitMockedStructuralReceipt(
  input: ProcessTurnInput,
  result: ProcessTurnResult,
): TurnPersistenceReceipt {
  const receipt = receiptFromMockedIngestionResult(result);
  return input.commitStructuralCheckpoint?.(receipt) ?? receipt;
}

export function commitMockedProviderFinalReceipt(
  input: ProcessTurnInput,
  result: ProcessTurnResult,
  structural?: TurnPersistenceReceipt,
): void {
  const finalReceipt = receiptFromMockedIngestionResult(result);
  input.commitPersistenceReceipt?.({
    ...finalReceipt,
    activeFocusUpdated: finalReceipt.activeFocusUpdated || structural?.activeFocusUpdated === true,
    openThreadsUpdated: finalReceipt.openThreadsUpdated || structural?.openThreadsUpdated === true,
  });
}

/**
 * Model a real processed turn in queue tests: source-bound structural receipt
 * first, then the final receipt unless this is an enrichment-only checkpoint.
 */
export function commitMockedIngestionTurnReceipts(
  input: ProcessTurnInput,
  result: ProcessTurnResult,
): ProcessTurnResult {
  if (!result.processed) return result;
  const structural = commitMockedStructuralReceipt(input, result);
  if (!input.deferStructuralFinalization) {
    commitMockedProviderFinalReceipt(input, result, structural);
  }
  return result;
}

export function resolveMockedIngestionTurn(
  result: ProcessTurnResult,
): (input: ProcessTurnInput) => Promise<ProcessTurnResult> {
  return async (input) => commitMockedIngestionTurnReceipts(input, result);
}
