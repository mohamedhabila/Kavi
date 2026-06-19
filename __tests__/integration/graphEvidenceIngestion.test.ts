jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { listFacts } from '../../src/services/memory/facts/queries';
import { recallFactsForQuery } from '../../src/services/memory/factRecall';
import { processIngestionTurn } from '../../src/services/memory/turnProcessor';
import type { Message } from '../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const THREAD_ID = 'conv-graph-evidence';
const TASK_ID = 'goal-analysis';

function buildClosedTurnMessages(): Message[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: 'Analyze the dataset and write reports/analysis.json',
      timestamp: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Analysis complete.',
      timestamp: 2,
      assistantMetadata: {
        finishReason: 'stop',
        kind: 'final',
        completionStatus: 'complete',
      },
    },
  ];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('graph evidence ingestion bridge', () => {
  it('bridges graph goal evidence during ingestion and recalls it on a later query', async () => {
    const evidence = 'python:artifact:reports/analysis.json';

    const result = await processIngestionTurn({
      threadId: THREAD_ID,
      messages: buildClosedTurnMessages(),
      taskId: TASK_ID,
      sourceRunId: 'run-graph-1',
      graphGoalEvidence: [evidence],
      skipWorkingMemorySync: true,
    });

    expect(result.processed).toBe(true);
    expect(result.bridgedEvidenceFactIds).toHaveLength(1);

    const storedFacts = listFacts({ originConversationId: THREAD_ID });
    expect(storedFacts.some((fact) => fact.objectText.includes(evidence))).toBe(true);
    expect(storedFacts.some((fact) => fact.originTaskId === TASK_ID)).toBe(true);

    const recalled = await recallFactsForQuery('python artifact reports analysis json', {
      conversationId: THREAD_ID,
      textWeight: 1,
      vectorWeight: 0,
      threshold: 0.05,
    });

    expect(recalled.some((fact) => fact.objectText.includes(evidence))).toBe(true);
  });
});
