jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  MIGRATION_ERROR_CODES,
  MIGRATION_STATUSES,
} from '../../../src/services/memory/migrationStateSchema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
});

function migrationStateContract(): { columns: string[]; tableSql: string } {
  const db = getMemoryDb();
  return {
    columns: db
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_migration_state)')
      .map((column) => column.name),
    tableSql:
      db.getFirstSync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_migration_state'",
      )?.sql ?? '',
  };
}

describe('migration state schema', () => {
  it('uses the same constrained contract for fresh and upgraded databases', () => {
    ensureFactSchema();
    const fresh = migrationStateContract();

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    getMemoryDb().execSync(`
      CREATE TABLE memory_migration_state (
        conversation_id TEXT PRIMARY KEY,
        last_seeded_message_id TEXT,
        seeded_turns INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO memory_migration_state (
        conversation_id, seeded_turns, status, error, updated_at
      ) VALUES
        ('raw-error', 2, 'error', 'Error: provider token leaked', 100),
        ('raw-status', 0, 'crashed', 'arbitrary failure payload', 200),
        ('completed-with-error', 1, 'completed', 'old diagnostic', 300);
    `);

    ensureFactSchema();
    const upgraded = migrationStateContract();
    expect(upgraded.columns).toEqual(fresh.columns);
    for (const status of MIGRATION_STATUSES) {
      expect(upgraded.tableSql).toContain(`'${status}'`);
      expect(fresh.tableSql).toContain(`'${status}'`);
    }
    for (const code of MIGRATION_ERROR_CODES) {
      expect(upgraded.tableSql).toContain(`'${code}'`);
      expect(fresh.tableSql).toContain(`'${code}'`);
    }
    expect(
      getMemoryDb().getAllSync<{ conversation_id: string; status: string; error: string | null }>(
        `SELECT conversation_id, status, error
           FROM memory_migration_state
          ORDER BY conversation_id`,
      ),
    ).toEqual([
      { conversation_id: 'completed-with-error', status: 'completed', error: null },
      {
        conversation_id: 'raw-error',
        status: 'error',
        error: 'legacy_error_sanitized',
      },
      {
        conversation_id: 'raw-status',
        status: 'error',
        error: 'legacy_state_sanitized',
      },
    ]);
    expect(upgraded.tableSql).not.toContain('provider token leaked');
    expect(upgraded.tableSql).not.toContain('arbitrary failure payload');
  });

  it('rejects unbounded future error codes and inconsistent state', () => {
    ensureFactSchema();
    const db = getMemoryDb();

    expect(() =>
      db.runSync(
        `INSERT INTO memory_migration_state (
           conversation_id, seeded_turns, status, error, updated_at
         ) VALUES ('invalid-code', 0, 'error', 'raw exception text', 1)`,
      ),
    ).toThrow();
    expect(() =>
      db.runSync(
        `INSERT INTO memory_migration_state (
           conversation_id, seeded_turns, status, error, updated_at
         ) VALUES ('missing-code', 0, 'error', NULL, 1)`,
      ),
    ).toThrow();
    expect(() =>
      db.runSync(
        `INSERT INTO memory_migration_state (
           conversation_id, seeded_turns, status, error, updated_at
         ) VALUES ('completed-error', 1, 'completed', 'persistence_failed', 1)`,
      ),
    ).toThrow();
    expect(() =>
      db.runSync(
        `INSERT INTO memory_migration_state (
           conversation_id, seeded_turns, status, error,
           claim_token, claim_expires_at, updated_at
         ) VALUES ('partial-claim', 0, 'in_progress', NULL, 'token', NULL, 1)`,
      ),
    ).toThrow();
    expect(() =>
      db.runSync(
        `INSERT INTO memory_migration_state (
           conversation_id, seeded_turns, status, error,
           claim_token, claim_expires_at, updated_at
         ) VALUES ('empty-claim', 0, 'in_progress', NULL, '   ', 100, 1)`,
      ),
    ).toThrow();
  });
});
