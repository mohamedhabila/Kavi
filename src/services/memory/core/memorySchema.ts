// ---------------------------------------------------------------------------
// Kavi — Memory schema: items, past turns, extraction cursor
// ---------------------------------------------------------------------------
// Memory is a set of short free-text items in any language: what the user asked the
// assistant to remember, or what background extraction learned. This follows the shape
// production assistants converged on (ChatGPT saved memories, Claude memory topics, Letta
// core blocks, LangMem manage_memory): text, not subject/predicate/value triples.
//
// Search uses SQLite FTS5 with the trigram tokenizer. Trigrams index every language
// without a word segmenter (unicode61 does not segment Chinese, Japanese or Thai), and
// the bundled SQLite (3.50) is built with FTS5 on both platforms. The index is an
// external-content table kept in step with `memory_items` by triggers, so a write can
// never leave the two out of sync.
//
// Past turns are indexed per round (the user message and the reply to it), the
// granularity LongMemEval found best for recalling earlier conversations. The extraction
// cursor records, per conversation, the last message background extraction has read.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';
import { getMemoryDb } from '../database';

export const MEMORY_ITEM_TEXT_MAX_CHARS = 2_000;
export const MEMORY_TURN_TEXT_MAX_CHARS = 6_000;

let readyDb: SQLite.SQLiteDatabase | null = null;

export function ensureMemoryCoreSchema(db: SQLite.SQLiteDatabase = getMemoryDb()): void {
  if (readyDb === db) return;
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND ${MEMORY_ITEM_TEXT_MAX_CHARS}),
      scope TEXT NOT NULL CHECK(scope IN ('global', 'conversation')),
      conversation_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      sensitive INTEGER NOT NULL DEFAULT 0 CHECK(sensitive IN (0, 1)),
      source_conversation_id TEXT,
      source_message_id TEXT,
      superseded_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK((scope = 'conversation') = (conversation_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_current
      ON memory_items(superseded_by, pinned, updated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_items_conversation
      ON memory_items(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_memory_items_source_conversation
      ON memory_items(source_conversation_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
      text,
      content = 'memory_items',
      content_rowid = 'rowid',
      tokenize = 'trigram'
    );
    CREATE TRIGGER IF NOT EXISTS memory_items_fts_insert AFTER INSERT ON memory_items BEGIN
      INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_items_fts_delete AFTER DELETE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_items_fts_update AFTER UPDATE OF text ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TABLE IF NOT EXISTS memory_turns (
      user_message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND ${MEMORY_TURN_TEXT_MAX_CHARS})
    );
    CREATE INDEX IF NOT EXISTS idx_memory_turns_conversation
      ON memory_turns(conversation_id, at);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_turns_fts USING fts5(
      text,
      content = 'memory_turns',
      content_rowid = 'rowid',
      tokenize = 'trigram'
    );
    CREATE TRIGGER IF NOT EXISTS memory_turns_fts_insert AFTER INSERT ON memory_turns BEGIN
      INSERT INTO memory_turns_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_turns_fts_delete AFTER DELETE ON memory_turns BEGIN
      INSERT INTO memory_turns_fts(memory_turns_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_turns_fts_update AFTER UPDATE OF text ON memory_turns BEGIN
      INSERT INTO memory_turns_fts(memory_turns_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO memory_turns_fts(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TABLE IF NOT EXISTS memory_extraction_cursor (
      conversation_id TEXT PRIMARY KEY,
      last_message_id TEXT NOT NULL,
      failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
      updated_at INTEGER NOT NULL
    );
  `);
  readyDb = db;
}

/** Runs `operation` in one immediate transaction; any throw rolls the whole write back. */
export function runMemoryCoreTransaction<T>(db: SQLite.SQLiteDatabase, operation: () => T): T {
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  let result: T;
  try {
    result = operation();
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
  db.execSync('COMMIT');
  return result;
}

export function resetMemoryCoreSchemaCacheForTests(): void {
  readyDb = null;
}
