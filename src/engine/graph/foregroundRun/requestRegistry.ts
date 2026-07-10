export type ForegroundRequestHandle = {
  conversationId: string;
  requestId: string;
  controller: AbortController;
};

type ForegroundRequestEntry = ForegroundRequestHandle & {
  streamingMessageId: string | null;
};

const SUPERSEDED_REQUEST_REASON = 'Superseded by another foreground request.';

function assertRequestIdentity(handle: ForegroundRequestHandle): void {
  if (!handle.conversationId.trim()) {
    throw new Error('Foreground request conversationId must not be empty.');
  }
  if (!handle.requestId.trim()) {
    throw new Error('Foreground request requestId must not be empty.');
  }
}

function abortController(controller: AbortController, reason?: unknown): void {
  if (!controller.signal.aborted) {
    controller.abort(reason);
  }
}

export function createForegroundRequestRegistry() {
  const requestsByConversation = new Map<string, ForegroundRequestEntry>();

  const isCurrent = (handle: ForegroundRequestHandle): boolean => {
    const current = requestsByConversation.get(handle.conversationId);
    return current?.requestId === handle.requestId && current.controller === handle.controller;
  };

  return {
    register: (handle: ForegroundRequestHandle): void => {
      assertRequestIdentity(handle);
      const current = requestsByConversation.get(handle.conversationId);
      if (current && !isCurrent(handle)) {
        abortController(current.controller, SUPERSEDED_REQUEST_REASON);
      }

      requestsByConversation.set(handle.conversationId, {
        ...handle,
        streamingMessageId: null,
      });
    },
    isCurrent,
    abort: (handle: ForegroundRequestHandle, reason?: unknown): boolean => {
      if (!isCurrent(handle)) {
        return false;
      }

      abortController(handle.controller, reason);
      return true;
    },
    abortForConversation: (conversationId: string, reason?: unknown): boolean => {
      const current = requestsByConversation.get(conversationId);
      if (!current) {
        return false;
      }

      abortController(current.controller, reason);
      return true;
    },
    clear: (handle: ForegroundRequestHandle): boolean => {
      if (!isCurrent(handle)) {
        return false;
      }

      requestsByConversation.delete(handle.conversationId);
      return true;
    },
    clearForConversation: (conversationId: string): boolean =>
      requestsByConversation.delete(conversationId),
    setStreamingMessageId: (handle: ForegroundRequestHandle, messageId: string | null): boolean => {
      const current = requestsByConversation.get(handle.conversationId);
      if (!current || !isCurrent(handle)) {
        return false;
      }

      current.streamingMessageId = messageId;
      return true;
    },
    getStreamingMessageId: (conversationId: string): string | null =>
      requestsByConversation.get(conversationId)?.streamingMessageId ?? null,
    hasConversation: (conversationId: string): boolean =>
      requestsByConversation.has(conversationId),
    getActiveConversationIds: (): ReadonlySet<string> => new Set(requestsByConversation.keys()),
    get size(): number {
      return requestsByConversation.size;
    },
    dispose: (reason?: unknown): void => {
      for (const request of requestsByConversation.values()) {
        abortController(request.controller, reason);
      }
      requestsByConversation.clear();
    },
  };
}

export type ForegroundRequestRegistry = ReturnType<typeof createForegroundRequestRegistry>;
