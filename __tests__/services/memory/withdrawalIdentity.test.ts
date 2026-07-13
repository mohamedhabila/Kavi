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
  assertMemoryPersistenceSourcesAreWritable,
  isMemoryIngestionSourceWithdrawn,
  isMemorySourceWithdrawn,
} from '../../../src/services/memory/withdrawalFence';
import {
  factWithdrawalScope,
  normalizeWithdrawalOpaqueId,
} from '../../../src/services/memory/withdrawalLineage';
import type { FactRow } from '../../../src/services/memory/facts/types';
import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const EXACT_SCOPE = {
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  taskId: 'task-1',
} as const;

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  insertRetiredMemorySourceForTest({
    retirementGroupId: 'withdrawal-1',
    ...EXACT_SCOPE,
    sourceKind: 'message',
    sourceId: 'message-1',
  });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('memory withdrawal identity', () => {
  it('stores one tombstone per exact source while preserving sibling identities', () => {
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-duplicate',
      ...EXACT_SCOPE,
      sourceKind: 'message',
      sourceId: 'message-1',
    });
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'withdrawal-sibling',
      ...EXACT_SCOPE,
      sourceKind: 'turn',
      sourceId: 'message-1',
    });

    expect(
      getMemoryDb().getAllSync<{ retirement_group_id: string; source_kind: string }>(
        `SELECT retirement_group_id, source_kind FROM memory_retired_sources
          WHERE memory_conversation_id = ? AND source_thread_id = ?
            AND task_id = ? AND source_id = ?
          ORDER BY source_kind`,
        EXACT_SCOPE.memoryConversationId,
        EXACT_SCOPE.sourceThreadId,
        EXACT_SCOPE.taskId,
        'message-1',
      ),
    ).toEqual([
      { retirement_group_id: 'withdrawal-1', source_kind: 'message' },
      { retirement_group_id: 'withdrawal-sibling', source_kind: 'turn' },
    ]);
    expect(
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'run',
        sourceId: 'message-1',
      }),
    ).toBe(false);
  });

  it('does not apply a foreign-owner tombstone to the local memory vault', () => {
    getMemoryDb().runSync(
      `INSERT INTO memory_source_retirement_groups(id, reason, retired_at)
       VALUES ('foreign-owner-retirement', 'fact_withdrawal', 1)`,
    );
    getMemoryDb().runSync(
      `INSERT INTO memory_retired_sources(
         retirement_group_id, memory_owner_id, memory_conversation_id,
         source_thread_id, task_id, source_kind, source_id
       ) VALUES ('foreign-owner-retirement', 'foreign-owner', ?, ?, ?, 'message', ?)`,
      EXACT_SCOPE.memoryConversationId,
      EXACT_SCOPE.sourceThreadId,
      EXACT_SCOPE.taskId,
      'foreign-only-message',
    );

    expect(
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'message',
        sourceId: 'foreign-only-message',
      }),
    ).toBe(false);
    expect(() =>
      assertMemoryPersistenceSourcesAreWritable(EXACT_SCOPE, [
        { sourceKind: 'message', sourceId: 'foreign-only-message' },
      ]),
    ).not.toThrow();
  });

  it('keeps null-task and exact-task source identities independent', () => {
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'null-task-retirement',
      memoryConversationId: EXACT_SCOPE.memoryConversationId,
      sourceThreadId: EXACT_SCOPE.sourceThreadId,
      taskId: null,
      sourceKind: 'message',
      sourceId: 'task-sensitive-message',
    });

    expect(
      isMemorySourceWithdrawn({
        memoryConversationId: EXACT_SCOPE.memoryConversationId,
        sourceThreadId: EXACT_SCOPE.sourceThreadId,
        taskId: null,
        sourceKind: 'message',
        sourceId: 'task-sensitive-message',
      }),
    ).toBe(true);
    expect(
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'message',
        sourceId: 'task-sensitive-message',
      }),
    ).toBe(false);
    expect(
      isMemorySourceWithdrawn({
        memoryConversationId: EXACT_SCOPE.memoryConversationId,
        sourceThreadId: EXACT_SCOPE.sourceThreadId,
        taskId: null,
        sourceKind: 'message',
        sourceId: 'message-1',
      }),
    ).toBe(false);
  });

  it('matches only exact scope and provenance identities', () => {
    expect(
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'message',
        sourceId: 'message-1',
      }),
    ).toBe(true);

    expect(() =>
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceThreadId: ' thread-1',
        sourceKind: 'message',
        sourceId: 'message-1',
      }),
    ).toThrow('memory_withdrawal_thread_scope_invalid');
    expect(() =>
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'message',
        sourceId: 'message-1 ',
      }),
    ).toThrow('memory_withdrawal_source_id_invalid');
  });

  it('rejects malformed optional identities instead of treating them as absent', () => {
    expect(() =>
      assertMemoryPersistenceSourcesAreWritable(EXACT_SCOPE, [
        { sourceKind: 'message', sourceId: '' },
      ]),
    ).toThrow('memory_withdrawal_source_id_invalid');
    expect(() =>
      isMemoryIngestionSourceWithdrawn({
        ...EXACT_SCOPE,
        sourceStartMessageId: '',
        sourceEndMessageId: 'turn-1',
      }),
    ).toThrow('memory_withdrawal_source_id_invalid');
    expect(() =>
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        taskId: '',
        sourceKind: 'message',
        sourceId: 'message-1',
      }),
    ).toThrow('memory_withdrawal_task_scope_invalid');
  });

  it('does not normalize opaque withdrawal or stored scope identities', () => {
    expect(normalizeWithdrawalOpaqueId('message-1')).toBe('message-1');
    expect(normalizeWithdrawalOpaqueId(' message-1')).toBeNull();
    expect(
      factWithdrawalScope({
        origin_conversation_id: 'conversation-1',
        origin_thread_id: null,
        origin_task_id: null,
      } as FactRow),
    ).toEqual({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'conversation-1',
      taskId: '',
    });
    expect(() =>
      factWithdrawalScope({
        origin_conversation_id: 'conversation-1 ',
        origin_thread_id: 'thread-1',
        origin_task_id: null,
      } as FactRow),
    ).toThrow('memory_withdrawal_conversation_scope_invalid');
  });
});
