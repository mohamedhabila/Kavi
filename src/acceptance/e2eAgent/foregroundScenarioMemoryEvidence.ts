import { runMemoryTransaction } from '../../services/memory/access/transaction';
import {
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
  type MemoryEvidenceScope,
} from '../../services/memory/evidenceSnapshot';
import { getIngestionJob } from '../../services/memory/ingestionQueue';
import { listIngestionDurabilityReceipts } from '../../services/memory/ingestionStructuralReceiptStore';
import {
  cloneAndFreeze,
  type ForegroundScenarioProviderOutcomeEvidenceRequirement,
  type ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';

const PROVIDER_EVIDENCE_INITIAL_POLL_MS = 25;
const PROVIDER_EVIDENCE_MAX_POLL_MS = 500;

export type ForegroundScenarioMemoryEvidenceSeal = Readonly<{
  memoryFinalState: ReturnType<typeof captureCompleteMemoryEvidenceForIsolatedEvaluation>;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
}>;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function providerOutcomeRequirementSatisfied(
  turn: ForegroundScenarioTurnSnapshot | undefined,
  providerOutcome: ForegroundScenarioProviderOutcomeEvidenceRequirement['providerOutcome'],
): boolean {
  if (!turn) return false;
  return turn.memory.some((snapshot) => {
    const jobId = snapshot.publication.jobId;
    if (!jobId) return false;
    return listIngestionDurabilityReceipts(jobId).some(
      (receipt) =>
        receipt.phase === 'provider_final' && receipt.providerOutcome === providerOutcome,
    );
  });
}

function allProviderOutcomeRequirementsSatisfied(
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>,
  requirements: ReadonlyArray<ForegroundScenarioProviderOutcomeEvidenceRequirement>,
): boolean {
  return requirements.every((requirement) =>
    providerOutcomeRequirementSatisfied(turns[requirement.turnIndex], requirement.providerOutcome),
  );
}

/**
 * Capture the final evaluator view under one memory transaction. A provider-final
 * receipt can therefore never be sealed alongside a pre-commit job/fact/episode
 * view. This is evaluation evidence collection only; product chat does not call it.
 */
export function sealForegroundScenarioMemoryEvidence(params: {
  memoryScope: MemoryEvidenceScope;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
}): ForegroundScenarioMemoryEvidenceSeal {
  return runMemoryTransaction(() => {
    const turns = params.turns.map(
      (turn) =>
        cloneAndFreeze({
          ...turn,
          memory: turn.memory.map((snapshot) => {
            const jobId = snapshot.publication.jobId;
            return {
              ...snapshot,
              job: jobId ? getIngestionJob(jobId) : null,
              receipts: jobId ? listIngestionDurabilityReceipts(jobId) : [],
            };
          }),
        }) as ForegroundScenarioTurnSnapshot,
    );
    const memoryFinalState = captureCompleteMemoryEvidenceForIsolatedEvaluation(params.memoryScope);
    return cloneAndFreeze({ memoryFinalState, turns }) as ForegroundScenarioMemoryEvidenceSeal;
  });
}

/**
 * Wait only for provider outcomes named by scenario rubrics, and only after all
 * foreground chat turns have returned at structural durability. Missing or slow
 * provider evidence is sealed as absent when the evaluator-owned deadline expires.
 */
export async function sealForegroundScenarioMemoryEvidenceAfterProviderWait(params: {
  memoryScope: MemoryEvidenceScope;
  turns: ReadonlyArray<ForegroundScenarioTurnSnapshot>;
  requirements: ReadonlyArray<ForegroundScenarioProviderOutcomeEvidenceRequirement>;
  timeoutMs: number;
}): Promise<ForegroundScenarioMemoryEvidenceSeal> {
  const deadline = Date.now() + Math.max(0, params.timeoutMs);
  let pollDelayMs = PROVIDER_EVIDENCE_INITIAL_POLL_MS;
  while (
    params.requirements.length > 0 &&
    !allProviderOutcomeRequirementsSatisfied(params.turns, params.requirements)
  ) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(pollDelayMs, remainingMs));
    pollDelayMs = Math.min(pollDelayMs * 2, PROVIDER_EVIDENCE_MAX_POLL_MS);
  }
  return sealForegroundScenarioMemoryEvidence({
    memoryScope: params.memoryScope,
    turns: params.turns,
  });
}
