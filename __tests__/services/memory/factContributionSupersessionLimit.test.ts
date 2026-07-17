jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES } from '../../../src/services/memory/factContributionChildCommitments';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;

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

describe('fact contribution supersession limit', () => {
  it('rejects an oversized child set before invalidating any predecessor', () => {
    const subjectId = upsertEntity({ type: 'self', name: 'user', now: 1 }).id;
    for (let index = 0; index <= MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES; index += 1) {
      recordFactWithApplicability(
        {
          subjectId,
          predicate: 'favorite_color',
          objectText: `color-${index}`,
          scope: 'global',
          sourceMessageId: `prior-message-${index}`,
          sourceTurnId: `prior-turn-${index}`,
          now: 100 + index,
        },
        grounded,
      );
    }

    expect(() =>
      recordFactWithContribution(
        {
          subjectId,
          predicate: 'favorite_color',
          objectText: 'replacement',
          scope: 'global',
          sourceMessageId: 'replacement-message',
          sourceTurnId: 'replacement-turn',
          supersedePrior: true,
          now: 1_000,
        },
        grounded,
        {
          memoryConversationId: 'conversation-1',
          sourceThreadId: 'thread-1',
          producer: {
            producerId: 'supersession_limit_test',
            producerEventId: 'oversized-supersession',
          },
          sourceAliases: [
            { sourceKind: 'message', sourceId: 'replacement-message' },
            { sourceKind: 'turn', sourceId: 'replacement-turn' },
          ],
        },
      ),
    ).toThrow('memory_fact_supersession_limit_exceeded');
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE invalid_at IS NULL',
      )?.count,
    ).toBe(MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES + 1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(0);
  });
});
