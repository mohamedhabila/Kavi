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

function buildClosedTurnMessages(userId = 'user-1', assistantId = 'assistant-1'): Message[] {
  return [
    {
      id: userId,
      role: 'user',
      content: 'Analyze the dataset and write reports/analysis.json',
      timestamp: 1,
    },
    {
      id: assistantId,
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

  it('does not reinforce graph evidence on turn replay but does on a later turn', async () => {
    const evidence = 'python:artifact:reports/analysis.json';
    const firstTurn = buildClosedTurnMessages('user-replay-1', 'assistant-replay-1');
    const input = {
      threadId: THREAD_ID,
      messages: firstTurn,
      taskId: TASK_ID,
      sourceRunId: 'run-graph-replay',
      graphGoalEvidence: [evidence],
      skipWorkingMemorySync: true,
    };

    await processIngestionTurn({ ...input, now: 100 });
    await processIngestionTurn({ ...input, now: 200 });

    const afterReplay = listFacts({ originConversationId: THREAD_ID }).find((fact) =>
      fact.objectText.includes(evidence),
    );
    expect(afterReplay).toMatchObject({
      sourceTurnId: 'assistant-replay-1',
      repeatedMentionCount: 0,
      updatedAt: 100,
    });

    await processIngestionTurn({
      ...input,
      messages: buildClosedTurnMessages('user-replay-2', 'assistant-replay-2'),
      sourceRunId: 'run-graph-later',
      now: 300,
    });
    await processIngestionTurn({
      ...input,
      messages: buildClosedTurnMessages('user-replay-2', 'assistant-replay-2'),
      sourceRunId: 'run-graph-later',
      now: 400,
    });

    const afterLaterTurn = listFacts({ originConversationId: THREAD_ID }).filter((fact) =>
      fact.objectText.includes(evidence),
    );
    expect(afterLaterTurn).toHaveLength(1);
    expect(afterLaterTurn[0]).toMatchObject({ repeatedMentionCount: 1, updatedAt: 300 });
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
        accessibility_tree: 'status panel: analysis complete; artifact reports/analysis.json ready',
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
    const agentRunFacts = typedFacts.filter(
      (fact) => fact.sourceRunId === 'traj-agent' && fact.memoryKind === 'agent_run',
    );
    const evidenceSpanFacts = typedFacts.filter(
      (fact) => fact.sourceRunId === 'traj-agent' && fact.memoryKind === 'evidence_span',
    );
    expect(agentRunFacts).toHaveLength(1);
    expect(evidenceSpanFacts.length).toBeGreaterThan(0);
    expect(evidenceSpanFacts.length).toBeLessThanOrEqual(8);
    expect(typedFacts.some((fact) => fact.objectText.includes('analysis complete'))).toBe(true);
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
