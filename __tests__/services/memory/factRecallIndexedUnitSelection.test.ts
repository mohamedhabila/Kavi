jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recallScoredTestFacts as recallScoredFactsForQuery,
  recordRecallTestFact as recordFact,
} from '../../helpers/memoryRecallTestHarness';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
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
  expoSqlite.__resetExpoSqliteForTests();
});

describe('recallFactsForQuery - indexed unit selection', () => {
  it('does not let absent query units crowd out a rare indexed memory', async () => {
    const corpus = upsertEntity({ name: 'indexed-unit-selection-corpus', type: 'concept' });
    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'target',
      objectText: 'qrarecandidate qactioncontext qanswercontext',
      sourceRunId: 'run-target',
      now: 1_000,
    });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `common_${index}`,
        objectText: `qsharedcandidate qcommoncandidate qnoise${index}`,
        sourceRunId: `run-common-${index}`,
        now: 2_000 + index,
      });
    }

    const absentUnits = Array.from({ length: 36 }, (_, index) => `qabsentcandidate${index}`);
    const scored = await recallScoredFactsForQuery(
      `${absentUnits.join(' ')} qrarecandidate qsharedcandidate`,
      {
        limit: 1,
        threshold: 0,
        candidatePoolLimit: 40,
      },
    );

    expect(scored.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(scored[0].textScore).toBeGreaterThan(0);
  });

  it('keeps late workflow-defining units in long user requests', async () => {
    const corpus = upsertEntity({ name: 'indexed-workflow-coverage-corpus', type: 'concept' });
    const conversationId = 'conv-indexed-workflow-coverage';
    const setupUnits = Array.from({ length: 28 }, (_, index) => `qsetup${index}`);

    for (let index = 0; index < 80; index += 1) {
      recordFact({
        subjectId: corpus.id,
        predicate: `noise_${index}`,
        objectText: `qsetup0 qsetup1 qsetup2 qnoise${index}`,
        scope: 'conversation',
        originConversationId: conversationId,
        now: 10_000 + index,
      });
    }

    const target = recordFact({
      subjectId: corpus.id,
      predicate: 'workflow',
      objectText: 'qworkflowstage qworkflowtarget qworkflowanswer',
      scope: 'conversation',
      originConversationId: conversationId,
      now: 1,
    });

    const scored = await recallScoredFactsForQuery(
      `${setupUnits.join(' ')} qworkflowstage qworkflowtarget qworkflowanswer`,
      {
        limit: 3,
        candidatePoolLimit: 64,
        threshold: 0.01,
        now: 20_000,
      },
      { memoryConversationId: conversationId, sourceThreadId: conversationId },
    );

    expect(scored.some((entry) => entry.fact.id === target.fact.id)).toBe(true);
  });
});
