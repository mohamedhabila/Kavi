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
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';

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
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_fact_contribution_sources')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toBeNull();
    expect(tableCount('memory_entities')).toBe(0);
    expect(tableCount('memory_working_blocks')).toBe(0);
    expect(
      JSON.stringify({
        groups: getMemoryDb().getAllSync('SELECT * FROM memory_source_retirement_groups'),
        requests: getMemoryDb().getAllSync('SELECT * FROM memory_source_retirement_requests'),
        sources: getMemoryDb().getAllSync('SELECT * FROM memory_retired_sources'),
        contributions: getMemoryDb().getAllSync('SELECT * FROM memory_retired_fact_contributions'),
        facts: getMemoryDb().getAllSync('SELECT * FROM memory_retired_facts'),
      }),
    ).not.toContain('قيمة محفوظة');
    expect(getMemoryDb().getFirstSync('PRAGMA secure_delete')).toEqual({ secure_delete: 1 });
    expect(notifications).toBe(1);
    expect(mockClearEmbeddingCache).toHaveBeenCalled();

    resetCanonicalMemoryForManagement();
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
  });

  it('purges payload parents left by an earlier non-management retirement', () => {
    const seeded = seedContribution('reset-prior-retirement', {
      predicate: 'private-predicate',
      objectText: 'PRIVATE-PRIOR-RETIREMENT-SENTINEL',
    });
    expect(
      retireExactMemorySources({
        reason: 'message_edit',
        requestedSources: [seeded.messageSource],
        retiredAt: 500,
      }).status,
    ).toBe('retired');
    expect(tableCount('memory_fact_contributions')).toBe(1);
    expect(rowForFact(seeded.fact.id)?.object_text).toBe('PRIVATE-PRIOR-RETIREMENT-SENTINEL');
    getMemoryDb().runSync(
      `INSERT INTO memory_fact_legacy_quarantine(fact_id, reason, quarantined_at)
       VALUES (?, 'source_retired', 501)`,
      seeded.fact.id,
    );

    resetCanonicalMemoryForManagement();

    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_legacy_quarantine')).toBe(0);
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
    expect(
      JSON.stringify(getMemoryDb().getAllSync('SELECT * FROM memory_source_retirement_groups')),
    ).not.toContain('PRIVATE-PRIOR-RETIREMENT-SENTINEL');
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
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_facts')
        ?.count,
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
