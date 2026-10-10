import type { AgentRun } from '../../types/agentRun';
import type { Message } from '../../types/message';

/** Final answers that stop a task partway and invite the person to carry it on. */
const CONTINUABLE_FINISH_REASONS = new Set(['max_iterations', 'loop_detected']);

/**
 * Whether an answer handed a task back unfinished — the run reached its step limit, stopped
 * repeating itself, or reached the foreground work window and reported progress — so the
 * person can carry it on with one tap instead of typing. Read from the code-owned finish
 * reason and the run's last turn directive, never from the answer's wording.
 */
export function isContinuableStop(
  message: Pick<Message, 'role' | 'assistantMetadata'>,
  agentRun?: Pick<AgentRun, 'controlGraph'>,
): boolean {
  if (message.role !== 'assistant' || message.assistantMetadata?.kind !== 'final') return false;
  if (CONTINUABLE_FINISH_REASONS.has(message.assistantMetadata.finishReason)) return true;
  return (
    agentRun?.controlGraph?.turnDirectives?.forcedTextReason === 'foreground_budget_checkpoint'
  );
}
