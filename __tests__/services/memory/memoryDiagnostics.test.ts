import {
  clearBudgetAuditForTests,
  recordBudgetAuditEntry,
} from '../../../src/services/context/budgetAudit';
import {
  formatBudgetLayerBreakdown,
  formatRetrievalIdList,
  loadMemoryDiagnosticsSnapshot,
} from '../../../src/services/memory/memoryDiagnostics';
import {
  buildMemoryRetrievalQueryFingerprint,
  buildMemoryRetrievalScopeHash,
  recordMemoryRetrievalEvent,
} from '../../../src/services/memory/retrievalLog';
import * as memoryPolicy from '../../../src/services/memory/policy';
import * as retrievalLog from '../../../src/services/memory/retrievalLog';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as sqliteStore from '../../../src/services/memory/sqlite-store';
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
  it('scopes content-free retrieval diagnostics to the active conversation hash', async () => {
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

    const queryFingerprint = await buildMemoryRetrievalQueryFingerprint('private query sentinel');
    const sourceThreadAHash = await buildMemoryRetrievalScopeHash('source_thread', 'conv-a');
    const sourceThreadBHash = await buildMemoryRetrievalScopeHash('source_thread', 'conv-b');
    const baseEvent = {
      operation: 'prompt_assembly' as const,
      mode: 'query' as const,
      outcome: 'completed' as const,
      queryFingerprint,
      counts: {
        candidateFactCount: 2,
        selectedFactCount: 2,
        selectedFactIds: ['fact-1', 'fact-2'],
        candidateEpisodeCount: 1,
        selectedEpisodeCount: 1,
        selectedEpisodeIds: ['ep-1'],
      },
      timings: {
        planMs: 1,
        factRecallMs: 2,
        episodeRecallMs: 1,
        candidateFetchMs: 1,
        scoreMs: 1,
        selectorMs: 0,
        evidenceExpansionMs: 0,
        totalMs: 4,
      },
      expansion: {
        outcome: 'not_requested' as const,
        requestedSourceCount: 0,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
      selector: { mode: 'deterministic' as const, outcome: 'not_requested' as const },
    };
    await recordMemoryRetrievalEvent({
      ...baseEvent,
      scope: {
        memoryConversationIdHash: null,
        sourceThreadIdHash: sourceThreadAHash,
        taskScopePresent: true,
      },
      createdAt: 1,
    });
    await recordMemoryRetrievalEvent({
      ...baseEvent,
      scope: {
        memoryConversationIdHash: null,
        sourceThreadIdHash: sourceThreadBHash,
        taskScopePresent: true,
      },
      counts: {
        ...baseEvent.counts,
        selectedFactCount: 1,
        selectedFactIds: ['fact-9'],
        selectedEpisodeCount: 0,
        selectedEpisodeIds: [],
      },
      createdAt: 2,
    });

    const snapshot = await loadMemoryDiagnosticsSnapshot({ threadId: 'conv-a' });

    expect(snapshot.budgetEntries).toHaveLength(1);
    expect(snapshot.budgetEntries[0].conversationId).toBe('conv-a');
    expect(snapshot.retrievalEntries).toHaveLength(1);
    expect(snapshot.retrievalEntries[0].counts.selectedFactIds).toEqual(['fact-1', 'fact-2']);
    expect(snapshot.retrievalEntries[0].scope.taskScopePresent).toBe(true);
    expect(JSON.stringify(snapshot.retrievalEntries)).not.toContain('private query sentinel');
  });

  it('returns empty retrieval rows when no conversation scope is provided', async () => {
    const snapshot = await loadMemoryDiagnosticsSnapshot();

    expect(snapshot.threadId).toBeNull();
    expect(snapshot.retrievalEntries).toEqual([]);
  });

  it('does not hash or access the retrieval store after long-term-memory opt-out', async () => {
    const policySpy = jest.spyOn(memoryPolicy, 'canReadLongTermMemory').mockReturnValue(false);
    const hashSpy = jest.spyOn(retrievalLog, 'buildMemoryRetrievalScopeHash');
    const readSpy = jest.spyOn(retrievalLog, 'readRecentMemoryRetrievalEvents');
    const databaseSpy = jest.spyOn(sqliteStore, 'getMemoryDb');
    try {
      const snapshot = await loadMemoryDiagnosticsSnapshot({ threadId: 'private-thread' });

      expect(snapshot.retrievalEntries).toEqual([]);
      expect(hashSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
      expect(databaseSpy).not.toHaveBeenCalled();
    } finally {
      policySpy.mockRestore();
      hashSpy.mockRestore();
      readSpy.mockRestore();
      databaseSpy.mockRestore();
    }
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
