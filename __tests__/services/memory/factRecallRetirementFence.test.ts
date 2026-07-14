jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  getFactById,
  getFactByIdForRecallCandidate,
} from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { recordContributionBackedFact } from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

it('never returns an immutable retired fact through the direct-id recall path', () => {
  const recorded = recordContributionBackedFact(
    {
      subjectId: 'direct-recall-subject',
      predicate: 'direct_recall_value',
      objectText: 'retired direct recall payload',
      scope: 'conversation',
      originConversationId: 'direct-recall-conversation',
      originThreadId: 'direct-recall-thread',
      sourceMessageId: 'direct-recall-message',
      sourceTurnId: 'direct-recall-turn',
      now: 100,
    },
    {
      memoryConversationId: 'direct-recall-conversation',
      sourceThreadId: 'direct-recall-thread',
      producerEventId: 'direct-recall-event',
    },
  );

  expect(withdrawMemoryFact(recorded.fact.id, 200)).toMatchObject({ status: 'withdrawn' });
  expect(getFactById(recorded.fact.id)).toMatchObject({ deletedAt: 200 });
  expect(getFactByIdForRecallCandidate(recorded.fact.id)).toBeNull();

  getMemoryDb().runSync(
    'UPDATE memory_facts SET invalid_at = NULL, deleted_at = NULL WHERE id = ?',
    recorded.fact.id,
  );
  expect(getFactByIdForRecallCandidate(recorded.fact.id)).toBeNull();
});
