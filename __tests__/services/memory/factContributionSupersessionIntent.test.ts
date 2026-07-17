jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const applicability = {
  factClass: 'subjective_user',
  sourceAuthority: 'grounded_user',
} as const;

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

function context(eventId: string, messageId: string) {
  return {
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: null,
    producer: { producerId: 'supersession_intent_test', producerEventId: eventId },
    sourceAliases: [{ sourceKind: 'message' as const, sourceId: messageId }],
  };
}

describe('contributed supersession projection intent', () => {
  it('records explicit false and auto presence before normalizing the causal payload', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'blue',
        scope: 'global',
        sourceMessageId: 'message-1',
        now: 100,
      },
      applicability,
      context('event-1', 'message-1'),
    );
    const replacement = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'green',
        scope: 'global',
        sourceMessageId: 'message-2',
        pinned: false,
        reviewState: 'auto',
        supersedePrior: true,
        now: 200,
      },
      applicability,
      context('event-2', 'message-2'),
    );

    expect(replacement).toMatchObject({ status: 'created', superseded: [{ invalidAt: 200 }] });
    expect(
      getMemoryDb().getFirstSync(
        `SELECT pinned_input_explicit, review_state_input_explicit
           FROM memory_fact_contribution_supersession_snapshots
          WHERE successor_fact_id = ?`,
        replacement.fact.id,
      ),
    ).toEqual({ pinned_input_explicit: 1, review_state_input_explicit: 1 });
    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();
  });
});
