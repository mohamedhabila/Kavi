import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  buildStreamingDraftSignature,
  normalizeStreamingDraft,
  type StreamingDraft,
} from './chatScreenDisplayState';

export function useStreamingDrafts(): {
  clearStreamingDraft: (messageId: string) => void;
  mergeStreamingDraft: (messageId: string, patch: Partial<StreamingDraft>) => void;
  resetStreamingDrafts: () => void;
  streamingDraftSignaturesRef: MutableRefObject<Record<string, string>>;
  streamingDraftState: { version: number; drafts: Record<string, StreamingDraft> };
  streamingDraftsRef: MutableRefObject<Record<string, StreamingDraft>>;
  updateStreamingDraft: (
    messageId: string,
    updater: (currentDraft: StreamingDraft | undefined) => StreamingDraft | undefined,
  ) => void;
} {
  const [streamingDraftVersion, setStreamingDraftVersion] = useState(0);
  const streamingDraftsRef = useRef<Record<string, StreamingDraft>>({});
  const streamingDraftSignaturesRef = useRef<Record<string, string>>({});

  const updateStreamingDraft = useCallback(
    (
      messageId: string,
      updater: (currentDraft: StreamingDraft | undefined) => StreamingDraft | undefined,
    ) => {
      const currentDraft = streamingDraftsRef.current[messageId];
      const nextDraft = normalizeStreamingDraft(updater(currentDraft));
      const currentSignature =
        streamingDraftSignaturesRef.current[messageId] ??
        buildStreamingDraftSignature(currentDraft);
      const nextSignature = buildStreamingDraftSignature(nextDraft);
      if (currentSignature === nextSignature) {
        return;
      }

      const nextDrafts = { ...streamingDraftsRef.current };
      const nextSignatures = { ...streamingDraftSignaturesRef.current };
      if (nextDraft) {
        nextDrafts[messageId] = nextDraft;
        nextSignatures[messageId] = nextSignature;
      } else {
        delete nextDrafts[messageId];
        delete nextSignatures[messageId];
      }

      streamingDraftsRef.current = nextDrafts;
      streamingDraftSignaturesRef.current = nextSignatures;
      setStreamingDraftVersion((value) => value + 1);
    },
    [],
  );

  const mergeStreamingDraft = useCallback(
    (messageId: string, patch: Partial<StreamingDraft>) => {
      updateStreamingDraft(messageId, (currentDraft) => ({
        ...(currentDraft ?? {}),
        ...patch,
      }));
    },
    [updateStreamingDraft],
  );

  const clearStreamingDraft = useCallback(
    (messageId: string) => {
      if (!streamingDraftsRef.current[messageId]) return;
      updateStreamingDraft(messageId, () => undefined);
    },
    [updateStreamingDraft],
  );

  const resetStreamingDrafts = useCallback(() => {
    streamingDraftsRef.current = {};
    streamingDraftSignaturesRef.current = {};
    setStreamingDraftVersion(0);
  }, []);

  const streamingDraftState = useMemo(
    () => ({ version: streamingDraftVersion, drafts: streamingDraftsRef.current }),
    [streamingDraftVersion],
  );

  return {
    clearStreamingDraft,
    mergeStreamingDraft,
    resetStreamingDrafts,
    streamingDraftSignaturesRef,
    streamingDraftState,
    streamingDraftsRef,
    updateStreamingDraft,
  };
}
