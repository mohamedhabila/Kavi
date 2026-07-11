import { isMemoryReadEpochCurrent } from '../../../services/memory/policy';
import type { Message } from '../../../types/message';
import type { PreparedAgentTurn } from '../agentTurnPreparation';

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
  return !fence || isMemoryReadEpochCurrent(fence.readEpoch);
}

export function buildMemoryPromptDispatchGuard(
  preparedTurn: PreparedAgentTurn,
): (() => void) | undefined {
  const fence = preparedTurn.memoryReadFence;
  if (!fence) return undefined;
  return () => {
    if (!isMemoryReadEpochCurrent(fence.readEpoch)) {
      throw new MemoryPromptEpochExpiredError();
    }
  };
}

export function removeLivingMemoryFromPreparedTurn(
  preparedTurn: PreparedAgentTurn,
): PreparedAgentTurn {
  const fence = preparedTurn.memoryReadFence;
  if (!fence) return preparedTurn;
  const { memoryReadFence: _discarded, ...withoutFence } = preparedTurn;
  return {
    ...withoutFence,
    enrichedSystemPrompt: fence.memoryFreePrompt.enrichedSystemPrompt,
    enrichedSystemPromptSections: fence.memoryFreePrompt.enrichedSystemPromptSections,
  };
}

/**
 * Compaction summaries may have been shaped by living-memory hints or contain
 * reinjected profile sections. On opt-out, discard those synthetic system
 * messages and retain only the original conversation tail.
 */
export function removeLivingMemoryCompactionMessages(
  messages: ReadonlyArray<Message>,
): Message[] {
  return messages.filter(
    (message) => !(message.role === 'system' && message.id.startsWith('compact_')),
  );
}
