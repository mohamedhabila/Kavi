import type { AssistantCompletionMetadata } from '../../types';

export const MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES = 2;

const TOKEN_BUDGET_EXHAUSTION_REASONS = new Set([
  'length',
  'max_completion_tokens',
  'max_output_tokens',
  'max_tokens',
]);

const RESUMABLE_INCOMPLETE_TEXT_REASONS = new Set([
  'model_context_window_exceeded',
  'network_interruption',
  'pause_turn',
  'stream_ended_without_done_marker',
  'stream_ended_without_finish_reason',
  'stream_ended_without_message_stop',
  'stream_ended_without_terminal_event',
]);

export function normalizeCompletionFinishReason(finishReason: string | undefined): string {
  if (typeof finishReason !== 'string') {
    return '';
  }

  return finishReason
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isTokenBudgetExhaustedCompletion(
  completion?: AssistantCompletionMetadata,
): boolean {
  return TOKEN_BUDGET_EXHAUSTION_REASONS.has(
    normalizeCompletionFinishReason(completion?.finishReason),
  );
}

export function isResumableIncompleteTextCompletion(
  completion?: AssistantCompletionMetadata,
): boolean {
  if (completion?.completionStatus !== 'incomplete') {
    return false;
  }

  const normalizedReason = normalizeCompletionFinishReason(completion.finishReason);
  if (!normalizedReason) {
    return false;
  }

  return (
    TOKEN_BUDGET_EXHAUSTION_REASONS.has(normalizedReason) ||
    RESUMABLE_INCOMPLETE_TEXT_REASONS.has(normalizedReason)
  );
}

export function buildIncompleteTextContinuationNote(finishReason?: string): string {
  const normalizedReason = normalizeCompletionFinishReason(finishReason);
  const renderedReason = normalizedReason
    ? normalizedReason.replace(/_/g, ' ')
    : 'an incomplete response';

  return [
    '[SYSTEM FINAL ANSWER CONTINUE]',
    `The previous final answer ended early (${renderedReason}).`,
    'Continue the same user-facing answer from exactly where it stopped.',
    'Do not restart from the beginning, do not repeat completed text, and do not call tools.',
  ].join('\n');
}
