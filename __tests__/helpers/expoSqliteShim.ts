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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Param = string | number | null | Buffer;

interface ShimDb {
  databasePath: string;
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

function adapt(db: Database.Database, databasePath: string): ControlledShimDb {
  let open = true;
  const requireOpen = (): void => {
    if (!open) throw new TypeError('The database connection is not open');
  };
  const api: ShimDb = {
    databasePath,
    runSync: (sql: string, ...params: Param[]) => {
      requireOpen();
      const result = db.prepare(sql).run(...params);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstSync: <T>(sql: string, ...params: Param[]) => {
      requireOpen();
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllSync: <T>(sql: string, ...params: Param[]) => {
      requireOpen();
      return db.prepare(sql).all(...params) as T[];
    },
    execSync: (sql: string) => {
      requireOpen();
      db.exec(sql);
    },
    closeSync: () => {
      if (open) {
        if (db.inTransaction) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // Best-effort native-close parity for fault-injection tests.
          }
        }
        const attached = db.pragma('database_list') as Array<{ name: string }>;
        for (const entry of attached) {
          if (entry.name === 'main' || entry.name === 'temp') continue;
          const quotedName = `"${entry.name.replace(/"/g, '""')}"`;
          try {
            db.exec(`DETACH DATABASE ${quotedName}`);
          } catch {
            // The wrapper is still closed even when native cleanup is imperfect.
          }
        }
      }
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
export function makeExpoSqliteMock(options: { fileBacked?: boolean } = {}): {
  openDatabaseSync: (name: string) => ShimDb;
  __resetExpoSqliteForTests: () => void;
} {
  const handles = new Map<string, ControlledShimDb>();
  let directory: string | null = null;
  const databasePathFor = (name: string): string => {
    if (!options.fileBacked || name === ':memory:') return ':memory:';
    directory ??= mkdtempSync(join(tmpdir(), 'kavi-expo-sqlite-'));
    return join(directory, name);
  };
  return {
    openDatabaseSync: (name: string) => {
      let h = handles.get(name);
      if (!h) {
        const databasePath = databasePathFor(name);
        h = adapt(new Database(databasePath), databasePath);
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
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
        directory = null;
      }
    },
  };
}
