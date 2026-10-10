import * as SQLite from 'expo-sqlite';

/**
 * Its own file, not the memory database: clearing memory must leave the person's
 * conversation history alone, and the memory schema guard does not version transcripts.
 */
const TRANSCRIPT_ARCHIVE_DATABASE_NAME = 'kavi-transcript-archive.db';

let database: SQLite.SQLiteDatabase | null = null;

function ensureTranscriptArchiveSchema(db: SQLite.SQLiteDatabase): void {
  db.execSync('PRAGMA secure_delete = ON');
  db.execSync(`
    CREATE TABLE IF NOT EXISTS archived_messages (
      archive_seq INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL,
      archived_at INTEGER NOT NULL,
      UNIQUE (conversation_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_archived_messages_order
      ON archived_messages (conversation_id, timestamp, archive_seq);
  `);
}

export function getTranscriptArchiveDb(): SQLite.SQLiteDatabase {
  if (!database) {
    const openedDatabase = SQLite.openDatabaseSync(TRANSCRIPT_ARCHIVE_DATABASE_NAME);
    try {
      ensureTranscriptArchiveSchema(openedDatabase);
      database = openedDatabase;
    } catch (error) {
      try {
        openedDatabase.closeSync();
      } catch {
        // Keep the schema failure that made the archive unusable.
      }
      throw error;
    }
  }
  return database;
}

export function closeTranscriptArchiveDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
}
