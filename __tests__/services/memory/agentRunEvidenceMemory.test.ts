jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { recordAgentRunEvidenceMemory } from '../../../src/services/memory/agentRunEvidenceMemory';
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

describe('recordAgentRunEvidenceMemory', () => {
  it('stores one compact procedure and one compact outcome per source run', () => {
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-1',
        goal: 'Analyze the dataset',
        state_index: 1,
        action: 'Run analysis',
        thought: 'Need a durable report artifact.',
        toolName: 'python',
      })}`,
      `agent:${JSON.stringify({
        trajectory_id: 'run-1',
        state_index: 2,
        outcome: 'reports/analysis.json was created',
        artifact: 'reports/analysis.json',
      })}`,
    ];

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(2);
    expect(result.factIds).toHaveLength(2);

    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    expect(facts.map((fact) => fact.memoryKind).sort()).toEqual(['outcome', 'procedure']);
    expect(facts.every((fact) => fact.sourceRunId === 'run-1')).toBe(true);
    expect(facts.some((fact) => fact.objectText.includes('reports/analysis.json'))).toBe(true);
  });

  it('does not consume non-json graph evidence that belongs to durable fact bridging', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: ['python:artifact:reports/analysis.json'],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
  });

  it('does not create empty run records from unrelated json payloads', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [`agent:${JSON.stringify({ trajectory_id: 'run-empty', value: 42 })}`],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceRunId: 'fallback-run',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
  });
});
