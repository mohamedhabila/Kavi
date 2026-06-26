import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Param = string | number | null | Buffer;

interface ShimDb {
  runSync: (sql: string, ...params: Param[]) => { changes: number; lastInsertRowId: number };
  getFirstSync: <T>(sql: string, ...params: Param[]) => T | null;
  getAllSync: <T>(sql: string, ...params: Param[]) => T[];
  execSync: (sql: string) => void;
  closeSync: () => void;
}

const handles = new Map<string, ShimDb>();

function resolveDatabasePath(name: string): string {
  if (name === ':memory:') return name;
  const dbDir = resolve(process.env.KAVI_MEMORY_SQLITE_DIR || process.cwd());
  mkdirSync(dbDir, { recursive: true });
  return join(dbDir, name);
}

function adapt(name: string, db: Database.Database): ShimDb {
  const handle: ShimDb = {
    runSync: (sql: string, ...params: Param[]) => {
      const result = db.prepare(sql).run(...params);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getFirstSync: <T>(sql: string, ...params: Param[]) => {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    getAllSync: <T>(sql: string, ...params: Param[]) => {
      return db.prepare(sql).all(...params) as T[];
    },
    execSync: (sql: string) => {
      db.exec(sql);
    },
    closeSync: () => {
      handles.delete(name);
      try {
        db.close();
      } catch {
        // Ignore double-close. This mirrors expo-sqlite's tolerant close behavior.
      }
    },
  };
  return handle;
}

export function openDatabaseSync(name: string): ShimDb {
  const dbPath = resolveDatabasePath(name);
  const existing = handles.get(dbPath);
  if (existing) return existing;

  const db = new Database(dbPath);
  const handle = adapt(dbPath, db);
  handles.set(dbPath, handle);
  return handle;
}
