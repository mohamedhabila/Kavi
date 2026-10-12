// ---------------------------------------------------------------------------
// Kavi — Past turns
// ---------------------------------------------------------------------------
// Every closed turn (a user message and the reply to it) is indexed as it is, with no model
// call, so an earlier conversation can be recalled even when background extraction has not
// run, is disabled, or skipped it. Round-level values are what LongMemEval found best for
// recalling past conversations; summaries or extracted facts as values did worse.
// Background extraction reads its rounds from here too, so a round still reaches it after
// leaving the thread's live messages.
// Turns follow the memory item rules: one carrying a credential is never indexed, and one
// carrying personal data (an email, phone number, card…) is returned only by an explicit
// search, never placed in the prompt automatically.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import type { Message, ToolCall } from '../../../types/message';
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
  /** What the user said in the round, without the reply. */
  userText: string;
  sensitive: boolean;
  /** The assistant saved or forgot a memory itself in this round. */
  managesMemory: boolean;
}

interface MemoryTurnRow {
  user_message_id: string;
  conversation_id: string;
  at: number;
  text: string;
  user_text: string;
  sensitive: number;
  manages_memory: number;
}

const TURN_COLUMNS =
  'user_message_id, conversation_id, at, text, user_text, sensitive, manages_memory';

/**
 * Tools through which the assistant itself decides what a round leaves in memory. Extraction
 * leaves such a round alone: one writer per round, so it cannot rewrite or duplicate what the
 * assistant just saved or forgot.
 */
const MEMORY_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(['memory_remember', 'memory_forget']);

type TurnMessage = Pick<Message, 'id' | 'role' | 'content' | 'timestamp' | 'steerOfRunId'> & {
  toolCalls?: ReadonlyArray<Pick<ToolCall, 'name'>>;
};

function writesMemory(message: TurnMessage): boolean {
  return (
    message.role === 'assistant' &&
    (message.toolCalls ?? []).some((call) => MEMORY_WRITE_TOOL_NAMES.has(call.name))
  );
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
    userText: row.user_text,
    sensitive: row.sensitive === 1,
    managesMemory: row.manages_memory === 1,
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
  managesMemory?: boolean;
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
    `INSERT INTO memory_turns (${TURN_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_message_id) DO UPDATE SET
         text = excluded.text, user_text = excluded.user_text, at = excluded.at,
         sensitive = excluded.sensitive, manages_memory = excluded.manages_memory`,
    params.userMessageId,
    params.conversationId,
    params.at,
    text,
    boundMemoryText(user, MEMORY_TURN_TEXT_MAX_CHARS),
    sensitivity === 'sensitive' ? 1 : 0,
    params.managesMemory ? 1 : 0,
  );
  return true;
}

/**
 * Indexes the round a turn just closed: the reply `replyMessageId`, the user message that
 * opened its turn and the messages that steered it while it ran.
 */
export function indexClosedTurn(params: {
  conversationId: string;
  messages: ReadonlyArray<TurnMessage>;
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
    managesMemory: params.messages.slice(openingIndex, replyIndex + 1).some(writesMemory),
  });
}

/** Up to `limit` of the conversation's turns closed after `afterAt`, oldest first. */
export function listMemoryTurnsAfter(
  params: { conversationId: string; afterAt: number; limit: number },
  db: SQLite.SQLiteDatabase = readyDb(),
): MemoryTurn[] {
  return db
    .getAllSync<MemoryTurnRow>(
      `SELECT ${TURN_COLUMNS} FROM memory_turns
        WHERE conversation_id = ? AND at > ?
        ORDER BY at, user_message_id
        LIMIT ?`,
      params.conversationId,
      params.afterAt,
      params.limit,
    )
    .map(rowToTurn);
}

/**
 * Past turns matching `query`, best first. `excludeUserMessageIds` leaves out the rounds those
 * user messages opened; sensitive turns are returned only with `includeSensitive`.
 */
export function searchMemoryTurns(params: {
  query: string;
  limit: number;
  includeSensitive: boolean;
  excludeUserMessageIds?: ReadonlyArray<string>;
}): MemoryTurn[] {
  const match = buildMemoryMatchExpression(params.query);
  if (!match || params.limit <= 0) return [];
  return readyDb()
    .getAllSync<MemoryTurnRow>(
      `SELECT t.user_message_id, t.conversation_id, t.at, t.text, t.user_text, t.sensitive,
              t.manages_memory
         FROM memory_turns_fts f
         JOIN memory_turns t ON t.rowid = f.rowid
        WHERE memory_turns_fts MATCH ?
          AND t.user_message_id NOT IN (SELECT value FROM json_each(?))
          AND (? = 1 OR t.sensitive = 0)
        ORDER BY bm25(memory_turns_fts), t.at DESC
        LIMIT ?`,
      match,
      JSON.stringify(params.excludeUserMessageIds ?? []),
      params.includeSensitive ? 1 : 0,
      params.limit,
    )
    .map(rowToTurn);
}

/** Removes the rounds opened by these user messages (they were rewound or deleted). */
export function deleteMemoryTurnsOpenedBy(userMessageIds: ReadonlyArray<string>): void {
  const db = readyDb();
  for (const id of userMessageIds) {
    db.runSync('DELETE FROM memory_turns WHERE user_message_id = ?', id);
  }
}

export function deleteMemoryTurnsFromConversation(conversationId: string): number {
  return readyDb().runSync('DELETE FROM memory_turns WHERE conversation_id = ?', conversationId)
    .changes;
}

export function deleteAllMemoryTurns(): void {
  readyDb().runSync('DELETE FROM memory_turns');
}
