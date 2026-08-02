import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { appForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';

type UseForegroundRequestParams = {
  setLoading: (isLoading: boolean) => void;
};

export function useForegroundRequest({ setLoading }: UseForegroundRequestParams): {
  activeForegroundConversationIds: ReadonlySet<string>;
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  clearForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  clearForegroundRequestForConversation: (conversationId: string) => boolean;
  foregroundStreamingMessageIds: ReadonlyMap<string, string>;
  isCurrentForegroundRequest: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  registerForegroundRequest: (
    requestId: string,
    conversationId: string,
    abortController: AbortController,
  ) => void;
  setForegroundRequestStreamingMessageId: (
    conversationId: string,
    requestId: string,
    abortController: AbortController,
    messageId: string | null,
  ) => boolean;
} {
  const registry = appForegroundRequestRegistry;
  const registrySnapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const activeForegroundConversationIds = registrySnapshot.activeConversationIds;
  const foregroundStreamingMessageIds = registrySnapshot.streamingMessageIds;

  useEffect(() => {
    setLoading(registrySnapshot.size > 0);
  }, [registrySnapshot.size, setLoading]);

  const registerForegroundRequest = useCallback(
    (requestId: string, conversationId: string, abortController: AbortController) => {
      registry.register({
        requestId,
        conversationId,
        controller: abortController,
      });
    },
    [registry],
  );

  const isCurrentForegroundRequest = useCallback(
    (conversationId: string, requestId: string, abortController: AbortController) =>
      registry.isCurrent({
        conversationId,
        requestId,
        controller: abortController,
      }),
    [registry],
  );

  const clearForegroundRequest = useCallback(
    (conversationId: string, requestId: string, abortController: AbortController) => {
      const cleared = registry.clear({
        conversationId,
        requestId,
        controller: abortController,
      });
      if (!cleared) {
        return false;
      }

      return true;
    },
    [registry],
  );

  const abortForegroundRequestForConversation = useCallback(
    (conversationId: string, reason?: string) =>
      registry.abortForConversation(conversationId, reason),
    [registry],
  );

  const clearForegroundRequestForConversation = useCallback(
    (conversationId: string) => {
      if (!registry.clearForConversation(conversationId)) {
        return false;
      }

      return true;
    },
    [registry],
  );

  const setForegroundRequestStreamingMessageId = useCallback(
    (
      conversationId: string,
      requestId: string,
      abortController: AbortController,
      messageId: string | null,
    ) => {
      const updated = registry.setStreamingMessageId(
        { conversationId, requestId, controller: abortController },
        messageId,
      );
      return updated;
    },
    [registry],
  );

  return {
    activeForegroundConversationIds,
    abortForegroundRequestForConversation,
    clearForegroundRequest,
    clearForegroundRequestForConversation,
    foregroundStreamingMessageIds,
    isCurrentForegroundRequest,
    registerForegroundRequest,
    setForegroundRequestStreamingMessageId,
  };
}
