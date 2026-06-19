import { useCallback, useRef, useState, type MutableRefObject } from 'react';

type ForegroundRequest = {
  requestId: string;
  conversationId: string;
  abort: AbortController;
};

type UseForegroundRequestParams = {
  setLoading: (isLoading: boolean) => void;
  setStreamingMessageId: (messageId: string | null) => void;
};

export function useForegroundRequest({
  setLoading,
  setStreamingMessageId,
}: UseForegroundRequestParams): {
  abortForegroundRequestForConversation: (conversationId: string, reason?: string) => boolean;
  abortRef: MutableRefObject<AbortController | null>;
  clearForegroundRequest: (requestId: string, abortController: AbortController) => boolean;
  clearForegroundRequestForConversation: (conversationId: string) => boolean;
  foregroundRequestConversationId: string | null;
  isCurrentForegroundRequest: (
    requestId: string,
    abortController: AbortController,
  ) => boolean;
  registerForegroundRequest: (
    requestId: string,
    conversationId: string,
    abortController: AbortController,
  ) => void;
} {
  const abortRef = useRef<AbortController | null>(null);
  const foregroundRequestRef = useRef<ForegroundRequest | null>(null);
  const [foregroundRequestConversationId, setForegroundRequestConversationId] = useState<
    string | null
  >(null);

  const registerForegroundRequest = useCallback(
    (requestId: string, conversationId: string, abortController: AbortController) => {
      foregroundRequestRef.current = {
        requestId,
        conversationId,
        abort: abortController,
      };
      abortRef.current = abortController;
      setForegroundRequestConversationId(conversationId);
      setLoading(true);
    },
    [setLoading],
  );

  const isCurrentForegroundRequest = useCallback(
    (requestId: string, abortController: AbortController) => {
      const currentRequest = foregroundRequestRef.current;
      return (
        !!currentRequest &&
        currentRequest.requestId === requestId &&
        currentRequest.abort === abortController
      );
    },
    [],
  );

  const clearForegroundRequest = useCallback(
    (requestId: string, abortController: AbortController) => {
      if (!isCurrentForegroundRequest(requestId, abortController)) {
        return false;
      }

      foregroundRequestRef.current = null;
      abortRef.current = null;
      setForegroundRequestConversationId(null);
      setStreamingMessageId(null);
      setLoading(false);
      return true;
    },
    [isCurrentForegroundRequest, setLoading, setStreamingMessageId],
  );

  const abortForegroundRequestForConversation = useCallback(
    (conversationId: string, reason?: string) => {
      const currentRequest = foregroundRequestRef.current;
      if (!currentRequest || currentRequest.conversationId !== conversationId) {
        return false;
      }

      if (!currentRequest.abort.signal.aborted) {
        currentRequest.abort.abort(reason);
      }

      return true;
    },
    [],
  );

  const clearForegroundRequestForConversation = useCallback(
    (conversationId: string) => {
      const currentRequest = foregroundRequestRef.current;
      if (!currentRequest || currentRequest.conversationId !== conversationId) {
        return false;
      }

      return clearForegroundRequest(currentRequest.requestId, currentRequest.abort);
    },
    [clearForegroundRequest],
  );

  return {
    abortForegroundRequestForConversation,
    abortRef,
    clearForegroundRequest,
    clearForegroundRequestForConversation,
    foregroundRequestConversationId,
    isCurrentForegroundRequest,
    registerForegroundRequest,
  };
}
