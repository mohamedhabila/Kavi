import type { Message } from '../../../types/message';
import { stripInternalAssistantTranscriptArtifacts } from '../../../utils/assistantTextSanitizer';
import { mergeAssistantContinuationText } from './assistantContinuation';

type ResumedAssistantDraft = Pick<Message, 'assistantMetadata' | 'content' | 'id' | 'reasoning'>;

type StreamingDraftSnapshot = {
  content?: string;
  reasoning?: string;
};

type ForegroundAssistantStreamControllerActions = {
  clearStreamingDraft: (messageId: string) => void;
  mergeStreamingDraft: (messageId: string, patch: { content?: string; reasoning?: string }) => void;
  startAssistantTurn: (messageId: string) => void;
  updateMessage: (messageId: string, content: string) => void;
  updateMessageReasoning: (messageId: string, reasoning: string) => void;
};

export function createForegroundAssistantStreamController(params: {
  actions: ForegroundAssistantStreamControllerActions;
  checkpointIntervalMs: number;
  createAssistantMessageId: () => string;
  currentAssistantMessageId: string;
  getStreamingDraft: (messageId: string) => StreamingDraftSnapshot | undefined;
  publishIntervalMs: number;
  resumedAssistantDraft?: ResumedAssistantDraft;
}) {
  let currentAssistantMessageId = params.currentAssistantMessageId;
  let accumulatedContent = params.resumedAssistantDraft?.content ?? '';
  let accumulatedReasoning = params.resumedAssistantDraft?.reasoning ?? '';
  let lastCommittedContent = params.resumedAssistantDraft?.content ?? '';
  let lastCommittedReasoning = params.resumedAssistantDraft?.reasoning ?? '';
  let lastPublishedContent = params.resumedAssistantDraft?.content
    ? stripInternalAssistantTranscriptArtifacts(params.resumedAssistantDraft.content)
    : '';
  let lastPublishedReasoning = params.resumedAssistantDraft?.reasoning ?? '';
  let cachedVisibleContentSource = params.resumedAssistantDraft?.content ?? '';
  let cachedVisibleContent = params.resumedAssistantDraft?.content
    ? stripInternalAssistantTranscriptArtifacts(params.resumedAssistantDraft.content)
    : '';
  let startNextAssistantTurn = false;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let draftPublishTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDraftPublishedAt: number | null = null;

  const getVisibleAssistantContent = () => {
    if (cachedVisibleContentSource === accumulatedContent) {
      return cachedVisibleContent;
    }

    cachedVisibleContentSource = accumulatedContent;
    cachedVisibleContent = stripInternalAssistantTranscriptArtifacts(accumulatedContent);
    return cachedVisibleContent;
  };

  const clearDraftPublishTimer = () => {
    if (draftPublishTimer) {
      clearTimeout(draftPublishTimer);
      draftPublishTimer = null;
    }
  };

  const publishAssistantBuffersNow = (visibleContentOverride?: string) => {
    const visibleContent = visibleContentOverride ?? getVisibleAssistantContent();

    if (
      visibleContent === lastPublishedContent &&
      accumulatedReasoning === lastPublishedReasoning
    ) {
      return;
    }

    params.actions.mergeStreamingDraft(currentAssistantMessageId, {
      content: visibleContent,
      reasoning: accumulatedReasoning || undefined,
    });
    lastPublishedContent = visibleContent;
    lastPublishedReasoning = accumulatedReasoning;
    lastDraftPublishedAt = Date.now();
  };

  const publishAssistantBuffers = (
    visibleContentOverride?: string,
    options: { force?: boolean } = {},
  ) => {
    const visibleContent = visibleContentOverride ?? getVisibleAssistantContent();

    if (options.force) {
      clearDraftPublishTimer();
      publishAssistantBuffersNow(visibleContent);
      return;
    }

    const now = Date.now();
    if (lastDraftPublishedAt === null || now - lastDraftPublishedAt >= params.publishIntervalMs) {
      clearDraftPublishTimer();
      publishAssistantBuffersNow(visibleContent);
      return;
    }

    if (draftPublishTimer) {
      return;
    }

    draftPublishTimer = setTimeout(
      () => {
        draftPublishTimer = null;
        publishAssistantBuffersNow();
      },
      params.publishIntervalMs - (now - lastDraftPublishedAt),
    );
  };

  const commitBuffers = (finalize = false) => {
    if (checkpointTimer) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    clearDraftPublishTimer();

    publishAssistantBuffers(undefined, { force: true });

    const visibleContent = getVisibleAssistantContent();
    if (visibleContent !== lastCommittedContent) {
      params.actions.updateMessage(currentAssistantMessageId, visibleContent);
      lastCommittedContent = visibleContent;
    }

    if (accumulatedReasoning !== lastCommittedReasoning) {
      params.actions.updateMessageReasoning(currentAssistantMessageId, accumulatedReasoning);
      lastCommittedReasoning = accumulatedReasoning;
    }

    if (finalize) {
      params.actions.clearStreamingDraft(currentAssistantMessageId);
    }
  };

  const resetLiveBufferState = () => {
    accumulatedContent = '';
    accumulatedReasoning = '';
    lastCommittedContent = '';
    lastCommittedReasoning = '';
    lastPublishedContent = '';
    lastPublishedReasoning = '';
    lastDraftPublishedAt = null;
    cachedVisibleContentSource = '';
    cachedVisibleContent = '';
  };

  const ensureAssistantTurn = () => {
    if (!startNextAssistantTurn) {
      return false;
    }

    commitBuffers(true);
    currentAssistantMessageId = params.createAssistantMessageId();
    params.actions.startAssistantTurn(currentAssistantMessageId);
    resetLiveBufferState();
    startNextAssistantTurn = false;
    return true;
  };

  const scheduleCheckpoint = () => {
    if (checkpointTimer) {
      return;
    }
    checkpointTimer = setTimeout(() => {
      commitBuffers(false);
    }, params.checkpointIntervalMs);
  };

  return {
    appendReasoningToken(token: string) {
      ensureAssistantTurn();
      accumulatedReasoning += token;
      publishAssistantBuffers();
      scheduleCheckpoint();
    },
    appendToken(token: string) {
      ensureAssistantTurn();
      accumulatedContent += token;
      publishAssistantBuffers();
      scheduleCheckpoint();
    },
    commitBuffers,
    commitResolvedContent(content: string, finalize = false) {
      accumulatedContent = content;
      commitBuffers(finalize);
      accumulatedContent = '';
      lastCommittedContent = '';
    },
    ensureAssistantTurn,
    getCurrentAssistantMessageId() {
      return currentAssistantMessageId;
    },
    getCurrentStreamingDraft() {
      return params.getStreamingDraft(currentAssistantMessageId);
    },
    getVisibleAssistantContent,
    hasQueuedNextAssistantTurn() {
      return startNextAssistantTurn;
    },
    queueNextAssistantTurn() {
      startNextAssistantTurn = true;
    },
    resolveAssistantTurnContent(content: string): string {
      if (
        !params.resumedAssistantDraft ||
        currentAssistantMessageId !== params.resumedAssistantDraft.id
      ) {
        return content;
      }

      const preserveExistingDraft =
        params.resumedAssistantDraft.assistantMetadata?.finishReason === 'terminal_review_pending';
      const currentVisibleContent = getVisibleAssistantContent();
      const baselineContent =
        currentVisibleContent ||
        stripInternalAssistantTranscriptArtifacts(params.resumedAssistantDraft.content ?? '');
      const sanitizedIncomingContent = stripInternalAssistantTranscriptArtifacts(content);

      return mergeAssistantContinuationText(baselineContent, sanitizedIncomingContent, {
        preserveExistingPrefix: preserveExistingDraft,
      });
    },
    resetCurrentTurn() {
      if (checkpointTimer) {
        clearTimeout(checkpointTimer);
        checkpointTimer = null;
      }
      clearDraftPublishTimer();

      const baselineContent =
        params.resumedAssistantDraft &&
        currentAssistantMessageId === params.resumedAssistantDraft.id
          ? (params.resumedAssistantDraft.content ?? '')
          : '';
      const baselineReasoning =
        params.resumedAssistantDraft &&
        currentAssistantMessageId === params.resumedAssistantDraft.id
          ? (params.resumedAssistantDraft.reasoning ?? '')
          : '';
      const baselineVisibleContent = baselineContent
        ? stripInternalAssistantTranscriptArtifacts(baselineContent)
        : '';
      const shouldResetPersistedContent = lastCommittedContent !== baselineVisibleContent;
      const shouldResetPersistedReasoning = lastCommittedReasoning !== baselineReasoning;

      accumulatedContent = baselineContent;
      accumulatedReasoning = baselineReasoning;
      lastCommittedContent = baselineVisibleContent;
      lastCommittedReasoning = baselineReasoning;
      lastPublishedContent = baselineVisibleContent;
      lastPublishedReasoning = baselineReasoning;
      lastDraftPublishedAt = null;
      cachedVisibleContentSource = baselineContent;
      cachedVisibleContent = baselineVisibleContent;

      params.actions.clearStreamingDraft(currentAssistantMessageId);

      if (shouldResetPersistedContent) {
        params.actions.updateMessage(currentAssistantMessageId, baselineVisibleContent);
      }
      if (shouldResetPersistedReasoning) {
        params.actions.updateMessageReasoning(currentAssistantMessageId, baselineReasoning);
      }
    },
  };
}
