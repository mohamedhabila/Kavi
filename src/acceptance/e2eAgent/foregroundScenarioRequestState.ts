// ---------------------------------------------------------------------------
// Kavi — Foreground scenario request and streaming state
// ---------------------------------------------------------------------------
// The scenario driver's stand-ins for the chat screen's foreground request registry
// and streaming drafts, so acceptance runs register, abort and clear foreground
// requests exactly as the screen does.
// ---------------------------------------------------------------------------

import type { ForegroundStreamingDraft } from '../../engine/graph/foregroundRun/executionTypes';
import { createForegroundRequestRegistry } from '../../engine/graph/foregroundRun/requestRegistry';
import { useChatStore } from '../../store/useChatStore';

export function createForegroundScenarioRequestRegistry() {
  const registry = createForegroundRequestRegistry();
  const pendingAbortReasons = new Map<string, string | undefined>();

  return {
    /** Which run is active, for routing a message sent during it to that run. */
    getRequestId: registry.getRequestId,
    subscribe: registry.subscribe,
    abortForegroundRequestForConversation: (conversationId: string, reason?: string) =>
      registry.abortForConversation(conversationId, reason),
    abortCurrentOrNextForegroundRequest: (conversationId: string, reason?: string) => {
      if (!registry.abortForConversation(conversationId, reason)) {
        pendingAbortReasons.set(conversationId, reason);
      }
    },
    clearForegroundRequest: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
    ) => {
      if (!registry.clear({ conversationId, requestId, controller })) return false;
      pendingAbortReasons.delete(conversationId);
      useChatStore.getState().setLoading(registry.size > 0);
      return true;
    },
    isCurrentForegroundRequest: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
    ) => registry.isCurrent({ conversationId, requestId, controller }),
    registerForegroundRequest: (
      requestId: string,
      conversationId: string,
      controller: AbortController,
    ) => {
      registry.register({ conversationId, requestId, controller });
      useChatStore.getState().setLoading(registry.size > 0);
      if (pendingAbortReasons.has(conversationId)) {
        registry.abort(
          { conversationId, requestId, controller },
          pendingAbortReasons.get(conversationId),
        );
        pendingAbortReasons.delete(conversationId);
      }
    },
    setStreamingMessageId: (
      conversationId: string,
      requestId: string,
      controller: AbortController,
      messageId: string | null,
    ) => registry.setStreamingMessageId({ conversationId, requestId, controller }, messageId),
  };
}

export function createForegroundScenarioStreamingState() {
  const drafts: Record<string, ForegroundStreamingDraft | undefined> = {};
  return {
    drafts,
    clearStreamingDraft: (messageId: string) => {
      delete drafts[messageId];
    },
    mergeStreamingDraft: (messageId: string, patch: Partial<ForegroundStreamingDraft>) => {
      drafts[messageId] = { ...(drafts[messageId] ?? {}), ...patch };
    },
    updateStreamingDraft: (
      messageId: string,
      updater: (
        currentDraft: ForegroundStreamingDraft | undefined,
      ) => ForegroundStreamingDraft | undefined,
    ) => {
      const next = updater(drafts[messageId]);
      if (next) drafts[messageId] = next;
      else delete drafts[messageId];
    },
  };
}
