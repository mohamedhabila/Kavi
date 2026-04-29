import {
  applyMemoryCascade,
  computeLayeredBudget,
  selectFactsWithinBudget,
  LAYERED_L1_TOOLS_CAP,
  LAYERED_L3_FOCUS_CAP,
  LAYERED_L4_USER_TURN_CAP,
} from '../../../src/services/context/layeredBudget';
import type { MemoryFact } from '../../../src/services/memory/facts';

function fact(overrides: Partial<MemoryFact> & { id: string; objectText?: string }): MemoryFact {
  return {
    id: overrides.id,
    subjectId: overrides.subjectId ?? 'user-1',
    predicate: overrides.predicate ?? 'lives_in',
    objectText: overrides.objectText ?? 'somewhere',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: null,
    contentHash: overrides.id,
    embedding: null,
    validAt: 0,
    invalidAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    pinned: overrides.pinned ?? false,
  };
}

describe('computeLayeredBudget', () => {
  it('allocates the documented per-layer shares', () => {
    const budget = computeLayeredBudget('claude-3-5-sonnet-20241022', 4096);
    // Sum of layer caps must not exceed totalAvailable.
    const layerSum = budget.l1Tools + budget.l2System + budget.l3Focus + budget.l4UserTurn;
    expect(layerSum).toBeLessThanOrEqual(budget.totalAvailable);
    // L2 must be the biggest pool.
    expect(budget.l2System).toBeGreaterThan(budget.l1Tools);
    expect(budget.l2System).toBeGreaterThan(budget.l3Focus);
    expect(budget.l2System).toBeGreaterThan(budget.l4UserTurn);
    // Output reserve floors at MIN_OUTPUT_RESERVE.
    expect(budget.outputReserve).toBeGreaterThanOrEqual(4096);
  });

  it('honours the hard caps on small contexts when shares are within limits', () => {
    // For a 200K-context model with maxTokens=4096:
    // available ~= 200K - 4096 = ~196k. L1 share = 0.15 * 196k ~= 29.4k → capped at 12,000.
    const budget = computeLayeredBudget('claude-3-5-sonnet-20241022', 4096);
    expect(budget.l1Tools).toBeLessThanOrEqual(LAYERED_L1_TOOLS_CAP);
    expect(budget.l3Focus).toBeLessThanOrEqual(LAYERED_L3_FOCUS_CAP);
    expect(budget.l4UserTurn).toBeLessThanOrEqual(LAYERED_L4_USER_TURN_CAP);
  });

  it('floors output reserve at MIN_OUTPUT_RESERVE even when maxTokens is small', () => {
    const budget = computeLayeredBudget('claude-3-5-sonnet-20241022', 1);
    expect(budget.outputReserve).toBe(4096);
  });
});

describe('selectFactsWithinBudget', () => {
  it('keeps every pinned fact even when they exceed the cap', () => {
    const facts = [
      fact({ id: 'a', objectText: 'aaaaaaaaaaaa', pinned: true }),
      fact({ id: 'b', objectText: 'bbbbbbbbbbbb', pinned: true }),
      fact({ id: 'c', objectText: 'cccccccccccc', pinned: true }),
    ];
    const { retained, droppedCount } = selectFactsWithinBudget(facts, 1);
    expect(retained.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(droppedCount).toBe(0);
  });

  it('drops trailing non-pinned facts past the budget', () => {
    const facts = [
      fact({ id: 'a', objectText: 'short' }),
      fact({ id: 'b', objectText: 'short' }),
      fact({ id: 'c', objectText: 'a much longer string of text that costs more tokens overall' }),
    ];
    // Tight budget — only the first short fact should fit.
    const { retained, droppedCount } = selectFactsWithinBudget(facts, 6);
    expect(retained.length).toBeGreaterThanOrEqual(1);
    expect(droppedCount).toBe(facts.length - retained.length);
    // Result preserves caller order.
    const indices = retained.map((f) => facts.indexOf(f));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('returns all facts when the budget is comfortable', () => {
    const facts = [fact({ id: 'a' }), fact({ id: 'b' })];
    const { retained, droppedCount } = selectFactsWithinBudget(facts, 10_000);
    expect(retained).toHaveLength(2);
    expect(droppedCount).toBe(0);
  });

  it('handles an empty input', () => {
    expect(selectFactsWithinBudget([], 1000)).toEqual({
      retained: [],
      droppedCount: 0,
      estimatedTokens: 0,
    });
  });
});

describe('applyMemoryCascade', () => {
  const baseBudget = computeLayeredBudget('claude-3-5-sonnet-20241022', 4096);

  it('returns no recommendations when usage fits', () => {
    const result = applyMemoryCascade({
      budget: baseBudget,
      current: { l1Tools: 100, l2System: 1000, l3Focus: 100, l4UserTurn: 100 },
    });
    expect(result.withinBudget).toBe(true);
    expect(result.recommendations).toEqual([]);
  });

  it('step 1: drops retrieved facts when L3 is over its cap', () => {
    // Each fact has a long objectText (~250 chars ~= 60 tokens). 80 facts
    // ~= 4,800 tokens — well above the L3 cap of 1,800.
    const longText = 'value-payload-words-words-words-'.repeat(8);
    const facts = Array.from({ length: 80 }, (_, i) =>
      fact({ id: `f${i}`, objectText: `${longText}-${i}` }),
    );
    const result = applyMemoryCascade({
      budget: baseBudget,
      current: {
        l1Tools: 100,
        l2System: 1000,
        l3Focus: baseBudget.l3Focus + 5_000,
        l4UserTurn: 100,
      },
      retrievedFacts: facts,
    });
    expect(result.recommendations[0].action).toBe('drop_retrieved_facts');
    expect(result.retainedFacts.length).toBeLessThan(facts.length);
  });

  it('step 2: recommends L2 buffer-tail windowing when L2 over cap and total over budget', () => {
    const result = applyMemoryCascade({
      budget: baseBudget,
      current: {
        l1Tools: baseBudget.l1Tools,
        l2System: baseBudget.l2System + 50_000,
        l3Focus: baseBudget.l3Focus,
        l4UserTurn: baseBudget.l4UserTurn,
      },
    });
    const actions = result.recommendations.map((r) => r.action);
    expect(actions).toContain('window_buffer_tail');
    // Cascade order — window_buffer_tail must precede compress_l2_blocks/tier2 if both present.
    if (actions.includes('compress_l2_blocks')) {
      expect(actions.indexOf('window_buffer_tail')).toBeLessThan(actions.indexOf('compress_l2_blocks'));
    }
  });

  it('escalates to tier-2 then tier-3 on heavy overshoot', () => {
    const result = applyMemoryCascade({
      budget: baseBudget,
      current: {
        l1Tools: baseBudget.l1Tools,
        l2System: baseBudget.l2System + baseBudget.totalAvailable,
        l3Focus: baseBudget.l3Focus,
        l4UserTurn: baseBudget.l4UserTurn,
      },
    });
    const actions = result.recommendations.map((r) => r.action);
    expect(actions).toContain('tier2_compaction');
    expect(actions).toContain('tier3_compaction');
    expect(actions.indexOf('tier2_compaction')).toBeLessThan(actions.indexOf('tier3_compaction'));
  });

  it('does not recommend tier-3 when overshoot is mild', () => {
    const result = applyMemoryCascade({
      budget: baseBudget,
      current: {
        l1Tools: baseBudget.l1Tools,
        l2System: baseBudget.l2System + 1_000,
        l3Focus: baseBudget.l3Focus,
        l4UserTurn: baseBudget.l4UserTurn,
      },
    });
    const actions = result.recommendations.map((r) => r.action);
    expect(actions).not.toContain('tier3_compaction');
  });
});
