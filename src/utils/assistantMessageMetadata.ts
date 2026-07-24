import {
  AssistantCompletionMetadata,
  AssistantMessageKind,
  AssistantMessageMetadata,
  Message,
} from '../types/message';

const MEMORY_RETRIEVAL_EVENT_ID_PATTERN = /^retrieval_event_[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/u;
const ASSISTANT_FINISH_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;

/** Provider protocol dispositions that terminate a text response successfully. */
const PROVIDER_COMPLETE_TEXT_FINISH_REASONS = new Set([
  'completed',
  'done_marker',
  'end_turn',
  'local_runtime_done',
  'message_stop',
  'refusal',
  'response.completed',
  'stop',
  'stop_sequence',
]);

/** Provider protocol dispositions that hand control to one or more emitted tools. */
const PROVIDER_COMPLETE_TOOL_FINISH_REASONS = new Set(['tool_call', 'tool_calls', 'tool_use']);

/** Provider protocol dispositions that did not produce a complete response. */
const PROVIDER_INCOMPLETE_FINISH_REASONS = new Set([
  'blocklist',
  'cancelled',
  'content_filter',
  'error',
  'failed',
  'image_other',
  'image_prohibited_content',
  'image_recitation',
  'image_safety',
  'in_progress',
  'incomplete',
  'language',
  'length',
  'malformed_function_call',
  'max_completion_tokens',
  'max_output_tokens',
  'max_tokens',
  'model_context_window_exceeded',
  'network_interruption',
  'no_image',
  'other',
  'pause_turn',
  'prohibited_content',
  'queued',
  'recitation',
  'requires_action',
  'response.cancelled',
  'response.failed',
  'response.incomplete',
  'safety',
  'spii',
  'stream_ended_without_done_marker',
  'stream_ended_without_finish_reason',
  'stream_ended_without_message_stop',
  'stream_ended_without_terminal_event',
  'too_many_tool_calls',
  'unexpected_tool_call',
]);

/** Code-owned final dispositions that contain a deliverable assistant response. */
const CODE_COMPLETE_DELIVERABLE_FINISH_REASONS = new Set([
  'command_result',
  'fallback_from_evidence',
  'graph_expected_output',
  'graph_finalized',
  'loop_detected',
  'request_clarification',
  'scheduler_completion_recovered',
  'synthesized_from_evidence',
  'tool_batch_incomplete',
  'user_approval_denied',
]);

/** Code-owned terminal outcomes that must not be treated as a delivered response. */
const CODE_COMPLETE_NON_DELIVERABLE_FINISH_REASONS = new Set([
  'fallback_missing_final_response',
  'max_iterations',
  'yielded',
]);

/** Code-owned incomplete or pending lifecycle dispositions. */
const CODE_INCOMPLETE_FINISH_REASONS = new Set([
  'app_restarted',
  'app_restarted_before_start',
  'cancelled_before_start',
  'empty_final_text_after_recovery',
  'interrupted_before_start',
  'missing_completion_metadata',
  'post_surface_response_pending',
  'response_failed',
  'surfaced_worker_output_pending',
  'terminal_review_pending',
  'tool_effect_not_claimed',
  'tool_effect_reconciliation_required',
]);
const ATTRIBUTION_PRESERVING_FINISH_REASONS = new Set([
  'terminal_review_pending',
  'response_failed',
  'graph_finalized',
  'synthesized_from_evidence',
  'graph_expected_output',
  'fallback_from_evidence',
]);
const SETTLED_INCOMPLETE_FINISH_REASONS = new Set([
  'app_restarted',
  'app_restarted_before_start',
  'cancelled_before_start',
  'empty_final_text_after_recovery',
  'interrupted_before_start',
  'response_failed',
]);
const UNSETTLED_FINAL_FINISH_REASONS = new Set([
  'post_surface_response_pending',
  'surfaced_worker_output_pending',
  'terminal_review_pending',
  'yielded',
]);

export const MISSING_ASSISTANT_COMPLETION_FINISH_REASON = 'missing_completion_metadata';

function normalizeAssistantFinishReasonCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ASSISTANT_FINISH_REASON_PATTERN.test(value)) {
    return undefined;
  }
  return value.toLowerCase();
}

function isProviderCompleteFinishReasonCode(value: string): boolean {
  return (
    PROVIDER_COMPLETE_TEXT_FINISH_REASONS.has(value) ||
    PROVIDER_COMPLETE_TOOL_FINISH_REASONS.has(value)
  );
}

function isKnownCompleteFinishReasonCode(value: string): boolean {
  return (
    isProviderCompleteFinishReasonCode(value) ||
    CODE_COMPLETE_DELIVERABLE_FINISH_REASONS.has(value) ||
    CODE_COMPLETE_NON_DELIVERABLE_FINISH_REASONS.has(value)
  );
}

function isKnownIncompleteFinishReasonCode(value: string): boolean {
  return PROVIDER_INCOMPLETE_FINISH_REASONS.has(value) || CODE_INCOMPLETE_FINISH_REASONS.has(value);
}

export function isAssistantFinishReason(value: unknown): value is string {
  const finishReason = normalizeAssistantFinishReasonCode(value);
  return Boolean(
    finishReason &&
    (isKnownCompleteFinishReasonCode(finishReason) ||
      isKnownIncompleteFinishReasonCode(finishReason)),
  );
}

function normalizeAssistantFinishReason(value: unknown): string | undefined {
  return isAssistantFinishReason(value) ? value : undefined;
}

export function isCompleteProviderAssistantCompletionMetadata(
  completion: AssistantCompletionMetadata | undefined,
): boolean {
  const finishReason = normalizeAssistantFinishReasonCode(completion?.finishReason);
  return (
    completion?.completionStatus === 'complete' &&
    finishReason !== undefined &&
    isProviderCompleteFinishReasonCode(finishReason)
  );
}

export function isValidAssistantMessageMetadata(
  metadata: unknown,
): metadata is AssistantMessageMetadata {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return false;
  }
  const candidate = metadata as Partial<AssistantMessageMetadata>;
  if (candidate.kind !== 'intermediate' && candidate.kind !== 'final') {
    return false;
  }
  const finishReason = normalizeAssistantFinishReasonCode(candidate.finishReason);
  if (!finishReason) {
    return false;
  }

  if (candidate.completionStatus === 'incomplete') {
    return isKnownIncompleteFinishReasonCode(finishReason);
  }
  if (candidate.completionStatus !== 'complete') {
    return false;
  }
  if (candidate.kind === 'intermediate') {
    return isProviderCompleteFinishReasonCode(finishReason);
  }
  return (
    PROVIDER_COMPLETE_TEXT_FINISH_REASONS.has(finishReason) ||
    CODE_COMPLETE_DELIVERABLE_FINISH_REASONS.has(finishReason) ||
    CODE_COMPLETE_NON_DELIVERABLE_FINISH_REASONS.has(finishReason)
  );
}

export function isMemoryRetrievalEventId(value: unknown): value is string {
  return typeof value === 'string' && MEMORY_RETRIEVAL_EVENT_ID_PATTERN.test(value);
}

export function buildAssistantMessageMetadata(
  kind: AssistantMessageKind,
  completion?: AssistantCompletionMetadata,
): AssistantMessageMetadata {
  const finishReason = normalizeAssistantFinishReason(completion?.finishReason);
  const candidate = finishReason
    ? {
        kind,
        completionStatus: completion?.completionStatus ?? 'incomplete',
        finishReason,
        ...(completion?.terminalReason ? { terminalReason: completion.terminalReason } : {}),
      }
    : undefined;
  if (!candidate || !isValidAssistantMessageMetadata(candidate)) {
    return {
      kind,
      completionStatus: 'incomplete',
      finishReason: MISSING_ASSISTANT_COMPLETION_FINISH_REASON,
      ...(completion?.terminalReason ? { terminalReason: completion.terminalReason } : {}),
    };
  }
  return candidate;
}

export function mergeAssistantMessageMetadata(
  current: AssistantMessageMetadata | undefined,
  next: AssistantMessageMetadata | undefined,
): AssistantMessageMetadata | undefined {
  if (
    !next ||
    next.memoryRetrievalEventId !== undefined ||
    !current?.memoryRetrievalEventId ||
    !next.finishReason ||
    !ATTRIBUTION_PRESERVING_FINISH_REASONS.has(next.finishReason)
  ) {
    return next;
  }

  return {
    ...next,
    memoryRetrievalEventId: current.memoryRetrievalEventId,
  };
}

export function isFinalAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    !message.subAgentEvent &&
    (message.toolCalls?.length ?? 0) === 0 &&
    message.content.trim().length > 0
  );
}

export function isDeliverableAssistantCompletionMetadata(
  metadata: AssistantMessageMetadata | undefined,
): metadata is AssistantMessageMetadata {
  if (!isValidAssistantMessageMetadata(metadata)) {
    return false;
  }
  const finishReason = normalizeAssistantFinishReasonCode(metadata.finishReason);
  return (
    metadata.kind === 'final' &&
    metadata.completionStatus === 'complete' &&
    finishReason !== undefined &&
    (PROVIDER_COMPLETE_TEXT_FINISH_REASONS.has(finishReason) ||
      CODE_COMPLETE_DELIVERABLE_FINISH_REASONS.has(finishReason))
  );
}

type TerminalAssistantMessage = Message & {
  role: 'assistant';
  assistantMetadata: AssistantMessageMetadata;
};

export function hasTerminalAssistantCompletionMetadata(
  message: Message,
): message is TerminalAssistantMessage {
  return (
    isFinalAssistantMessage(message) &&
    isDeliverableAssistantCompletionMetadata(message.assistantMetadata)
  );
}

/** Any explicit complete plain final, including a typed terminal non-delivery outcome. */
export function hasTypedCompleteFinalAssistantMetadata(message: Message): boolean {
  return (
    isFinalAssistantMessage(message) &&
    isValidAssistantMessageMetadata(message.assistantMetadata) &&
    message.assistantMetadata.kind === 'final' &&
    message.assistantMetadata.completionStatus === 'complete' &&
    normalizeAssistantFinishReasonCode(message.assistantMetadata.finishReason) !== undefined
  );
}

export function hasCompleteFinalAssistantMetadata(
  message: Message,
): message is TerminalAssistantMessage {
  return isFinalAssistantMessage(message) && hasTerminalAssistantCompletionMetadata(message);
}

/** True only when a visible final response has explicit, non-pending terminal metadata. */
export function hasSettledFinalAssistantMetadata(message: Message): boolean {
  if (!isFinalAssistantMessage(message)) return false;
  if (!isValidAssistantMessageMetadata(message.assistantMetadata)) return false;
  const finishReason = normalizeAssistantFinishReasonCode(message.assistantMetadata.finishReason);
  if (!finishReason) return false;
  if (UNSETTLED_FINAL_FINISH_REASONS.has(finishReason)) return false;
  return (
    message.assistantMetadata.kind === 'final' &&
    (message.assistantMetadata.completionStatus === 'complete' ||
      (message.assistantMetadata.completionStatus === 'incomplete' &&
        SETTLED_INCOMPLETE_FINISH_REASONS.has(finishReason)))
  );
}

export function isIncompleteAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' && message.assistantMetadata?.completionStatus === 'incomplete'
  );
}

export function isPendingReviewAssistantMessage(message: Message): boolean {
  return (
    isIncompleteAssistantMessage(message) &&
    message.assistantMetadata?.kind === 'final' &&
    message.assistantMetadata.finishReason === 'terminal_review_pending'
  );
}
