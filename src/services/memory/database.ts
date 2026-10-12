import * as SQLite from 'expo-sqlite';

const MEMORY_DATABASE_NAME = 'kavi-memory.db';

/**
 * The memory database's schema generation, kept in `PRAGMA user_version`. A database written
 * by another generation is started over rather than migrated (pre-release: there are no
 * users' memories to carry forward). Bump it whenever a table changes shape.
 */
export const MEMORY_DATABASE_SCHEMA_VERSION = 3;

let database: SQLite.SQLiteDatabase | null = null;

function configureMemoryDatabasePrivacy(db: SQLite.SQLiteDatabase): void {
  db.execSync('PRAGMA secure_delete = ON');
  const configured = db.getFirstSync<{ secure_delete: number }>('PRAGMA secure_delete');
  if (configured?.secure_delete !== 1) {
    throw new Error('memory_database_secure_delete_unavailable');
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface SchemaObjectRow {
  type: 'table' | 'view';
  name: string;
  sql: string | null;
}

/**
 * Drops every view and table of a database from another schema generation, in one
 * transaction, and stamps the current generation; each store then creates its tables on
 * first use. Full-text tables go before plain ones because dropping one removes its
 * shadow tables with it.
 */
function startOverUnlessCurrent(db: SQLite.SQLiteDatabase): void {
  const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version === MEMORY_DATABASE_SCHEMA_VERSION) return;

  const objects = db.getAllSync<SchemaObjectRow>(
    `SELECT type, name, sql FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`,
  );
  const isVirtualTable = (object: SchemaObjectRow) =>
    object.type === 'table' && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(object.sql ?? '');
  const dropOrder = [
    ...objects.filter((object) => object.type === 'view'),
    ...objects.filter(isVirtualTable),
    ...objects.filter((object) => object.type === 'table' && !isVirtualTable(object)),
  ];
  const foreignKeys = db.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  db.execSync('PRAGMA foreign_keys = OFF');
  try {
    db.execSync('BEGIN IMMEDIATE');
    try {
      for (const object of dropOrder) {
        const kind = object.type === 'view' ? 'VIEW' : 'TABLE';
        db.execSync(`DROP ${kind} IF EXISTS ${quoteIdentifier(object.name)}`);
      }
      db.execSync(`PRAGMA user_version = ${MEMORY_DATABASE_SCHEMA_VERSION}`);
      db.execSync('COMMIT');
    } catch (error) {
      try {
        db.execSync('ROLLBACK');
      } catch {
        // Preserve the error that stopped the reset.
      }
      throw error;
    }
  } finally {
    if (foreignKeys?.foreign_keys === 1) db.execSync('PRAGMA foreign_keys = ON');
  }
}

/**
 * Flush scrubbed pages and truncate a WAL when the connection uses one.
 * SQLite cannot guarantee erasure from device snapshots, backups, or flash
 * wear-levelled copies; those boundaries require storage-level encryption.
 */
export function checkpointMemoryDatabaseAfterSensitiveDeletion(): void {
  if (!database) return;
  database.execSync('PRAGMA wal_checkpoint(TRUNCATE)');
}

export function getMemoryDb(): SQLite.SQLiteDatabase {
  if (!database) {
    const openedDatabase = SQLite.openDatabaseSync(MEMORY_DATABASE_NAME);
    try {
      configureMemoryDatabasePrivacy(openedDatabase);
      startOverUnlessCurrent(openedDatabase);
      database = openedDatabase;
    } catch (error) {
      try {
        openedDatabase.closeSync();
      } catch {
        // Preserve the failure that prevented canonical database use.
      }
      throw error;
    }
  }
  return database;
}

export function closeMemoryDb(): void {
  if (!database) return;
  database.closeSync();
  database = null;
}
