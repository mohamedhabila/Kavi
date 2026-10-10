import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  countArchivedMessages,
  loadArchivedMessagesPage,
  subscribeToTranscriptArchive,
  type TranscriptArchiveCursor,
} from '../../services/transcriptArchive/transcriptArchive';
import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ArchivedTranscript');

/** Archived messages loaded per "show earlier" press. */
export const ARCHIVED_TRANSCRIPT_PAGE_SIZE = 40;

type LoadedArchive = Readonly<{
  conversationId: string | null;
  messages: Message[];
  cursor: TranscriptArchiveCursor | null;
  exhausted: boolean;
}>;

const EMPTY_ARCHIVE: LoadedArchive = {
  conversationId: null,
  messages: [],
  cursor: null,
  exhausted: false,
};

export type ArchivedTranscript = Readonly<{
  /** Older history loaded so far, oldest first; never part of model context. */
  messages: Message[];
  /** Archived messages not yet shown. */
  remainingCount: number;
  loadEarlier: () => void;
}>;

/**
 * Older history of the active conversation that has left the persisted window, paged in
 * as the person scrolls back. Messages still held in memory are never shown twice.
 */
export function useArchivedTranscript(
  conversationId: string | null,
  inMemoryMessages: ReadonlyArray<Message>,
): ArchivedTranscript {
  const [loaded, setLoaded] = useState<LoadedArchive>(EMPTY_ARCHIVE);
  const [remainingCount, setRemainingCount] = useState(0);
  const archive = loaded.conversationId === conversationId ? loaded : EMPTY_ARCHIVE;

  // Read at query time rather than as a dependency: messages change on every streamed
  // token, and the count only changes when history is archived or a page is loaded.
  const shownIdsRef = useRef<ReadonlySet<string>>(new Set());
  shownIdsRef.current = useMemo(
    () =>
      new Set([
        ...inMemoryMessages.map((message) => message.id),
        ...archive.messages.map((message) => message.id),
      ]),
    [archive.messages, inMemoryMessages],
  );

  const recount = useCallback(() => {
    if (!conversationId) {
      setRemainingCount(0);
      return;
    }
    try {
      setRemainingCount(countArchivedMessages(conversationId, shownIdsRef.current));
    } catch (error: unknown) {
      logger.warn('Could not count archived history.', {
        error: error instanceof Error ? error.message : String(error),
      });
      setRemainingCount(0);
    }
  }, [conversationId]);

  useEffect(() => {
    recount();
    return subscribeToTranscriptArchive((changedConversationId) => {
      if (changedConversationId === conversationId) recount();
    });
  }, [conversationId, recount]);

  const loadEarlier = useCallback(() => {
    if (!conversationId || archive.exhausted) return;
    try {
      const page = loadArchivedMessagesPage({
        conversationId,
        before: archive.cursor,
        limit: ARCHIVED_TRANSCRIPT_PAGE_SIZE,
        excludeIds: shownIdsRef.current,
      });
      setLoaded({
        conversationId,
        messages: [...page.messages, ...archive.messages],
        cursor: page.nextCursor,
        exhausted: page.nextCursor === null,
      });
      setRemainingCount((count) => Math.max(0, count - page.messages.length));
    } catch (error: unknown) {
      logger.warn('Could not load archived history.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [archive, conversationId]);

  return {
    messages: archive.messages,
    remainingCount: archive.exhausted ? 0 : remainingCount,
    loadEarlier,
  };
}
