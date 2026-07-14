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
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';
import type { PersistedExactMemorySourceIdentity } from '../../../src/services/memory/exactMemorySourceIdentity';
import {
  loadVerifiedRetirementGroup,
  retirementLedgerCounts,
} from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const EXACT_SCOPE = {
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  taskId: 'task-1',
} as const;

function exactSource(
  sourceKind: PersistedExactMemorySourceIdentity['sourceKind'],
  sourceId: string,
  taskId: string | null = EXACT_SCOPE.taskId,
): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
    memoryConversationId: EXACT_SCOPE.memoryConversationId,
    sourceThreadId: EXACT_SCOPE.sourceThreadId,
    taskId: taskId ?? '',
    sourceKind,
    sourceId,
  };
}

function retireSource(
  retirementGroupId: string,
  sourceKind: PersistedExactMemorySourceIdentity['sourceKind'],
  sourceId: string,
  taskId: string | null = EXACT_SCOPE.taskId,
) {
  return retireExactMemorySources({
    reason: 'message_delete',
    requestedSources: [exactSource(sourceKind, sourceId, taskId)],
    retiredAt: 100,
    retirementGroupId,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  retireSource('withdrawal-1', 'message', 'message-1');
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('memory withdrawal identity', () => {
  it('stores one tombstone per exact source while preserving sibling identities', () => {
    expect(retireSource('withdrawal-duplicate', 'message', 'message-1')).toMatchObject({
      status: 'already_retired',
      requestedSourceCount: 1,
    });
    expect(retireSource('withdrawal-sibling', 'turn', 'message-1')).toMatchObject({
      status: 'retired',
      retirementGroupId: 'withdrawal-sibling',
    });

    expect(loadVerifiedRetirementGroup('withdrawal-1')?.closedSources).toEqual([
      exactSource('message', 'message-1'),
    ]);
    expect(loadVerifiedRetirementGroup('withdrawal-sibling')?.closedSources).toEqual([
      exactSource('turn', 'message-1'),
    ]);
    expect(retirementLedgerCounts()).toEqual({
      groups: 2,
      requests: 2,
      sources: 2,
      contributions: 0,
      facts: 0,
    });
    expect(
      isMemorySourceWithdrawn({
        ...EXACT_SCOPE,
        sourceKind: 'run',
        sourceId: 'message-1',
      }),
    ).toBe(false);
  });

  it('does not apply a foreign-owner tombstone to the local memory vault', () => {
    expect(() =>
      retireExactMemorySources({
        reason: 'message_delete',
        requestedSources: [
          {
            ...exactSource('message', 'foreign-only-message'),
            memoryOwnerId: 'foreign-owner',
          },
        ],
        retiredAt: 101,
        retirementGroupId: 'foreign-owner-retirement',
      }),
    ).toThrow('memory_source_retirement_requested_sources_invalid');

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
    retireSource('null-task-retirement', 'message', 'task-sensitive-message', null);

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
