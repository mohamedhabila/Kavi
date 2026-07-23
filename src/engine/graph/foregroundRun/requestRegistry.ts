export type ForegroundRequestHandle = {
  conversationId: string;
  requestId: string;
  controller: AbortController;
};

type ForegroundRequestEntry = ForegroundRequestHandle & {
  streamingMessageId: string | null;
};

export type ForegroundRequestRegistrySnapshot = {
  activeConversationIds: ReadonlySet<string>;
  streamingMessageIds: ReadonlyMap<string, string>;
  size: number;
  version: number;
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
  const listeners = new Set<() => void>();
  let version = 0;
  let snapshot: ForegroundRequestRegistrySnapshot = {
    activeConversationIds: new Set(),
    streamingMessageIds: new Map(),
    size: 0,
    version,
  };

  const publish = (): void => {
    version += 1;
    const activeConversationIds = new Set(requestsByConversation.keys());
    const streamingMessageIds = new Map<string, string>();
    for (const conversationId of activeConversationIds) {
      const messageId = requestsByConversation.get(conversationId)?.streamingMessageId;
      if (messageId) {
        streamingMessageIds.set(conversationId, messageId);
      }
    }
    snapshot = {
      activeConversationIds,
      streamingMessageIds,
      size: requestsByConversation.size,
      version,
    };
    for (const listener of listeners) {
      listener();
    }
  };

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
      publish();
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
      publish();
      return true;
    },
    clearForConversation: (conversationId: string): boolean => {
      const cleared = requestsByConversation.delete(conversationId);
      if (cleared) {
        publish();
      }
      return cleared;
    },
    setStreamingMessageId: (handle: ForegroundRequestHandle, messageId: string | null): boolean => {
      const current = requestsByConversation.get(handle.conversationId);
      if (!current || !isCurrent(handle)) {
        return false;
      }

      current.streamingMessageId = messageId;
      publish();
      return true;
    },
    getStreamingMessageId: (conversationId: string): string | null =>
      requestsByConversation.get(conversationId)?.streamingMessageId ?? null,
    hasConversation: (conversationId: string): boolean =>
      requestsByConversation.has(conversationId),
    getActiveConversationIds: (): ReadonlySet<string> => new Set(requestsByConversation.keys()),
    getSnapshot: (): ForegroundRequestRegistrySnapshot => snapshot,
    getVersion: (): number => version,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get size(): number {
      return requestsByConversation.size;
    },
    dispose: (reason?: unknown): void => {
      const hadRequests = requestsByConversation.size > 0;
      for (const request of requestsByConversation.values()) {
        abortController(request.controller, reason);
      }
      requestsByConversation.clear();
      if (hadRequests) {
        publish();
      }
    },
  };
}

export type ForegroundRequestRegistry = ReturnType<typeof createForegroundRequestRegistry>;

/**
 * Process-local authority for foreground model requests.
 *
 * Chat owns its lifecycle; other mounted surfaces may subscribe read-only so
 * they agree on whether a conversation is actually active.
 */
export const appForegroundRequestRegistry = createForegroundRequestRegistry();
