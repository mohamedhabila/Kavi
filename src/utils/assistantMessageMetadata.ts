import {
  AssistantCompletionMetadata,
  AssistantMessageKind,
  AssistantMessageMetadata,
  Message,
} from '../types';

export function buildAssistantMessageMetadata(
  kind: AssistantMessageKind,
  completion?: AssistantCompletionMetadata,
): AssistantMessageMetadata {
  return {
    kind,
    completionStatus: completion?.completionStatus ?? 'complete',
    ...(completion?.finishReason ? { finishReason: completion.finishReason } : {}),
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

export function isIncompleteAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' && message.assistantMetadata?.completionStatus === 'incomplete'
  );
}
