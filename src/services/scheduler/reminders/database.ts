// ---------------------------------------------------------------------------
// Kavi — Reminders Database
// ---------------------------------------------------------------------------
// A small dedicated SQLite database for reminders, opened lazily with the same
// expo-sqlite sync API the memory store already relies on
// (src/services/memory/database.ts): openDatabaseSync + execSync/runSync/
// getFirstSync/getAllSync.

import * as SQLite from 'expo-sqlite';

const REMINDERS_DATABASE_NAME = 'kavi-reminders.db';

let database: SQLite.SQLiteDatabase | null = null;
let schemaReady = false;

export function getRemindersDb(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(REMINDERS_DATABASE_NAME);
  }
  if (!schemaReady) {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        recurrence_kind TEXT NOT NULL,
        recurrence_time TEXT,
        recurrence_weekday INTEGER,
        recurrence_day_of_month INTEGER,
        recurrence_at TEXT,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        next_fire_at_ms INTEGER,
        armed_for_ms INTEGER,
        notification_ids TEXT NOT NULL DEFAULT '[]',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_status_next_fire
        ON reminders(status, next_fire_at_ms);
    `);
    schemaReady = true;
  }
  return database;
}

/** Also resets the schema-ready cache, so a later getRemindersDb() reopens cleanly (tests rely on this). */
export function closeRemindersDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
  schemaReady = false;
}
