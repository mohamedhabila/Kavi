jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeRetirementFixture,
  localOwnerId,
  resetRetirementFixture,
  seedContribution,
} from '../../helpers/sourceRetirementCoordinatorFixture';
import { getMemoryDb } from '../../../src/services/memory/database';
import { clearStructuredMemoryDatabase } from '../../../src/services/memory/schema';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';
import { CLEARED_STRUCTURED_MEMORY_TABLES } from '../../../src/services/memory/structuredMemoryTableRegistry';

beforeEach(resetRetirementFixture);
afterEach(closeRetirementFixture);

describe('privileged structured-memory database cleanup', () => {
  it('rebuilds immutable ledgers empty while preserving the vault identity', () => {
    const seeded = seedContribution('physical-reset');
    const ownerId = localOwnerId();
    retireExactMemorySources({
      reason: 'memory_reset',
      requestedSources: [seeded.messageSource],
      retiredAt: 500,
    });

    clearStructuredMemoryDatabase(getMemoryDb());

    for (const table of CLEARED_STRUCTURED_MEMORY_TABLES) {
      expect(
        getMemoryDb().getFirstSync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        )?.count,
      ).toBe(0);
    }
    expect(localOwnerId()).toBe(ownerId);

    const fresh = seedContribution('physical-reset');
    expect(() =>
      getMemoryDb().runSync(
        'DELETE FROM memory_fact_contributions WHERE id = ?',
        fresh.contributionId,
      ),
    ).toThrow('memory_fact_contribution_immutable');
  });
});
