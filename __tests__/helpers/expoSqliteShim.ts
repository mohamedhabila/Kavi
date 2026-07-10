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

interface ControlledShimDb {
  api: ShimDb;
  forceClose: () => void;
  reopen: () => void;
}

function adapt(db: Database.Database): ControlledShimDb {
  let open = true;
  const requireOpen = (): void => {
    if (!open) throw new TypeError('The database connection is not open');
  };
  const api: ShimDb = {
    runSync: (sql: string, ...params: Param[]) => {
      requireOpen();
      const result = db.prepare(sql).run(...params);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstSync: <T,>(sql: string, ...params: Param[]) => {
      requireOpen();
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllSync: <T,>(sql: string, ...params: Param[]) => {
      requireOpen();
      return db.prepare(sql).all(...params) as T[];
    },
    execSync: (sql: string) => {
      requireOpen();
      db.exec(sql);
    },
    closeSync: () => {
      open = false;
    },
  };
  return {
    api,
    forceClose: () => {
      if (db.open) db.close();
      open = false;
    },
    reopen: () => {
      if (!db.open) throw new TypeError('The database connection cannot be reopened');
      open = true;
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
  const handles = new Map<string, ControlledShimDb>();
  return {
    openDatabaseSync: (name: string) => {
      let h = handles.get(name);
      if (!h) {
        h = adapt(new Database(':memory:'));
        handles.set(name, h);
      }
      h.reopen();
      return h.api;
    },
    __resetExpoSqliteForTests: () => {
      for (const h of handles.values()) {
        try {
          h.forceClose();
        } catch {
          // ignore
        }
      }
      handles.clear();
    },
  };
}
