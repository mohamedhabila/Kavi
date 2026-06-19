import {
  clearBudgetAuditForTests,
  recordBudgetAuditEntry,
} from '../../../src/services/context/budgetAudit';
import {
  formatBudgetLayerBreakdown,
  formatRetrievalIdList,
  loadMemoryDiagnosticsSnapshot,
} from '../../../src/services/memory/memoryDiagnostics';
import { logRetrieval } from '../../../src/services/memory/retrievalLog';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  clearBudgetAuditForTests();
});

afterEach(() => {
  closeMemoryDb();
  clearBudgetAuditForTests();
});

describe('memoryDiagnostics', () => {
  it('scopes budget and retrieval diagnostics to the active conversation', () => {
    recordBudgetAuditEntry({
      conversationId: 'conv-a',
      iteration: 1,
      model: 'model-a',
      layers: {
        system: 10,
        tools: 5,
        messages: 100,
        memory_cacheable: 0,
        memory_dynamic: 0,
        goals: 2,
      },
      totalTokens: 117,
      contextWindow: 128000,
    });
    recordBudgetAuditEntry({
      conversationId: 'conv-b',
      iteration: 2,
      model: 'model-b',
      layers: {
        system: 20,
        tools: 0,
        messages: 200,
        memory_cacheable: 0,
        memory_dynamic: 0,
        goals: 0,
      },
      totalTokens: 220,
      contextWindow: 128000,
    });

    logRetrieval({
      threadId: 'conv-a',
      taskId: 'goal-1',
      query: 'secret user query text',
      factIds: ['fact-1', 'fact-2'],
      episodeIds: ['ep-1'],
      tokenEstimate: 42,
    });
    logRetrieval({
      threadId: 'conv-b',
      taskId: 'goal-2',
      query: 'other query',
      factIds: ['fact-9'],
      episodeIds: [],
      tokenEstimate: 12,
    });

    const snapshot = loadMemoryDiagnosticsSnapshot({ threadId: 'conv-a' });

    expect(snapshot.budgetEntries).toHaveLength(1);
    expect(snapshot.budgetEntries[0].conversationId).toBe('conv-a');
    expect(snapshot.retrievalEntries).toHaveLength(1);
    expect(snapshot.retrievalEntries[0].factIds).toEqual(['fact-1', 'fact-2']);
    expect(snapshot.retrievalEntries[0].taskId).toBe('goal-1');
  });

  it('returns empty retrieval rows when no conversation scope is provided', () => {
    logRetrieval({
      threadId: 'conv-a',
      query: 'query',
      factIds: ['fact-1'],
      episodeIds: [],
      tokenEstimate: 10,
    });

    const snapshot = loadMemoryDiagnosticsSnapshot();

    expect(snapshot.threadId).toBeNull();
    expect(snapshot.retrievalEntries).toEqual([]);
  });

  it('formats layer breakdown and id lists structurally', () => {
    expect(
      formatBudgetLayerBreakdown({
        system: 10,
        tools: 0,
        messages: 80,
        memory_cacheable: 5,
        memory_dynamic: 0,
        goals: 1,
      }),
    ).toBe('system:10 · messages:80 · memory_cacheable:5 · goals:1');

    expect(formatRetrievalIdList(['a', 'b', 'c', 'd'], 3)).toBe('a,b,c,+1');
    expect(formatRetrievalIdList([])).toBe('—');
  });
});