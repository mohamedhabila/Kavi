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

  it('routes structured graph observations to typed memories instead of raw fact bridging', async () => {
    const structuredEvidence =
      'agent:' +
      JSON.stringify({
        kind: 'state',
        trajectory_id: 'traj-ui',
        state_index: 4,
        outcome: 'failure',
        url: 'https://app.example.test/forum',
        accessibility_tree: "[12] searchbox 'Search query', clickable, visible",
      });

    const result = await processIngestionTurn({
      threadId: THREAD_ID,
      messages: buildClosedTurnMessages(),
      taskId: TASK_ID,
      sourceRunId: 'run-graph-structured',
      graphGoalEvidence: [structuredEvidence],
      skipWorkingMemorySync: true,
    });

    expect(result.structuredMemoryFactIds.length).toBeGreaterThan(0);
    expect(result.bridgedEvidenceFactIds).toHaveLength(0);

    const typedFacts = listFacts({ originConversationId: THREAD_ID });
    expect(typedFacts.some((fact) => fact.memoryKind === 'ui_inventory')).toBe(true);
    expect(typedFacts.some((fact) => fact.memoryKind === 'outcome')).toBe(true);
    expect(
      typedFacts.some(
        (fact) => fact.memoryKind === 'semantic_fact' && fact.objectText.includes(structuredEvidence),
      ),
    ).toBe(false);
  });

  it('does not bridge malformed structured observations as semantic facts', async () => {
    const malformedStructuredEvidence =
      'agent:' +
      JSON.stringify({
        kind: 'state',
        trajectory_id: 'traj-ui',
        accessibility_tree: "[12] searchbox 'Search query', clickable, visible",
      }).slice(0, -4);

    const result = await processIngestionTurn({
      threadId: THREAD_ID,
      messages: buildClosedTurnMessages(),
      taskId: TASK_ID,
      sourceRunId: 'run-graph-malformed',
      graphGoalEvidence: [malformedStructuredEvidence],
      skipWorkingMemorySync: true,
    });

    expect(result.structuredMemoryFactIds).toHaveLength(0);
    expect(result.bridgedEvidenceFactIds).toHaveLength(0);
    expect(
      listFacts({ originConversationId: THREAD_ID }).some((fact) =>
        fact.objectText.includes(malformedStructuredEvidence),
      ),
    ).toBe(false);
  });
});
