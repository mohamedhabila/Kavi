import { isLongTermMemoryEnabled, isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import { isVerifiedProcedureObservationRevisionCurrent } from '../../../services/memory/verifiedProcedure/observationRevision';
import type { Message } from '../../../types/message';
import type { PreparedAgentTurn, PreparedAgentTurnCore } from '../agentTurnPreparation';
import { buildMemoryPolicyPromptSection } from '../../prompts/memoryPolicyPrompt';
import {
  appendSystemPromptSection,
  joinSystemPromptSections,
  orderSystemPromptSectionsForCaching,
} from '../../prompts/orchestratorPromptSections';
import { isToolAllowedForMemoryPolicy } from '../../tools/memoryPolicyToolAuthority';

const MEMORY_PROMPT_EPOCH_EXPIRED = 'memory_prompt_epoch_expired';

export class MemoryPromptEpochExpiredError extends Error {
  constructor() {
    super(MEMORY_PROMPT_EPOCH_EXPIRED);
    this.name = 'MemoryPromptEpochExpiredError';
  }
}

export function isMemoryPromptEpochExpiredError(error: unknown): boolean {
  return (
    error instanceof MemoryPromptEpochExpiredError ||
    (error instanceof Error && error.message === MEMORY_PROMPT_EPOCH_EXPIRED)
  );
}

export function isPreparedMemoryReadCurrent(preparedTurn: PreparedAgentTurn): boolean {
  const fence = preparedTurn.memoryReadFence;
  return (
    !fence ||
    (isMemoryReadEpochCurrent(fence.readEpoch) &&
      (!fence.verifiedProcedureObservationRevision ||
        isVerifiedProcedureObservationRevisionCurrent(fence.verifiedProcedureObservationRevision)))
  );
}

export function buildMemoryPromptDispatchGuard(
  preparedTurn: PreparedAgentTurn,
): (() => void) | undefined {
  const fence = preparedTurn.memoryReadFence;
  if (!fence) return undefined;
  return () => {
    if (
      !isMemoryReadEpochCurrent(fence.readEpoch) ||
      (fence.verifiedProcedureObservationRevision !== undefined &&
        !isVerifiedProcedureObservationRevisionCurrent(fence.verifiedProcedureObservationRevision))
    ) {
      throw new MemoryPromptEpochExpiredError();
    }
  };
}

export function removeLivingMemoryFromPreparedTurn(
  preparedTurn: PreparedAgentTurn,
): PreparedAgentTurn {
  const fence = preparedTurn.memoryReadFence;
  if (!fence) return preparedTurn;
  if (!isLongTermMemoryEnabled()) return { ...fence.memoryDisabledTurn };
  const { memoryReadFence: _discarded, ...memoryFreeTurn } = preparedTurn;
  return {
    ...memoryFreeTurn,
    enrichedSystemPrompt: fence.memoryFreePrompt.enrichedSystemPrompt,
    enrichedSystemPromptSections: fence.memoryFreePrompt.enrichedSystemPromptSections,
  };
}

/**
 * Verified-procedure evidence can make an otherwise memory-independent turn
 * memory-sensitive. Its existing tool surface is already policy-safe; build a
 * disabled prompt snapshot without rewriting rendered prompt text.
 */
export function buildMemoryDisabledPolicyIndependentTurn(
  preparedTurn: PreparedAgentTurn,
): PreparedAgentTurnCore {
  if (preparedTurn.selectedTools.some((tool) => !isToolAllowedForMemoryPolicy(tool, false))) {
    throw new Error('memory_sensitive_turn_missing_policy_fallback');
  }
  const { memoryReadFence: _discarded, ...core } = preparedTurn;
  const enrichedSystemPromptSections = core.enrichedSystemPromptSections.map((section) => ({
    ...section,
  }));
  appendSystemPromptSection(enrichedSystemPromptSections, buildMemoryPolicyPromptSection(false));
  const orderedSections = orderSystemPromptSectionsForCaching(enrichedSystemPromptSections);
  return {
    ...core,
    enrichedSystemPrompt: joinSystemPromptSections(orderedSections),
    enrichedSystemPromptSections: orderedSections,
  };
}

/**
 * Compaction summaries may have been shaped by living-memory hints or contain
 * reinjected profile sections. On opt-out, discard those synthetic system
 * messages and retain only the original conversation tail.
 */
export function removeLivingMemoryCompactionMessages(messages: ReadonlyArray<Message>): Message[] {
  return messages.filter(
    (message) => !(message.role === 'system' && message.id.startsWith('compact_')),
  );
}
