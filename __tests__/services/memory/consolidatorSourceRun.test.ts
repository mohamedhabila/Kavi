jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { applyThreadLocalConsolidatorResult } from '../../../src/services/memory/consolidator';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

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
    const result = applyThreadLocalConsolidatorResult(
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

    expect(result.recordedFacts).toHaveLength(1);
    const facts = listFacts({ originConversationId: 'conv-source-run' });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.sourceRunId).toBe('run-source-run');
    expect(facts[0]?.originTaskId).toBeNull();
  });

  it('rolls back the complete consolidation write when evidence persistence fails', () => {
    getMemoryDb().execSync(`
      CREATE TRIGGER reject_test_evidence
      BEFORE INSERT ON memory_fact_evidence
      BEGIN
        SELECT RAISE(ABORT, 'test evidence failure');
      END;
    `);

    expect(() =>
      applyThreadLocalConsolidatorResult(
        {
          episodeSummary: 'Prepared the release artifact.',
          newFacts: [
            {
              subject: 'release',
              predicate: 'artifact_path',
              value: '/workspace/release.aab',
              evidenceMessageIds: ['user-atomic'],
            },
          ],
          activeFocus: null,
          openThreads: [],
          notable: [],
        },
        {
          conversationId: 'conv-atomic',
          threadId: 'thread-atomic',
          sourceUserMessageId: 'user-atomic',
          sourceAssistantMessageId: 'assistant-atomic',
          messages: [
            { id: 'user-atomic', role: 'user', content: 'Prepare it.', timestamp: 1 },
            { id: 'assistant-atomic', role: 'assistant', content: 'Done.', timestamp: 2 },
          ],
          skipWorkingMemoryWrites: true,
        },
      ),
    ).toThrow('test evidence failure');

    for (const table of [
      'memory_entities',
      'memory_episodes',
      'memory_facts',
      'memory_fact_evidence',
      'memory_chunks',
    ]) {
      expect(
        getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
          ?.count,
      ).toBe(0);
    }
  });
});
