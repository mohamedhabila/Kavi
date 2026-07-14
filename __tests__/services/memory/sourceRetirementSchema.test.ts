jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  ensureSourceRetirementSchema,
  isSourceRetirementSchemaResetRequired,
} from '../../../src/services/memory/sourceRetirementSchema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function retirementTableNames(): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'memory_%retirement%'
           OR type = 'table' AND name LIKE 'memory_retired_%'
        ORDER BY name`,
    )
    .map((row) => row.name);
}

describe('source retirement schema', () => {
  it('installs the exact five-table immutable ledger and is idempotent', () => {
    const db = getMemoryDb();

    ensureFactSchema();
    ensureSourceRetirementSchema(db);

    expect(retirementTableNames()).toEqual([
      'memory_retired_fact_contributions',
      'memory_retired_facts',
      'memory_retired_sources',
      'memory_source_retirement_groups',
      'memory_source_retirement_requests',
    ]);
    expect(
      db
        .getAllSync<{ name: string }>('PRAGMA table_info(memory_source_retirement_groups)')
        .map((row) => row.name),
    ).toEqual([
      'id',
      'memory_owner_id',
      'reason',
      'retired_at',
      'requested_source_set_version',
      'requested_source_set_count',
      'requested_source_set_sha256',
      'closed_source_set_version',
      'closed_source_set_count',
      'closed_source_set_sha256',
      'retired_contribution_set_version',
      'retired_contribution_set_count',
      'retired_contribution_set_sha256',
      'retired_fact_set_version',
      'retired_fact_set_count',
      'retired_fact_set_sha256',
    ]);
    expect(
      db.getAllSync<{ name: string }>(
        `SELECT name FROM sqlite_master
          WHERE type = 'trigger' AND name LIKE 'trg_memory_%retirement%'
             OR type = 'trigger' AND name LIKE 'trg_memory_retired_%'`,
      ),
    ).toHaveLength(23);
  });

  it('rejects the legacy two-table layout without migrating or dropping it', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_source_retirement_groups (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        retired_at INTEGER NOT NULL
      );
      CREATE TABLE memory_retired_sources (
        retirement_group_id TEXT NOT NULL,
        memory_owner_id TEXT NOT NULL,
        memory_conversation_id TEXT NOT NULL,
        source_thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL
      );
    `);

    let thrown: unknown;
    try {
      ensureFactSchema();
    } catch (error) {
      thrown = error;
    }

    expect(isSourceRetirementSchemaResetRequired(thrown)).toBe(true);
    expect(
      db.getFirstSync<{ present: number }>(
        `SELECT 1 AS present FROM sqlite_master
          WHERE type = 'table' AND name = 'memory_source_retirement_requests'`,
      ),
    ).toBeNull();
    expect(
      db
        .getAllSync<{ name: string }>('PRAGMA table_info(memory_source_retirement_groups)')
        .map((row) => row.name),
    ).toEqual(['id', 'reason', 'retired_at']);
  });

  it.each(['memory_withdrawals', 'memory_withdrawal_facts', 'memory_withdrawal_sources'])(
    'rejects the removed legacy table %s instead of retaining a compatibility layer',
    (tableName) => {
      const db = getMemoryDb();
      db.execSync(`CREATE TABLE ${tableName} (id TEXT PRIMARY KEY)`);

      expect(() => ensureFactSchema()).toThrow('memory_source_retirement_schema_reset_required');
      expect(
        db.getFirstSync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          tableName,
        )?.name,
      ).toBe(tableName);
    },
  );

  it('rejects a partial canonical layout without filling missing tables', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_retired_facts (
        fact_id TEXT PRIMARY KEY,
        retirement_group_id TEXT NOT NULL
      )
    `);

    expect(() => ensureFactSchema()).toThrow('memory_source_retirement_schema_reset_required');
    expect(retirementTableNames()).toEqual(['memory_retired_facts']);
  });

  it('rejects a conflicting schema object instead of attempting a fresh install', () => {
    const db = getMemoryDb();
    db.execSync("CREATE VIEW memory_retired_facts AS SELECT 'fact-1' AS fact_id");

    expect(() => ensureFactSchema()).toThrow('memory_source_retirement_schema_reset_required');
    expect(
      db.getFirstSync<{ type: string }>(
        "SELECT type FROM sqlite_master WHERE name = 'memory_retired_facts'",
      )?.type,
    ).toBe('view');
  });

  it('rejects a weakened external parent-identity trigger', () => {
    const db = getMemoryDb();
    ensureFactSchema();
    db.execSync(`
      DROP TRIGGER trg_memory_retired_fact_parent_identity_update;
      CREATE TRIGGER trg_memory_retired_fact_parent_identity_update
      BEFORE UPDATE OF id, memory_owner_id ON memory_facts
      BEGIN SELECT 1; END;
    `);
    resetFactSchemaCacheForTests();

    expect(() => ensureFactSchema()).toThrow('memory_source_retirement_schema_reset_required');
  });
});
