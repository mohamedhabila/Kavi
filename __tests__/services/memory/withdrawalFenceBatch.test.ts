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
  MemoryPersistenceSourceWithdrawnError,
} from '../../../src/services/memory/withdrawalFence';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const scope = {
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  taskId: 'task-1',
};

function retireSource(
  retirementGroupId: string,
  sourceKind: 'message' | 'turn' | 'run',
  sourceId: string,
): void {
  retireExactMemorySources({
    reason: 'message_delete',
    requestedSources: [
      {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        ...scope,
        sourceKind,
        sourceId,
      },
    ],
    retiredAt: 100,
    retirementGroupId,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

it('checks every exact source in one batched retirement query', () => {
  retireSource('retirement-1', 'run', 'run-retired');
  const db = getMemoryDb();
  const querySpy = jest.spyOn(db, 'getFirstSync');

  let thrown: unknown;
  try {
    assertMemoryPersistenceSourcesAreWritable(scope, [
      { sourceKind: 'message', sourceId: 'message-current' },
      { sourceKind: 'turn', sourceId: 'turn-current' },
      { sourceKind: 'run', sourceId: 'run-retired' },
    ]);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(MemoryPersistenceSourceWithdrawnError);
  expect(thrown).toMatchObject({ code: 'memory_persistence_source_withdrawn' });
  expect(
    querySpy.mock.calls.filter(([sql]) =>
      typeof sql === 'string' ? sql.includes('FROM memory_retired_sources') : false,
    ),
  ).toHaveLength(1);
});

it('does not broaden retirement across source kind or scope', () => {
  retireSource('retirement-2', 'message', 'shared-id');

  expect(() =>
    assertMemoryPersistenceSourcesAreWritable(scope, [
      { sourceKind: 'run', sourceId: 'shared-id' },
    ]),
  ).not.toThrow();
  expect(() =>
    assertMemoryPersistenceSourcesAreWritable({ ...scope, sourceThreadId: 'thread-2' }, [
      { sourceKind: 'message', sourceId: 'shared-id' },
    ]),
  ).not.toThrow();
});
