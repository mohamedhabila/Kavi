jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
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

describe('orchestrateMemoryRetrieval', () => {
  it('retrieves compact agent-run outcome and source procedure evidence together', async () => {
    const subject = upsertEntity({ name: 'analysis task', type: 'project', now: 1 });
    recordFact({
      subjectId: subject.id,
      predicate: 'agent_run_trace',
      objectText: JSON.stringify({
        sourceRunId: 'run-analysis',
        goal: 'Analyze the dataset',
        steps: [{ action: 'Run python analysis', toolName: 'python' }],
      }),
      memoryKind: 'procedure',
      sourceRunId: 'run-analysis',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.9,
      importance: 0.8,
      now: 2,
    });
    recordFact({
      subjectId: subject.id,
      predicate: 'agent_run_result',
      objectText: JSON.stringify({
        sourceRunId: 'run-analysis',
        goal: 'Analyze the dataset',
        outcome: 'reports/analysis.json was created',
        artifacts: ['reports/analysis.json'],
      }),
      memoryKind: 'outcome',
      sourceRunId: 'run-analysis',
      originConversationId: 'conv-retrieval',
      scope: 'conversation',
      retrievability: 0.95,
      importance: 0.85,
      now: 3,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'Where is the analysis json artifact?',
      conversationId: 'conv-retrieval',
      limit: 4,
      now: 4,
    });

    expect(result.facts.some((fact) => fact.memoryKind === 'outcome')).toBe(true);
    expect(result.facts.some((fact) => fact.memoryKind === 'procedure')).toBe(true);
    expect(result.facts.every((fact) => fact.memoryKind !== 'semantic_fact')).toBe(true);
  });
});
