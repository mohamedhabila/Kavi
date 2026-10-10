import type { Message } from '../../types/message';
import { createLogger } from '../../utils/logger';
import { getTranscriptArchiveDb } from './database';

const logger = createLogger('TranscriptArchive');

/**
 * Conversation history that has left the persisted hot window.
 *
 * The chat store persists a bounded window of recent messages per conversation so each
 * commit stays small. Messages outside it used to be dropped at save time, so a person who
 * keeps one conversation lost everything older than the window after a restart — about 80
 * requests of history. They are archived here, in the form they had when they left the
 * window, and paged back into the transcript when the person scrolls up.
 *
 * Archived messages are for reading only. They are never sent to a model: what the
 * assistant needs from older turns reaches it through compaction and long-term memory.
 */

type ArchiveRow = {
  archive_seq: number;
  message_id: string;
  timestamp: number;
  payload: string;
};

export type TranscriptArchiveCursor = Readonly<{ timestamp: number; sequence: number }>;

export type TranscriptArchivePage = Readonly<{
  /** Oldest first, ready to display above the messages already shown. */
  messages: Message[];
  /** Where the next, older page starts; null once the archive is exhausted. */
  nextCursor: TranscriptArchiveCursor | null;
}>;

/** Rows read per query while filling a page; bounds work per page load. */
const PAGE_SCAN_BATCH = 64;
const MAX_PAGE_SCAN_BATCHES = 8;

const pendingByConversation = new Map<string, Map<string, Message>>();
const archivedOrQueuedIds = new Map<string, Set<string>>();
const listeners = new Set<(conversationId: string) => void>();

function idsFor(conversationId: string): Set<string> {
  let ids = archivedOrQueuedIds.get(conversationId);
  if (!ids) {
    ids = new Set();
    archivedOrQueuedIds.set(conversationId, ids);
  }
  return ids;
}

/**
 * Queue messages that have just left a conversation's persisted window. They are written
 * by {@link drainPendingTranscriptArchive}, which runs before the commit that omits them.
 */
export function noteEvictedMessages(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): void {
  if (messages.length === 0) return;
  const known = idsFor(conversationId);
  let pending = pendingByConversation.get(conversationId);
  for (const message of messages) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    if (!pending) {
      pending = new Map();
      pendingByConversation.set(conversationId, pending);
    }
    pending.set(message.id, message);
  }
}

/** Whether a message is already archived or queued, so callers skip re-sanitizing it. */
export function isMessageArchivedOrQueued(conversationId: string, messageId: string): boolean {
  return archivedOrQueuedIds.get(conversationId)?.has(messageId) ?? false;
}

/**
 * Write every queued message, in one transaction. Runs synchronously right before the chat
 * store commits a generation without them, so a crash between the two leaves them in the
 * prior generation and they are archived again on the next save.
 *
 * A failed write keeps the queue: the commit still proceeds (the messages remain in memory
 * for this session) and the next commit retries.
 */
export function drainPendingTranscriptArchive(now: number = Date.now()): void {
  if (pendingByConversation.size === 0) return;
  const batches = Array.from(pendingByConversation.entries());
  let db: ReturnType<typeof getTranscriptArchiveDb>;
  try {
    db = getTranscriptArchiveDb();
    db.execSync('BEGIN');
    try {
      for (const [conversationId, messages] of batches) {
        for (const message of messages.values()) {
          db.runSync(
            `INSERT OR IGNORE INTO archived_messages
               (conversation_id, message_id, timestamp, payload, archived_at)
             VALUES (?, ?, ?, ?, ?)`,
            conversationId,
            message.id,
            Number.isFinite(message.timestamp) ? Math.floor(message.timestamp) : now,
            JSON.stringify(message),
            now,
          );
        }
      }
      db.execSync('COMMIT');
    } catch (error) {
      db.execSync('ROLLBACK');
      throw error;
    }
  } catch (error: unknown) {
    logger.warn('Could not archive conversation history; keeping it queued for the next save.', {
      conversations: batches.length,
      messages: batches.reduce((count, [, messages]) => count + messages.size, 0),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  pendingByConversation.clear();
  for (const [conversationId] of batches) {
    for (const listener of listeners) listener(conversationId);
  }
}

function parseArchivedMessage(row: ArchiveRow): Message | null {
  try {
    const message = JSON.parse(row.payload) as Message;
    if (
      !message ||
      typeof message !== 'object' ||
      message.id !== row.message_id ||
      (message.role !== 'user' &&
        message.role !== 'assistant' &&
        message.role !== 'tool' &&
        message.role !== 'system')
    ) {
      throw new Error('archived_message_shape_invalid');
    }
    return message;
  } catch (error: unknown) {
    logger.warn('Skipping an archived message that could not be read.', {
      messageId: row.message_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Archived messages of a conversation that are not among `excludeIds`. */
export function countArchivedMessages(
  conversationId: string,
  excludeIds: ReadonlySet<string> = new Set(),
): number {
  const db = getTranscriptArchiveDb();
  if (excludeIds.size === 0) {
    return (
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM archived_messages WHERE conversation_id = ?',
        conversationId,
      )?.count ?? 0
    );
  }
  const ids = db.getAllSync<{ message_id: string }>(
    'SELECT message_id FROM archived_messages WHERE conversation_id = ?',
    conversationId,
  );
  return ids.filter((row) => !excludeIds.has(row.message_id)).length;
}

/**
 * The next older page of archived history. Messages still held in memory (`excludeIds`) are
 * skipped, so a long session that already shows them does not show them twice.
 */
export function loadArchivedMessagesPage(params: {
  conversationId: string;
  before?: TranscriptArchiveCursor | null;
  limit: number;
  excludeIds?: ReadonlySet<string>;
}): TranscriptArchivePage {
  const db = getTranscriptArchiveDb();
  const limit = Math.max(1, Math.floor(params.limit));
  const excludeIds = params.excludeIds ?? new Set<string>();
  const collected: Message[] = [];
  let cursor = params.before ?? null;

  for (let batch = 0; batch < MAX_PAGE_SCAN_BATCHES && collected.length < limit; batch += 1) {
    const rows = cursor
      ? db.getAllSync<ArchiveRow>(
          `SELECT archive_seq, message_id, timestamp, payload FROM archived_messages
            WHERE conversation_id = ? AND (timestamp < ? OR (timestamp = ? AND archive_seq < ?))
            ORDER BY timestamp DESC, archive_seq DESC LIMIT ?`,
          params.conversationId,
          cursor.timestamp,
          cursor.timestamp,
          cursor.sequence,
          PAGE_SCAN_BATCH,
        )
      : db.getAllSync<ArchiveRow>(
          `SELECT archive_seq, message_id, timestamp, payload FROM archived_messages
            WHERE conversation_id = ?
            ORDER BY timestamp DESC, archive_seq DESC LIMIT ?`,
          params.conversationId,
          PAGE_SCAN_BATCH,
        );
    if (rows.length === 0) {
      return { messages: collected.reverse(), nextCursor: null };
    }
    for (const row of rows) {
      cursor = { timestamp: row.timestamp, sequence: row.archive_seq };
      if (excludeIds.has(row.message_id)) continue;
      const message = parseArchivedMessage(row);
      if (message) collected.push(message);
      if (collected.length >= limit) break;
    }
    if (rows.length < PAGE_SCAN_BATCH && collected.length < limit) {
      return { messages: collected.reverse(), nextCursor: null };
    }
  }

  return { messages: collected.reverse(), nextCursor: cursor };
}

/** Rows read per page while collecting a whole conversation's archived history. */
const EXPORT_PAGE_SIZE = 500;

/** Every archived message of a conversation not among `excludeIds`, oldest first. */
export function loadAllArchivedMessages(
  conversationId: string,
  excludeIds: ReadonlySet<string> = new Set(),
): Message[] {
  const pages: Message[][] = [];
  let cursor: TranscriptArchiveCursor | null = null;
  do {
    const page = loadArchivedMessagesPage({
      conversationId,
      before: cursor,
      limit: EXPORT_PAGE_SIZE,
      excludeIds,
    });
    pages.unshift(page.messages);
    cursor = page.nextCursor;
  } while (cursor);
  return pages.flat();
}

function forgetConversation(conversationId: string): void {
  pendingByConversation.delete(conversationId);
  archivedOrQueuedIds.delete(conversationId);
}

/** Remove a deleted conversation's archived history. */
export function deleteArchivedConversation(conversationId: string): void {
  forgetConversation(conversationId);
  getTranscriptArchiveDb().runSync(
    'DELETE FROM archived_messages WHERE conversation_id = ?',
    conversationId,
  );
  for (const listener of listeners) listener(conversationId);
}

/** Remove all archived history, as part of clearing every conversation. */
export function deleteAllArchivedMessages(): void {
  const conversationIds = Array.from(archivedOrQueuedIds.keys());
  pendingByConversation.clear();
  archivedOrQueuedIds.clear();
  getTranscriptArchiveDb().runSync('DELETE FROM archived_messages');
  for (const conversationId of conversationIds) {
    for (const listener of listeners) listener(conversationId);
  }
}

/** Remove archived history whose conversation no longer exists. */
export function purgeArchivedConversationsExcept(liveConversationIds: ReadonlySet<string>): number {
  const db = getTranscriptArchiveDb();
  const archived = db.getAllSync<{ conversation_id: string }>(
    'SELECT DISTINCT conversation_id FROM archived_messages',
  );
  let purged = 0;
  for (const { conversation_id: conversationId } of archived) {
    if (liveConversationIds.has(conversationId)) continue;
    forgetConversation(conversationId);
    db.runSync('DELETE FROM archived_messages WHERE conversation_id = ?', conversationId);
    purged += 1;
  }
  return purged;
}

export function subscribeToTranscriptArchive(
  listener: (conversationId: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Visible for testing only. */
export function _resetTranscriptArchiveStateForTests(): void {
  pendingByConversation.clear();
  archivedOrQueuedIds.clear();
  listeners.clear();
}
