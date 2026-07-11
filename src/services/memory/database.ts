import * as SQLite from 'expo-sqlite';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

let database: SQLite.SQLiteDatabase | null = null;

function ensureMemoryChunkColumn(
  currentDatabase: SQLite.SQLiteDatabase,
  column: string,
  definition: string,
): void {
  try {
    currentDatabase.execSync(`ALTER TABLE memory_chunks ADD COLUMN ${column} ${definition}`);
  } catch {
    // Column already exists on upgraded databases.
  }
}

function ensureMemoryChunkSchema(currentDatabase: SQLite.SQLiteDatabase): void {
  currentDatabase.execSync(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        timestamp INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        conversation_id TEXT,
        task_id TEXT,
        project_id TEXT,
        source_key TEXT,
        source_kind TEXT NOT NULL DEFAULT 'memory_file',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at INTEGER,
        UNIQUE(content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON memory_chunks(content_hash);
      CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON memory_chunks(timestamp);
      CREATE INDEX IF NOT EXISTS idx_chunks_scope_source
        ON memory_chunks(scope, conversation_id, task_id, project_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_chunks_source_key
        ON memory_chunks(source_key, deleted_at);
    `);
  ensureMemoryChunkColumn(currentDatabase, 'scope', "TEXT NOT NULL DEFAULT 'global'");
  ensureMemoryChunkColumn(currentDatabase, 'conversation_id', 'TEXT');
  ensureMemoryChunkColumn(currentDatabase, 'task_id', 'TEXT');
  ensureMemoryChunkColumn(currentDatabase, 'project_id', 'TEXT');
  ensureMemoryChunkColumn(currentDatabase, 'source_key', 'TEXT');
  ensureMemoryChunkColumn(currentDatabase, 'source_kind', "TEXT NOT NULL DEFAULT 'memory_file'");
  ensureMemoryChunkColumn(currentDatabase, 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureMemoryChunkColumn(currentDatabase, 'deleted_at', 'INTEGER');
}

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!database) {
    database = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
    ensureMemoryChunkSchema(database);
  }
  return database;
}

export function closeMemoryDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
}
