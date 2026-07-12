jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  runInIsolatedStructuredMemoryEvaluation,
  type StructuredMemoryEvaluationDatabase,
} from '../../src/acceptance/structuredMemoryEvaluation';
import { runMemoryDatabaseSavepoint } from '../../src/services/memory/access/databaseSavepoint';
import {
  clearStructuredMemoryDatabase,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function insertEntity(database: StructuredMemoryEvaluationDatabase, id: string): void {
  database.runSync(
    `INSERT INTO memory_entities
       (id, canonical_name, type, aliases, attributes, first_seen_at, last_seen_at, deleted_at)
     VALUES (?, ?, ?, '[]', '{}', ?, ?, NULL)`,
    id,
    id,
    'concept',
    1,
    1,
  );
}

describe('isolated structured memory evaluation', () => {
  it('cleans synthetic rows when the isolation operation fails', async () => {
    await expect(
      runInIsolatedStructuredMemoryEvaluation((database) => {
        insertEntity(database, 'forced-isolation-operation-failure');
        throw new Error('forced isolation operation failure');
      }),
    ).rejects.toThrow('forced isolation operation failure');
    await expect(
      runInIsolatedStructuredMemoryEvaluation(
        (database) =>
          database.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_entities')
            ?.count,
      ),
    ).resolves.toBe(0);
  });

  it('rejects nested evaluation without clearing the active evaluation rows', async () => {
    await runInIsolatedStructuredMemoryEvaluation(async (database) => {
      insertEntity(database, 'active-evaluation-entity');

      await expect(runInIsolatedStructuredMemoryEvaluation(() => undefined)).rejects.toThrow(
        'already active',
      );
      expect(
        database.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_entities')
          ?.count,
      ).toBe(1);
    });
  });

  it('rolls back exact-handle cleanup work when its operation fails', () => {
    const evaluationDatabase = getMemoryDb();
    insertEntity(evaluationDatabase, 'atomic-cleanup-entity');
    evaluationDatabase.runSync(
      `INSERT INTO memory_working_blocks
         (label, scope_key, conversation_id, thread_id, task_id, content, char_limit,
          description, prompt_eligibility, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'trusted_structural', ?)`,
      'active_focus',
      'conversation:atomic-cleanup',
      'atomic-cleanup',
      'atomic-cleanup',
      'must survive rollback',
      100,
      'rollback probe',
      1,
    );

    expect(() =>
      runMemoryDatabaseSavepoint(evaluationDatabase, (database) => {
        database.runSync('DELETE FROM memory_working_blocks');
        database.runSync('DELETE FROM memory_entities');
        expect(
          database.getFirstSync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM memory_working_blocks',
          )?.count,
        ).toBe(0);
        throw new Error('forced exact-handle cleanup failure');
      }),
    ).toThrow('forced exact-handle cleanup failure');
    expect(
      evaluationDatabase.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_entities',
      )?.count,
    ).toBe(1);
    expect(
      evaluationDatabase.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_working_blocks',
      )?.count,
    ).toBe(1);
    clearStructuredMemoryDatabase(evaluationDatabase);
  });

  it('fails closed when a new memory table has no cleanup classification', async () => {
    const database = getMemoryDb();
    database.execSync(`
      CREATE TABLE memory_unclassified_probe (id TEXT PRIMARY KEY);
      INSERT INTO memory_unclassified_probe (id) VALUES ('must-survive-refusal');
    `);

    await expect(runInIsolatedStructuredMemoryEvaluation(() => undefined)).rejects.toThrow(
      'unclassified memory tables: memory_unclassified_probe',
    );
    expect(
      database.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_unclassified_probe',
      )?.count,
    ).toBe(1);
    database.execSync('DROP TABLE memory_unclassified_probe');
  });

  it('preserves vault identity while clearing evaluation-owned rows', async () => {
    const database = getMemoryDb();
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_vault_identity (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO memory_vault_identity (singleton, owner_id, created_at)
      VALUES (1, 'owner-ret02-compatible', 1);
    `);
    const ownerBefore = database.getFirstSync<{ owner_id: string }>(
      'SELECT owner_id FROM memory_vault_identity WHERE singleton = 1',
    )?.owner_id;
    expect(ownerBefore).toBeTruthy();

    await runInIsolatedStructuredMemoryEvaluation((evaluationDatabase) => {
      expect(evaluationDatabase).toBe(database);
      insertEntity(evaluationDatabase, 'temporary-evaluation-entity');
    });

    expect(
      database.getFirstSync<{ owner_id: string }>(
        'SELECT owner_id FROM memory_vault_identity WHERE singleton = 1',
      )?.owner_id,
    ).toBe(ownerBefore);
    expect(
      database.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_entities')
        ?.count,
    ).toBe(0);
    database.execSync('DROP TABLE memory_vault_identity');
  });
});
