jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { applyConsolidatorResult } from '../../../src/services/memory/consolidator';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

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

describe('memory consolidator source-run provenance', () => {
  it('persists sourceRunId on consolidated semantic facts', () => {
    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'Lumen Orchard',
            predicate: 'codename',
            value: 'Lumen Orchard',
            scope: 'project',
          },
        ],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        conversationId: 'conv-source-run',
        threadId: 'thread-source-run',
        sourceRunId: 'run-source-run',
        skipWorkingMemoryWrites: true,
      },
    );

    expect(result.recordedFactIds).toHaveLength(1);
    const facts = listFacts({ originConversationId: 'conv-source-run' });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.sourceRunId).toBe('run-source-run');
    expect(facts[0]?.originTaskId).toBeNull();
  });
});
