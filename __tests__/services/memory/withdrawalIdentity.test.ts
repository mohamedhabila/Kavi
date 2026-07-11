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
  getMemoryDb().runSync(
    `INSERT INTO memory_withdrawal_sources(
       withdrawal_id, memory_conversation_id, source_thread_id, task_id,
       source_kind, source_id
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    'withdrawal-1',
    EXACT_SCOPE.memoryConversationId,
    EXACT_SCOPE.sourceThreadId,
    EXACT_SCOPE.taskId,
    'message',
    'message-1',
  );
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('memory withdrawal identity', () => {
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
