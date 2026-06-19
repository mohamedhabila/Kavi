import {
  clearBudgetAuditForTests,
  getRecentBudgetAuditEntries,
  recordBudgetAuditEntry,
} from '../../../src/services/context/budgetAudit';

describe('budgetAudit', () => {
  beforeEach(() => {
    clearBudgetAuditForTests();
  });

  it('records bounded per-turn layer usage', () => {
    recordBudgetAuditEntry({
      conversationId: 'conv-1',
      iteration: 2,
      model: 'gpt-5.4',
      layers: {
        system: 1200,
        tools: 800,
        messages: 6400,
        memory_cacheable: 300,
        memory_dynamic: 120,
        goals: 90,
      },
      totalTokens: 8910,
      contextWindow: 128_000,
      compactionApplied: true,
    });

    const entries = getRecentBudgetAuditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.layers.goals).toBe(90);
    expect(entries[0]?.compactionApplied).toBe(true);
  });
});