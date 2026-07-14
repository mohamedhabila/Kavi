jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { admitLegacyFactContributions } from '../../../src/services/memory/factContributionAdmission';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  jest.restoreAllMocks();
});

describe('legacy fact admission scaling', () => {
  it('batches 1,000 accepted facts and aliases into bounded SQLite writes', () => {
    for (let index = 0; index < 1_000; index += 1) {
      recordFactWithApplicability(
        {
          subjectId: `subject-${index}`,
          predicate: 'legacy_scale_state',
          objectText: `value-${index}`,
          scope: 'session',
          originConversationId: 'scale-conversation',
          originThreadId: 'scale-thread',
          originTaskId: 'scale-task',
          sourceMessageId: `scale-message-${index}`,
          now: 100 + index,
        },
        { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      );
    }
    const db = getMemoryDb();
    db.execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
      DELETE FROM memory_fact_contribution_admission;
    `);
    const runSpy = jest.spyOn(db, 'runSync');
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(admitLegacyFactContributions(db, 2_000)).toMatchObject({
      admittedCount: 1_000,
      quarantinedCount: 0,
    });
    const ledgerInserts = runSpy.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        (sql.includes('INSERT INTO memory_fact_contributions(') ||
          sql.includes('INSERT INTO memory_fact_contribution_sources(')),
    );
    const parentBatchCount = Math.ceil(1_000 / Math.floor(800 / 19));
    const sourceBatchCount = Math.ceil(1_000 / Math.floor(800 / 7));
    expect(ledgerInserts).toHaveLength(parentBatchCount + sourceBatchCount);
    expect(ledgerInserts.every((call) => call.length - 1 <= 800)).toBe(true);
    const childSetReads = getAllSpy.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        (sql.includes('FROM memory_fact_contribution_sources') ||
          sql.includes('FROM memory_fact_contribution_supersession_snapshots') ||
          sql.includes('FROM memory_fact_contribution_supersessions')),
    );
    expect(childSetReads).toHaveLength(3);
  });
});
