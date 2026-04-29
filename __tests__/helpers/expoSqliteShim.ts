// ---------------------------------------------------------------------------
// Test helper — in-memory expo-sqlite shim backed by better-sqlite3
// ---------------------------------------------------------------------------
// expo-sqlite (~v55) uses synchronous methods runSync/getFirstSync/getAllSync/
// execSync/closeSync. better-sqlite3 has the same shape conceptually; we just
// adapt the call signatures and return shapes the rest of the app expects.
//
// Use via:
//   jest.mock('expo-sqlite', () => require('../helpers/expoSqliteShim').makeExpoSqliteMock());

import Database from 'better-sqlite3';

type Param = string | number | null | Buffer;

interface ShimDb {
  runSync: (sql: string, ...params: Param[]) => { changes: number; lastInsertRowId: number };
  getFirstSync: <T>(sql: string, ...params: Param[]) => T | null;
  getAllSync: <T>(sql: string, ...params: Param[]) => T[];
  execSync: (sql: string) => void;
  closeSync: () => void;
}

function adapt(db: Database.Database): ShimDb {
  return {
    runSync: (sql: string, ...params: Param[]) => {
      const result = db.prepare(sql).run(...params);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstSync: <T,>(sql: string, ...params: Param[]) => {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllSync: <T,>(sql: string, ...params: Param[]) => {
      return db.prepare(sql).all(...params) as T[];
    },
    execSync: (sql: string) => {
      db.exec(sql);
    },
    closeSync: () => {
      try {
        db.close();
      } catch {
        // ignore double-close
      }
    },
  };
}

/**
 * Returns a fresh in-memory expo-sqlite mock module. Each call to
 * `openDatabaseSync(name)` returns the same shim per name within the mock,
 * mimicking expo-sqlite's per-name singleton behavior.
 */
export function makeExpoSqliteMock(): {
  openDatabaseSync: (name: string) => ShimDb;
  __resetExpoSqliteForTests: () => void;
} {
  const handles = new Map<string, ShimDb>();
  return {
    openDatabaseSync: (name: string) => {
      let h = handles.get(name);
      if (!h) {
        h = adapt(new Database(':memory:'));
        handles.set(name, h);
      }
      return h;
    },
    __resetExpoSqliteForTests: () => {
      for (const h of handles.values()) {
        try {
          h.closeSync();
        } catch {
          // ignore
        }
      }
      handles.clear();
    },
  };
}
