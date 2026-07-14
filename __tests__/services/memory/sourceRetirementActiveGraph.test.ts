const mockLoadVerifiedAggregates = jest.fn();

jest.mock('../../../src/services/memory/factContributionAggregateStore', () => ({
  loadVerifiedFactContributionAggregatesInTransaction: (...args: unknown[]) =>
    mockLoadVerifiedAggregates(...args),
}));

import type { MemoryDatabase } from '../../../src/services/memory/access/schemaGuard';
import { loadCompleteActiveRetirementGraphInTransaction } from '../../../src/services/memory/sourceRetirementActiveGraph';

function contributionId(index: number): string {
  return `mfc_${index.toString(16).padStart(64, '0')}`;
}

function databaseWithIds(ids: ReadonlyArray<string>): MemoryDatabase {
  return {
    getAllSync: jest.fn(() => ids.map((id) => ({ id }))),
  } as unknown as MemoryDatabase;
}

beforeEach(() => {
  mockLoadVerifiedAggregates.mockReset();
});

describe('source retirement active graph loading', () => {
  it('loads a complete graph in pages no larger than 128', () => {
    const ids = Array.from({ length: 257 }, (_, index) => contributionId(index));
    mockLoadVerifiedAggregates.mockImplementation(
      (_db: MemoryDatabase, page: ReadonlyArray<string>) => ({
        aggregates: page.map((id, index) => ({
          contributionId: id,
          contributedAt: index,
          factId: `fact-${id}`,
          payload: {},
          sourceAliases: [],
          supersessionPlan: { edges: [] },
        })),
        missingContributionIds: [],
      }),
    );

    const result = loadCompleteActiveRetirementGraphInTransaction(
      databaseWithIds(ids),
      'owner-active-graph',
    );

    expect(result).toHaveLength(257);
    expect(mockLoadVerifiedAggregates).toHaveBeenCalledTimes(3);
    expect(mockLoadVerifiedAggregates.mock.calls.map((call) => call[1].length)).toEqual([
      128, 128, 1,
    ]);
  });

  it('rejects a 4097th active contribution before loading evidence', () => {
    const ids = Array.from({ length: 4_097 }, (_, index) => contributionId(index));

    expect(() =>
      loadCompleteActiveRetirementGraphInTransaction(databaseWithIds(ids), 'owner-active-graph'),
    ).toThrow('memory_source_retirement_plan_resource_limit');
    expect(mockLoadVerifiedAggregates).not.toHaveBeenCalled();
  });

  it('enforces the global child budget across verified pages', () => {
    const ids = Array.from({ length: 129 }, (_, index) => contributionId(index));
    mockLoadVerifiedAggregates.mockImplementation(
      (_db: MemoryDatabase, page: ReadonlyArray<string>) => ({
        aggregates: page.map((id, index) => ({
          contributionId: id,
          contributedAt: index,
          factId: `fact-${id}`,
          payload: {},
          sourceAliases: Array.from({ length: 32 }, (_, aliasIndex) => ({
            sourceKind: 'message',
            sourceId: `source-${aliasIndex}`,
          })),
          supersessionPlan: { edges: [] },
        })),
        missingContributionIds: [],
      }),
    );

    expect(() =>
      loadCompleteActiveRetirementGraphInTransaction(databaseWithIds(ids), 'owner-active-graph'),
    ).toThrow('memory_source_retirement_plan_resource_limit');
    expect(mockLoadVerifiedAggregates).toHaveBeenCalledTimes(2);
  });

  it('fails closed when one discovered parent is missing from a verified page', () => {
    const ids = [contributionId(1), contributionId(2)];
    mockLoadVerifiedAggregates.mockReturnValue({
      aggregates: [
        {
          contributionId: ids[0],
          contributedAt: 1,
          factId: 'fact-missing',
          payload: {},
          sourceAliases: [],
          supersessionPlan: { edges: [] },
        },
      ],
      missingContributionIds: [ids[1]],
    });

    expect(() =>
      loadCompleteActiveRetirementGraphInTransaction(databaseWithIds(ids), 'owner-active-graph'),
    ).toThrow('memory_source_retirement_active_graph_incomplete');
  });

  it('rejects duplicate discovered identities without attempting evidence reads', () => {
    const id = contributionId(1);

    expect(() =>
      loadCompleteActiveRetirementGraphInTransaction(
        databaseWithIds([id, id]),
        'owner-active-graph',
      ),
    ).toThrow('memory_source_retirement_active_graph_invalid');
    expect(mockLoadVerifiedAggregates).not.toHaveBeenCalled();
  });
});
