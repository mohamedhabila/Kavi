/** When set, wraps each database the module under test opens (for failure injection). */
const mockOpenInterceptor: {
  current: ((db: SQLite.SQLiteDatabase) => SQLite.SQLiteDatabase) | null;
} = { current: null };

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  const shim = makeExpoSqliteMock();
  return {
    ...shim,
    openDatabaseSync: (name: string) => {
      const db = shim.openDatabaseSync(name);
      return mockOpenInterceptor.current ? mockOpenInterceptor.current(db) : db;
    },
  };
});

import type * as SQLite from 'expo-sqlite';
import {
  closeMemoryDb,
  getMemoryDb,
  MEMORY_DATABASE_SCHEMA_VERSION,
} from '../../../src/services/memory/database';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  openDatabaseSync: (name: string) => SQLite.SQLiteDatabase;
  __resetExpoSqliteForTests: () => void;
};

/** The memory database file as written, without the interceptor. */
function rawDatabase(): SQLite.SQLiteDatabase {
  const interceptor = mockOpenInterceptor.current;
  mockOpenInterceptor.current = null;
  try {
    return sqliteMock.openDatabaseSync('kavi-memory.db');
  } finally {
    mockOpenInterceptor.current = interceptor;
  }
}

function userVersion(database: SQLite.SQLiteDatabase): number | undefined {
  return database.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version;
}

function schemaObjectNames(database: SQLite.SQLiteDatabase): string[] {
  return database
    .getAllSync<{
      name: string;
    }>(`SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((row) => row.name);
}

/** A database from an earlier generation: linked tables, a full-text index and a view. */
function writeEarlierGenerationDatabase(version: number): void {
  const db = rawDatabase();
  db.execSync('PRAGMA foreign_keys = ON');
  db.execSync(`
    CREATE TABLE memory_owner (id TEXT PRIMARY KEY);
    CREATE TABLE memory_child (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES memory_owner(id)
    );
    CREATE INDEX idx_memory_child_owner ON memory_child(owner_id);
    CREATE VIRTUAL TABLE memory_old_fts USING fts5(text, tokenize = 'trigram');
    CREATE VIEW memory_old_view AS SELECT id FROM memory_owner;
    INSERT INTO memory_owner (id) VALUES ('owner-1');
    INSERT INTO memory_child (id, owner_id) VALUES ('child-1', 'owner-1');
    INSERT INTO memory_old_fts (text) VALUES ('Sara lives in Porto');
  `);
  db.execSync(`PRAGMA user_version = ${version}`);
}

beforeEach(() => {
  mockOpenInterceptor.current = null;
  closeMemoryDb();
  sqliteMock.__resetExpoSqliteForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory database', () => {
  it('opens a new database at the current schema generation with secure deletion', () => {
    const db = getMemoryDb();

    expect(userVersion(db)).toBe(MEMORY_DATABASE_SCHEMA_VERSION);
    expect(db.getFirstSync('PRAGMA secure_delete')).toEqual({ secure_delete: 1 });
    expect(getMemoryDb()).toBe(db);
  });

  it.each([
    ['an unversioned database', 0],
    ['an older generation', MEMORY_DATABASE_SCHEMA_VERSION - 1],
    ['a newer generation', MEMORY_DATABASE_SCHEMA_VERSION + 1],
  ])('starts %s over, full-text tables and views included', (_label, version) => {
    writeEarlierGenerationDatabase(version);

    const db = getMemoryDb();

    expect(schemaObjectNames(db)).toEqual([]);
    expect(userVersion(db)).toBe(MEMORY_DATABASE_SCHEMA_VERSION);
    expect(db.getFirstSync('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('keeps the tables of a current-generation database across reopening', () => {
    getMemoryDb().execSync(
      "CREATE TABLE memory_kept (id TEXT PRIMARY KEY); INSERT INTO memory_kept VALUES ('kept');",
    );
    closeMemoryDb();

    expect(getMemoryDb().getAllSync('SELECT id FROM memory_kept')).toEqual([{ id: 'kept' }]);
  });
});

describe('memory database open failures', () => {
  /** Opens the database with `overrides` in place of the real methods; returns what it threw. */
  function openWith(overrides: Partial<SQLite.SQLiteDatabase>): { error: unknown; closed: number } {
    let closed = 0;
    mockOpenInterceptor.current = (db) =>
      new Proxy(db, {
        get: (target, property, receiver) => {
          if (property === 'closeSync') {
            return () => {
              closed += 1;
              target.closeSync();
            };
          }
          return property in overrides
            ? overrides[property as keyof SQLite.SQLiteDatabase]
            : Reflect.get(target, property, receiver);
        },
      });
    try {
      getMemoryDb();
      return { error: undefined, closed };
    } catch (error) {
      return { error, closed };
    } finally {
      mockOpenInterceptor.current = null;
    }
  }

  it('fails closed and closes the handle when secure deletion is unavailable', () => {
    const opened = openWith({
      getFirstSync: ((sql: string) =>
        sql === 'PRAGMA secure_delete'
          ? { secure_delete: 0 }
          : null) as SQLite.SQLiteDatabase['getFirstSync'],
    });

    expect(opened).toEqual({
      error: new Error('memory_database_secure_delete_unavailable'),
      closed: 1,
    });
  });

  it('leaves the earlier generation intact when the reset fails, and retries on the next open', () => {
    writeEarlierGenerationDatabase(0);
    const real = rawDatabase();
    let drops = 0;
    const opened = openWith({
      execSync: ((sql: string) => {
        if (sql.startsWith('DROP TABLE') && ++drops === 2) throw new Error('database busy');
        real.execSync(sql);
      }) as SQLite.SQLiteDatabase['execSync'],
    });

    expect(opened).toEqual({ error: new Error('database busy'), closed: 1 });
    const inspected = rawDatabase();
    expect(userVersion(inspected)).toBe(0);
    expect(inspected.getAllSync('SELECT id FROM memory_child')).toEqual([{ id: 'child-1' }]);
    expect(inspected.getFirstSync('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });

    expect(schemaObjectNames(getMemoryDb())).toEqual([]);
  });
});
