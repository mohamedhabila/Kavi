jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

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

describe('fact contribution admission schema', () => {
  it('creates a constrained singleton marker and content-free quarantine ledger', () => {
    ensureFactSchema();
    const db = getMemoryDb();

    expect(
      db
        .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_legacy_quarantine)')
        .map((column) => column.name),
    ).toEqual(['fact_id', 'reason', 'quarantined_at']);

    db.runSync(
      `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
       VALUES ('legacy-fact', 'source_scope_unproven', 100)`,
    );

    expect(
      db.getFirstSync(
        `SELECT singleton, version, completed_at, admitted_count, quarantined_count
           FROM memory_fact_contribution_admission`,
      ),
    ).toEqual({
      singleton: 1,
      version: 1,
      completed_at: expect.any(Number),
      admitted_count: 0,
      quarantined_count: 0,
    });
    expect(
      db.getFirstSync('SELECT fact_id, reason, quarantined_at FROM memory_fact_legacy_quarantine'),
    ).toEqual({
      fact_id: 'legacy-fact',
      reason: 'source_scope_unproven',
      quarantined_at: 100,
    });
    expect(() =>
      db.runSync(
        `INSERT INTO memory_fact_contribution_admission(
           singleton, version, completed_at, admitted_count, quarantined_count
         ) VALUES (2, 1, 100, 0, 0)`,
      ),
    ).toThrow();
    expect(() =>
      db.runSync(
        `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
         VALUES ('invalid-reason', 'unknown', 100)`,
      ),
    ).toThrow();
  });

  it('preserves the completed boundary across schema bootstrap and structured-memory clear', () => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.runSync(
      `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
       VALUES ('legacy-fact', 'source_missing', 200)`,
    );

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();
    clearStructuredMemory();

    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_admission',
      )?.count,
    ).toBe(1);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_legacy_quarantine',
      )?.count,
    ).toBe(0);
    expect(() =>
      db.runSync(
        'UPDATE memory_fact_contribution_admission SET admitted_count = 2 WHERE singleton = 1',
      ),
    ).toThrow('memory_fact_contribution_admission_immutable');
    expect(() =>
      db.runSync('DELETE FROM memory_fact_contribution_admission WHERE singleton = 1'),
    ).toThrow('memory_fact_contribution_admission_immutable');
    const markerBeforeConflictWrites = db.getFirstSync(
      'SELECT * FROM memory_fact_contribution_admission WHERE singleton = 1',
    );
    expect(() =>
      db.runSync(
        `INSERT OR REPLACE INTO memory_fact_contribution_admission(
           singleton, version, completed_at, admitted_count, quarantined_count
         ) VALUES (1, 1, 999, 9, 9)`,
      ),
    ).toThrow('memory_fact_contribution_admission_immutable');
    expect(() =>
      db.runSync(
        `INSERT INTO memory_fact_contribution_admission(
           singleton, version, completed_at, admitted_count, quarantined_count
         ) VALUES (1, 1, 999, 9, 9)
         ON CONFLICT(singleton) DO UPDATE SET completed_at = excluded.completed_at`,
      ),
    ).toThrow('memory_fact_contribution_admission_immutable');
    expect(
      db.getFirstSync('SELECT * FROM memory_fact_contribution_admission WHERE singleton = 1'),
    ).toEqual(markerBeforeConflictWrites);
  });
});
