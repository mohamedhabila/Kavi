jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { isMemorySourceWithdrawn } from '../../../src/services/memory/withdrawalFence';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';

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

describe('source retirement schema', () => {
  it('clears retirement groups and sources with structured memory', () => {
    ensureFactSchema();
    const ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'retirement-clear',
      memoryConversationId: 'conversation-clear',
      sourceThreadId: 'thread-clear',
      sourceKind: 'run',
      sourceId: 'run-clear',
    });

    clearStructuredMemory();

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_groups',
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retired_sources',
      )?.count,
    ).toBe(0);
    expect(getLocalMemoryVaultOwnerId(getMemoryDb())).toBe(ownerId);
  });

  it('migrates legacy withdrawal sources once and removes the old table', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_withdrawals (
        id TEXT PRIMARY KEY,
        target_fact_id TEXT NOT NULL UNIQUE,
        memory_conversation_id TEXT NOT NULL,
        source_thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        withdrawn_at INTEGER NOT NULL
      );
      CREATE TABLE memory_withdrawal_sources (
        withdrawal_id TEXT NOT NULL,
        memory_conversation_id TEXT NOT NULL,
        source_thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (
          withdrawal_id, memory_conversation_id, source_thread_id,
          task_id, source_kind, source_id
        )
      );
    `);
    db.runSync(
      `INSERT INTO memory_withdrawals(
         id, target_fact_id, memory_conversation_id, source_thread_id,
         task_id, reason, withdrawn_at
       ) VALUES ('legacy-withdrawal', 'legacy-fact', 'conversation-1',
                 'thread-1', 'task-1', 'user_request', 123)`,
    );
    db.runSync(
      `INSERT INTO memory_withdrawal_sources(
         withdrawal_id, memory_conversation_id, source_thread_id,
         task_id, source_kind, source_id
       ) VALUES ('legacy-withdrawal', 'conversation-1', 'thread-1',
                 'task-1', 'message', 'message-1')`,
    );

    ensureFactSchema();

    expect(
      db.getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_withdrawal_sources'",
      ),
    ).toBeNull();
    expect(
      db.getFirstSync<{
        reason: string;
        retired_at: number;
      }>(
        `SELECT reason, retired_at FROM memory_source_retirement_groups
          WHERE id = 'legacy-withdrawal'`,
      ),
    ).toEqual({ reason: 'fact_withdrawal', retired_at: 123 });
    expect(
      db.getFirstSync<{
        memory_owner_id: string;
        retirement_group_id: string;
      }>(
        `SELECT memory_owner_id, retirement_group_id FROM memory_retired_sources
          WHERE memory_conversation_id = 'conversation-1'
            AND source_thread_id = 'thread-1' AND task_id = 'task-1'
            AND source_kind = 'message' AND source_id = 'message-1'`,
      ),
    ).toEqual({
      memory_owner_id: getLocalMemoryVaultOwnerId(db),
      retirement_group_id: 'legacy-withdrawal',
    });
    expect(
      isMemorySourceWithdrawn({
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        taskId: 'task-1',
        sourceKind: 'message',
        sourceId: 'message-1',
      }),
    ).toBe(true);

    resetFactSchemaCacheForTests();
    ensureFactSchema();
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_retired_sources')
        ?.count,
    ).toBe(1);
  });
});
