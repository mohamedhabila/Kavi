jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockClearEmbeddingCache = jest.fn();
const mockGetEmbeddingCacheEntryCount = jest.fn();

jest.mock('../../../src/services/memory/embeddings', () => ({
  clearEmbeddingCache: () => mockClearEmbeddingCache(),
  getEmbeddingCacheEntryCount: () => mockGetEmbeddingCacheEntryCount(),
}));

import {
  closeRetirementFixture,
  resetRetirementFixture,
  rowForFact,
  seedContribution,
  tableCount,
} from '../../helpers/sourceRetirementCoordinatorFixture';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { getMemoryDb } from '../../../src/services/memory/database';
import { resetCanonicalMemoryForManagement } from '../../../src/services/memory/memoryReset';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEmbeddingCacheEntryCount.mockReturnValue(0);
  resetRetirementFixture();
});

afterEach(closeRetirementFixture);

function insertWorkingBlock(): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_working_blocks(
       label, scope_key, conversation_id, thread_id, task_id, content,
       char_limit, description, prompt_eligibility, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'trusted_structural', ?)`,
    'active_focus',
    'conversation:conversation-retirement',
    'conversation-retirement',
    'thread-retirement',
    'حالة مؤقتة',
    256,
    'derived state',
    100,
  );
}

describe('canonical memory management reset', () => {
  it('retires exact causal sources, preserves replay fences, and clears derived state', () => {
    const seeded = seedContribution('reset-one', {
      predicate: '状态',
      objectText: 'قيمة محفوظة',
    });
    insertWorkingBlock();
    let notifications = 0;
    const unsubscribe = subscribeToMemoryChanges(() => {
      notifications += 1;
    });

    resetCanonicalMemoryForManagement();
    unsubscribe();

    expect(
      getMemoryDb().getFirstSync('SELECT reason FROM memory_source_retirement_groups'),
    ).toEqual({ reason: 'memory_reset' });
    expect(tableCount('memory_source_retirement_requests')).toBe(2);
    expect(tableCount('memory_retired_sources')).toBe(2);
    expect(tableCount('memory_retired_fact_contributions')).toBe(1);
    expect(tableCount('memory_retired_facts')).toBe(1);
    expect(tableCount('memory_fact_contributions')).toBe(1);
    expect(tableCount('memory_fact_contribution_sources')).toBe(2);
    expect(rowForFact(seeded.fact.id)).toMatchObject({
      invalid_at: expect.any(Number),
      deleted_at: expect.any(Number),
    });
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_working_blocks')).toBe(0);
    expect(notifications).toBe(1);
    expect(mockClearEmbeddingCache).toHaveBeenCalled();

    resetCanonicalMemoryForManagement();
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
  });

  it('processes more than one 256-source request without widening source identity', () => {
    for (let index = 0; index < 257; index += 1) {
      seedContribution(`reset-batch-${index}`, {
        predicate: `字段-${index}`,
        objectText: `قيمة-${index}`,
      });
    }

    resetCanonicalMemoryForManagement();

    expect(tableCount('memory_source_retirement_groups')).toBe(2);
    expect(tableCount('memory_source_retirement_requests')).toBe(258);
    expect(tableCount('memory_retired_sources')).toBe(514);
    expect(tableCount('memory_retired_fact_contributions')).toBe(257);
    expect(tableCount('memory_retired_facts')).toBe(257);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_facts
          WHERE invalid_at IS NULL OR deleted_at IS NULL`,
      )?.count,
    ).toBe(0);
  });

  it('rolls the retirement ledger and projections back when cache cleanup fails', () => {
    const seeded = seedContribution('reset-cache-failure');
    mockGetEmbeddingCacheEntryCount.mockReturnValue(1);
    let notifications = 0;
    const unsubscribe = subscribeToMemoryChanges(() => {
      notifications += 1;
    });

    expect(() => resetCanonicalMemoryForManagement()).toThrow(
      'memory_reset_embedding_cache_residual',
    );
    unsubscribe();

    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(tableCount('memory_retired_sources')).toBe(0);
    expect(tableCount('memory_retired_fact_contributions')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toMatchObject({ invalid_at: null, deleted_at: null });
    expect(notifications).toBe(0);
  });
});
