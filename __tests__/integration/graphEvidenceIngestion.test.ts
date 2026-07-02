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
      threshold: 0.05,
    });

    expect(recalled.some((fact) => fact.objectText.includes(evidence))).toBe(true);
  });

  it('routes agent-run graph observations to compact run memories instead of raw fact bridging', async () => {
    const agentRunEvidence =
      'agent:' +
      JSON.stringify({
        kind: 'state',
        trajectory_id: 'traj-agent',
        state_index: 4,
        action: 'Run the analysis tool',
        thought: 'Need a durable artifact for the user.',
        outcome: 'reports/analysis.json was created',
        artifact: 'reports/analysis.json',
      });

    const result = await processIngestionTurn({
      threadId: THREAD_ID,
      messages: buildClosedTurnMessages(),
      taskId: TASK_ID,
      sourceRunId: 'run-graph-structured',
      graphGoalEvidence: [agentRunEvidence],
      skipWorkingMemorySync: true,
    });

    expect(result.agentRunMemoryFactIds.length).toBeGreaterThan(0);
    expect(result.bridgedEvidenceFactIds).toHaveLength(0);

    const typedFacts = listFacts({ originConversationId: THREAD_ID });
    expect(typedFacts.filter((fact) => fact.sourceRunId === 'traj-agent')).toHaveLength(2);
    expect(typedFacts.some((fact) => fact.memoryKind === 'procedure')).toBe(true);
    expect(typedFacts.some((fact) => fact.memoryKind === 'outcome')).toBe(true);
    expect(
      typedFacts.some(
        (fact) => fact.memoryKind === 'semantic_fact' && fact.objectText.includes(agentRunEvidence),
      ),
    ).toBe(false);
  });

  it('does not bridge malformed agent-run graph observations as semantic facts', async () => {
    const malformedAgentRunEvidence =
      'agent:{"kind":"state","trajectory_id":"traj-agent","state_index":4,';

    const result = await processIngestionTurn({
      threadId: THREAD_ID,
      messages: buildClosedTurnMessages(),
      taskId: TASK_ID,
      sourceRunId: 'run-graph-malformed',
      graphGoalEvidence: [malformedAgentRunEvidence],
      skipWorkingMemorySync: true,
    });

    expect(result.processed).toBe(true);
    expect(result.agentRunMemoryFactIds).toHaveLength(0);
    expect(result.bridgedEvidenceFactIds).toHaveLength(0);

    const storedFacts = listFacts({ originConversationId: THREAD_ID });
    expect(
      storedFacts.some(
        (fact) =>
          fact.memoryKind === 'semantic_fact' &&
          fact.objectText.includes(malformedAgentRunEvidence),
      ),
    ).toBe(false);
  });
});
