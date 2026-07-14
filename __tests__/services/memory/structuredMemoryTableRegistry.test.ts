import {
  CLEARED_STRUCTURED_MEMORY_TABLES,
  FULL_RESET_DROPPED_RETIREMENT_TABLES,
  PRESERVED_STRUCTURED_MEMORY_TABLES,
  USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES,
  USER_RESET_PRESERVED_STRUCTURED_MEMORY_TABLES,
} from '../../../src/services/memory/structuredMemoryTableRegistry';

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

describe('structured memory reset table registry', () => {
  it('keeps every causal ledger and replay fence outside ordinary user deletion', () => {
    expect(
      intersection(
        USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES,
        USER_RESET_PRESERVED_STRUCTURED_MEMORY_TABLES,
      ),
    ).toEqual([]);
    expect(USER_RESET_PRESERVED_STRUCTURED_MEMORY_TABLES).toEqual(
      expect.arrayContaining([
        'memory_facts',
        'memory_fact_contributions',
        'memory_fact_contribution_sources',
        'memory_source_retirement_groups',
        'memory_source_retirement_requests',
        'memory_retired_sources',
        'memory_retired_fact_contributions',
        'memory_retired_facts',
      ]),
    );
  });

  it('classifies the complete retirement ledger for privileged physical cleanup', () => {
    expect(FULL_RESET_DROPPED_RETIREMENT_TABLES).toHaveLength(5);
    expect(CLEARED_STRUCTURED_MEMORY_TABLES).toEqual(
      expect.arrayContaining([...FULL_RESET_DROPPED_RETIREMENT_TABLES]),
    );
    expect(intersection(CLEARED_STRUCTURED_MEMORY_TABLES, PRESERVED_STRUCTURED_MEMORY_TABLES)).toEqual(
      [],
    );
  });

  it('contains no retired withdrawal compatibility tables', () => {
    const classified = [
      ...CLEARED_STRUCTURED_MEMORY_TABLES,
      ...PRESERVED_STRUCTURED_MEMORY_TABLES,
    ];
    expect(classified.some((table) => table.includes('withdrawal'))).toBe(false);
  });
});
