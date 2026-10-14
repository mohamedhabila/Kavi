import type { Message } from '../../types/message';

/** Final answers that stop a task partway and invite the person to carry it on. */
const CONTINUABLE_FINISH_REASONS = new Set(['max_iterations', 'loop_detected']);

/**
 * Whether an answer handed a task back unfinished — the run reached its step limit or
 * stopped repeating itself — so the person can carry it on with one tap instead of typing.
 * Read from the code-owned finish reason, never from the answer's wording.
 */
export function isContinuableStop(message: Pick<Message, 'role' | 'assistantMetadata'>): boolean {
  if (message.role !== 'assistant' || message.assistantMetadata?.kind !== 'final') return false;
  return CONTINUABLE_FINISH_REASONS.has(message.assistantMetadata.finishReason);
}
