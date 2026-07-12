import { estimateTokens } from '../../../services/context/tokenCounter';
import { isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import type { VerifiedProcedureExecutionSession } from '../../../services/memory/verifiedProcedure/executionSession';
import { isVerifiedProcedureObservationRevisionCurrent } from '../../../services/memory/verifiedProcedure/observationRevision';
import {
  joinSystemPromptSections,
  orderSystemPromptSectionsForCaching,
} from '../../prompts/orchestratorPromptSections';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import {
  isPreparedMemoryReadCurrent,
  removeLivingMemoryFromPreparedTurn,
} from './memoryPromptDispatchFence';

export const VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS = 320;

/**
 * Appends only code-owned, same-run applicable procedure evidence. The section
 * shares the prompt's memory epoch fence and is never provider-cacheable.
 */
export async function appendVerifiedProcedureAdvisoryPrompt(
  preparedTurn: PreparedAgentTurn,
  session: VerifiedProcedureExecutionSession | undefined,
): Promise<PreparedAgentTurn> {
  if (!session || !preparedTurn.toolsForIteration?.length) {
    return isPreparedMemoryReadCurrent(preparedTurn)
      ? preparedTurn
      : removeLivingMemoryFromPreparedTurn(preparedTurn);
  }

  const advisory = await session.buildApplicableAdvisory(preparedTurn.toolsForIteration);
  if (!advisory) {
    return isPreparedMemoryReadCurrent(preparedTurn)
      ? preparedTurn
      : removeLivingMemoryFromPreparedTurn(preparedTurn);
  }
  if (
    estimateTokens(advisory.section) > VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS ||
    !isMemoryReadEpochCurrent(advisory.readEpoch) ||
    !isVerifiedProcedureObservationRevisionCurrent(advisory.observationRevision) ||
    (preparedTurn.memoryReadFence !== undefined &&
      preparedTurn.memoryReadFence.readEpoch !== advisory.readEpoch)
  ) {
    return removeLivingMemoryFromPreparedTurn(preparedTurn);
  }

  const memoryFreePrompt = preparedTurn.memoryReadFence?.memoryFreePrompt ?? {
    enrichedSystemPrompt: preparedTurn.enrichedSystemPrompt,
    enrichedSystemPromptSections: preparedTurn.enrichedSystemPromptSections,
  };
  const enrichedSystemPromptSections = orderSystemPromptSectionsForCaching([
    ...preparedTurn.enrichedSystemPromptSections,
    { text: advisory.section, cacheable: false },
  ]);
  const augmented: PreparedAgentTurn = {
    ...preparedTurn,
    enrichedSystemPrompt: joinSystemPromptSections(enrichedSystemPromptSections),
    enrichedSystemPromptSections,
    memoryReadFence: {
      readEpoch: advisory.readEpoch,
      verifiedProcedureObservationRevision: advisory.observationRevision,
      memoryFreePrompt,
    },
  };
  return isMemoryReadEpochCurrent(advisory.readEpoch) &&
    isVerifiedProcedureObservationRevisionCurrent(advisory.observationRevision)
    ? augmented
    : removeLivingMemoryFromPreparedTurn(augmented);
}
