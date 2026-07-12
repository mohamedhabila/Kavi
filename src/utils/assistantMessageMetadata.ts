import {
  AssistantCompletionMetadata,
  AssistantMessageKind,
  AssistantMessageMetadata,
  Message,
} from '../types/message';

const MEMORY_RETRIEVAL_EVENT_ID_PATTERN = /^retrieval_event_[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/u;
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

export function isMemoryRetrievalEventId(value: unknown): value is string {
  return typeof value === 'string' && MEMORY_RETRIEVAL_EVENT_ID_PATTERN.test(value);
}

export function buildAssistantMessageMetadata(
  kind: AssistantMessageKind,
  completion?: AssistantCompletionMetadata,
): AssistantMessageMetadata {
  return {
    kind,
    completionStatus: completion?.completionStatus ?? 'complete',
    ...(completion?.finishReason ? { finishReason: completion.finishReason } : {}),
    ...(completion?.terminalReason ? { terminalReason: completion.terminalReason } : {}),
  };
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

const MAX_TOOL_ITERATIONS_PLACEHOLDER_PATTERN =
  /^I[\u2019']ve reached the maximum number of tool iterations\b/i;
const BACKGROUND_WORKER_WAIT_PLACEHOLDER_PATTERNS = [
  /^Waiting for \d+ background workers? to finish\.?$/i,
  /^Waiting for background (?:agent|worker) results\.?$/i,
];

export function isAssistantFinalResponsePlaceholder(message: Message): boolean {
  if (!isFinalAssistantMessage(message)) {
    return false;
  }

  const normalizedContent = message.content.trim();
  const normalizedFinishReason = message.assistantMetadata?.finishReason?.trim().toLowerCase();

  if (normalizedFinishReason === 'max_iterations' || normalizedFinishReason === 'yielded') {
    return true;
  }

  if (MAX_TOOL_ITERATIONS_PLACEHOLDER_PATTERN.test(normalizedContent)) {
    return true;
  }

  return BACKGROUND_WORKER_WAIT_PLACEHOLDER_PATTERNS.some((pattern) =>
    pattern.test(normalizedContent),
  );
}

function isAssistantExecutionArtifact(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    (!!message.subAgentEvent || (message.toolCalls?.length ?? 0) > 0)
  );
}

function buildLegacyAssistantMetadata(
  message: Message,
  isFinal: boolean,
): AssistantMessageMetadata | undefined {
  if (message.role !== 'assistant' || message.subAgentEvent) {
    return undefined;
  }

  if ((message.toolCalls?.length ?? 0) > 0) {
    return buildAssistantMessageMetadata('intermediate', {
      completionStatus: message.isError ? 'incomplete' : 'complete',
      finishReason: 'legacy_migration',
    });
  }

  if (message.content.trim().length === 0) {
    return undefined;
  }

  return buildAssistantMessageMetadata(isFinal ? 'final' : 'intermediate', {
    completionStatus: message.isError ? 'incomplete' : 'complete',
    finishReason: 'legacy_migration',
  });
}

export function normalizeLegacyAssistantMessages(messages: Message[]): Message[] {
  if (!messages.some((message) => message.role === 'assistant' && !message.assistantMetadata)) {
    return messages;
  }

  let didChange = false;
  const normalizedMessages = [...messages];

  let sliceStart = 0;
  while (sliceStart < messages.length) {
    let sliceEnd = sliceStart + 1;
    while (sliceEnd < messages.length && messages[sliceEnd].role !== 'user') {
      sliceEnd += 1;
    }

    const runMessages = messages.slice(sliceStart, sliceEnd);
    let lastExecutionArtifactIndex = -1;
    let lastFinalAssistantCandidateIndex = -1;

    runMessages.forEach((message, localIndex) => {
      if (message.role === 'tool' || isAssistantExecutionArtifact(message)) {
        lastExecutionArtifactIndex = localIndex;
      }

      if (isFinalAssistantMessage(message)) {
        lastFinalAssistantCandidateIndex = localIndex;
      }
    });

    runMessages.forEach((message, localIndex) => {
      if (message.role !== 'assistant' || message.assistantMetadata) {
        return;
      }

      const assistantMetadata = buildLegacyAssistantMetadata(
        message,
        localIndex === lastFinalAssistantCandidateIndex && localIndex > lastExecutionArtifactIndex,
      );
      if (!assistantMetadata) {
        return;
      }

      normalizedMessages[sliceStart + localIndex] = {
        ...message,
        assistantMetadata,
      };
      didChange = true;
    });

    sliceStart = sliceEnd;
  }

  return didChange ? normalizedMessages : messages;
}

export function hasCompleteFinalAssistantMetadata(message: Message): boolean {
  if (!isFinalAssistantMessage(message)) {
    return false;
  }

  return (
    message.assistantMetadata?.kind === 'final' &&
    message.assistantMetadata.completionStatus === 'complete'
  );
}

/** True only when a visible final response has explicit, non-pending terminal metadata. */
export function hasSettledFinalAssistantMetadata(message: Message): boolean {
  if (!isFinalAssistantMessage(message)) return false;
  const finishReason = message.assistantMetadata?.finishReason ?? '';
  if (UNSETTLED_FINAL_FINISH_REASONS.has(finishReason)) return false;
  return (
    message.assistantMetadata?.kind === 'final' &&
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
