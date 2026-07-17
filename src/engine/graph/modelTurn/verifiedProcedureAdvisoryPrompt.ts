import { estimateTokens } from '../../../services/context/tokenCounter';
import { isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import type { VerifiedProcedureExecutionSession } from '../../../services/memory/verifiedProcedure/executionSession';
import { isVerifiedProcedureProjectionSnapshotDurablyCurrent } from '../../../services/memory/verifiedProcedure/observationAuthority';
import {
  captureMemoryAuthoritySnapshot,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../services/memory/memoryAuthority';
import {
  earliestFutureMemoryValidityDeadline,
  isMemoryValidityDeadlineCurrent,
} from '../../../services/memory/memoryValidityDeadline';
import {
  joinSystemPromptSections,
  orderSystemPromptSectionsForCaching,
} from '../../prompts/orchestratorPromptSections';
import type { PreparedAgentTurn } from '../agentTurnPreparation';
import { isPreparedMemoryReadCurrent } from './memoryPromptDispatchFence';
import { MemoryPromptEpochExpiredError } from '../../authority/modelTurnMemoryPolicyBinding';

export const VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS = 320;

function assertPreparedMemoryReadCurrent(preparedTurn: PreparedAgentTurn): void {
  if (!isPreparedMemoryReadCurrent(preparedTurn)) {
    throw new MemoryPromptEpochExpiredError();
  }
}

/**
 * Appends only code-owned, same-run applicable procedure evidence. The section
 * shares the prompt's memory epoch fence and is never provider-cacheable.
 */
export async function appendVerifiedProcedureAdvisoryPrompt(
  preparedTurn: PreparedAgentTurn,
  session: VerifiedProcedureExecutionSession | undefined,
): Promise<PreparedAgentTurn> {
  assertPreparedMemoryReadCurrent(preparedTurn);
  if (!session || !preparedTurn.toolsForIteration?.length) {
    return preparedTurn;
  }

  const advisory = await session.buildApplicableAdvisory(preparedTurn.toolsForIteration);
  assertPreparedMemoryReadCurrent(preparedTurn);
  if (!advisory) {
    return preparedTurn;
  }
  if (estimateTokens(advisory.section) > VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS) {
    return preparedTurn;
  }
  if (
    !isMemoryReadEpochCurrent(advisory.readEpoch) ||
    !isVerifiedProcedureProjectionSnapshotDurablyCurrent(advisory.authoritySnapshot) ||
    !isMemoryValidityDeadlineCurrent(advisory.validUntil) ||
    (preparedTurn.memoryReadFence !== undefined &&
      preparedTurn.memoryReadFence.readEpoch !== advisory.readEpoch)
  ) {
    throw new MemoryPromptEpochExpiredError();
  }

  const memoryAuthoritySnapshot =
    preparedTurn.memoryReadFence?.memoryAuthoritySnapshot ?? captureMemoryAuthoritySnapshot();
  if (
    !memoryAuthoritySnapshot ||
    !isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(memoryAuthoritySnapshot)
  ) {
    throw new MemoryPromptEpochExpiredError();
  }
  const validUntil = earliestFutureMemoryValidityDeadline(
    [preparedTurn.memoryReadFence?.validUntil, advisory.validUntil],
    Date.now(),
  );
  const enrichedSystemPromptSections = orderSystemPromptSectionsForCaching([
    ...preparedTurn.enrichedSystemPromptSections,
    { text: advisory.section, cacheable: false, purpose: 'verified_procedure' },
  ]);
  const augmented: PreparedAgentTurn = {
    ...preparedTurn,
    enrichedSystemPrompt: joinSystemPromptSections(enrichedSystemPromptSections),
    enrichedSystemPromptSections,
    memoryReadFence: {
      readEpoch: advisory.readEpoch,
      memoryAuthoritySnapshot,
      ...(validUntil === undefined ? {} : { validUntil }),
      verifiedProcedureAuthoritySnapshot: advisory.authoritySnapshot,
    },
  };
  if (
    !isMemoryReadEpochCurrent(advisory.readEpoch) ||
    !isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(memoryAuthoritySnapshot) ||
    !isVerifiedProcedureProjectionSnapshotDurablyCurrent(advisory.authoritySnapshot) ||
    !isMemoryValidityDeadlineCurrent(validUntil)
  ) {
    throw new MemoryPromptEpochExpiredError();
  }
  return augmented;
}
