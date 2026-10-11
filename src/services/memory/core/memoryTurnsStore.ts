// ---------------------------------------------------------------------------
// Kavi — Past turns
// ---------------------------------------------------------------------------
// Every closed turn (a user message and the reply to it) is indexed as it is, with no model
// call, so an earlier conversation can be recalled even when background extraction has not
// run, is disabled, or skipped it. Round-level values are what LongMemEval found best for
// recalling past conversations; summaries or extracted facts as values did worse.
// Turns follow the memory item rules: one carrying a credential is never indexed, and one
// carrying personal data (an email, phone number, card…) is returned only by an explicit
// search, never placed in the prompt automatically.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import type { Message } from '../../../types/message';
import { getMemoryDb } from '../database';
import { findTurnOpeningUserIndex, isSteeringUserMessage } from '../../../utils/steeringMessages';
import { classifyStructuredMemoryText } from '../memorySensitivityValidators';
import { buildMemoryMatchExpression } from './memoryItemsQuery';
import { ensureMemoryCoreSchema, MEMORY_TURN_TEXT_MAX_CHARS } from './memorySchema';
import { boundMemoryText } from './memoryText';

export interface MemoryTurn {
  userMessageId: string;
  conversationId: string;
  at: number;
  text: string;
  sensitive: boolean;
}

interface MemoryTurnRow {
  user_message_id: string;
  conversation_id: string;
  at: number;
  text: string;
  sensitive: number;
}

function readyDb(): SQLite.SQLiteDatabase {
  const db = getMemoryDb();
  ensureMemoryCoreSchema(db);
  return db;
}

function rowToTurn(row: MemoryTurnRow): MemoryTurn {
  return {
    userMessageId: row.user_message_id,
    conversationId: row.conversation_id,
    at: row.at,
    text: row.text,
    sensitive: row.sensitive === 1,
  };
}

/**
 * Indexes (or re-indexes) the round opened by `userMessageId`. Returns false when the round
 * is empty or carries a credential; a re-indexed round that now carries one is removed.
 */
export function indexMemoryTurn(params: {
  conversationId: string;
  userMessageId: string;
  userText: string;
  replyText: string;
  at: number;
}): boolean {
  const user = params.userText.trim();
  const reply = params.replyText.trim();
  if (!user && !reply) return false;
  const text = boundMemoryText(
    [user && `User: ${user}`, reply && `Assistant: ${reply}`].filter(Boolean).join('\n'),
    MEMORY_TURN_TEXT_MAX_CHARS,
  );
  const sensitivity = classifyStructuredMemoryText(text);
  const db = readyDb();
  if (sensitivity === 'restricted') {
    db.runSync('DELETE FROM memory_turns WHERE user_message_id = ?', params.userMessageId);
    return false;
  }
  db.runSync(
    `INSERT INTO memory_turns (user_message_id, conversation_id, at, text, sensitive)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_message_id) DO UPDATE SET
         text = excluded.text, at = excluded.at, sensitive = excluded.sensitive`,
    params.userMessageId,
    params.conversationId,
    params.at,
    text,
    sensitivity === 'sensitive' ? 1 : 0,
  );
  return true;
}

/**
 * Indexes the round a turn just closed: the reply `replyMessageId`, the user message that
 * opened its turn and the messages that steered it while it ran.
 */
export function indexClosedTurn(params: {
  conversationId: string;
  messages: ReadonlyArray<Pick<Message, 'id' | 'role' | 'content' | 'timestamp' | 'steerOfRunId'>>;
  replyMessageId: string;
}): boolean {
  const replyIndex = params.messages.findIndex((message) => message.id === params.replyMessageId);
  if (replyIndex < 0) return false;
  const openingIndex = findTurnOpeningUserIndex(params.messages, replyIndex);
  if (openingIndex < 0) return false;
  const userText = params.messages
    .slice(openingIndex, replyIndex)
    .filter((message, offset) => offset === 0 || isSteeringUserMessage(message))
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n');
  const reply = params.messages[replyIndex]!;
  return indexMemoryTurn({
    conversationId: params.conversationId,
    userMessageId: params.messages[openingIndex]!.id,
    userText,
    replyText: reply.content,
    at: reply.timestamp,
  });
}

/**
 * Past turns matching `query`, best first. `excludeConversationId` skips one conversation;
 * sensitive turns are returned only with `includeSensitive`.
 */
export function searchMemoryTurns(params: {
  query: string;
  limit: number;
  includeSensitive: boolean;
  excludeConversationId?: string;
}): MemoryTurn[] {
  const match = buildMemoryMatchExpression(params.query);
  if (!match || params.limit <= 0) return [];
  return readyDb()
    .getAllSync<MemoryTurnRow>(
      `SELECT t.user_message_id, t.conversation_id, t.at, t.text, t.sensitive
         FROM memory_turns_fts f
         JOIN memory_turns t ON t.rowid = f.rowid
        WHERE memory_turns_fts MATCH ?
          AND (? IS NULL OR t.conversation_id <> ?)
          AND (? = 1 OR t.sensitive = 0)
        ORDER BY bm25(memory_turns_fts), t.at DESC
        LIMIT ?`,
      match,
      params.excludeConversationId ?? null,
      params.excludeConversationId ?? null,
      params.includeSensitive ? 1 : 0,
      params.limit,
    )
    .map(rowToTurn);
}

export function deleteMemoryTurnsFromConversation(conversationId: string): number {
  return readyDb().runSync('DELETE FROM memory_turns WHERE conversation_id = ?', conversationId)
    .changes;
}

export function deleteAllMemoryTurns(): void {
  readyDb().runSync('DELETE FROM memory_turns');
}
