jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { admitLegacyFactContributions } from '../../../src/services/memory/factContributionAdmission';
import {
  recordFactWithApplicability,
  recordFactWithContribution,
} from '../../../src/services/memory/facts/mutations';
import {
  addFactEvidence,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  clearStructuredMemory,
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
});

function reopenLegacyBoundary(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
    DELETE FROM memory_fact_contribution_admission;
  `);
}

function exactConversationLegacyFact(predicate: string) {
  const subject = upsertEntity({ name: 'user', type: 'self', now: 100 });
  const fact = recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate,
      objectText: 'legacy value',
      scope: 'conversation',
      originConversationId: 'legacy-conversation',
      originThreadId: 'legacy-thread',
      sourceMessageId: `${predicate}-message`,
      sourceTurnId: `${predicate}-turn`,
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
  const messageId = `${predicate}-message`;
  const turnId = `${predicate}-turn`;
  const episode = recordThreadLocalEpisode({
    conversationId: 'legacy-conversation',
    threadId: 'legacy-thread',
    taskId: null,
    summary: 'Exact legacy evidence.',
    messageIds: [messageId, turnId],
    sourceStartMessageId: messageId,
    sourceEndMessageId: turnId,
    now: 101,
  });
  addFactEvidence({
    factId: fact.id,
    episodeId: episode!.id,
    messageId,
    role: 'user',
    quote: 'Exact legacy evidence.',
    now: 101,
  });
  return fact;
}

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

describe('fact contribution admission integrity', () => {
  it('quarantines a legacy fact whose exact source was already retired', () => {
    const fact = exactConversationLegacyFact('retired_source');
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    db.runSync(
      `INSERT INTO memory_source_retirement_groups(id, reason, retired_at)
       VALUES ('legacy-retirement', 'message_deleted', 150)`,
    );
    db.runSync(
      `INSERT INTO memory_retired_sources(
         retirement_group_id, memory_owner_id, memory_conversation_id,
         source_thread_id, task_id, source_kind, source_id
       ) VALUES ('legacy-retirement', ?, 'legacy-conversation', 'legacy-thread', '',
                 'message', 'retired_source-message')`,
      memoryOwnerId,
    );
    reopenLegacyBoundary();

    expect(admitLegacyFactContributions(db, 500)).toMatchObject({
      admittedCount: 0,
      quarantinedCount: 1,
    });
    expect(
      db.getFirstSync<{ fact_id: string; reason: string }>(
        'SELECT fact_id, reason FROM memory_fact_legacy_quarantine',
      ),
    ).toEqual({ fact_id: fact.id, reason: 'source_retired' });
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('rolls back every mutation when contribution persistence fails', () => {
    const fact = exactConversationLegacyFact('rollback');
    reopenLegacyBoundary();
    getMemoryDb().execSync(`
      CREATE TRIGGER force_legacy_admission_failure
      BEFORE INSERT ON memory_fact_contributions
      BEGIN
        SELECT RAISE(ABORT, 'forced_legacy_admission_failure');
      END;
    `);

    expect(() => admitLegacyFactContributions(getMemoryDb(), 500)).toThrow(
      'forced_legacy_admission_failure',
    );
    expect(tableCount('memory_fact_contribution_admission')).toBe(0);
    expect(tableCount('memory_fact_legacy_quarantine')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      ),
    ).toEqual({ deleted_at: null });
  });

  it('rolls back staged quarantine mutations when persistence fails', () => {
    const subject = upsertEntity({ name: 'user', type: 'self', now: 100 });
    const fact = recordFactWithApplicability(
      {
        subjectId: subject.id,
        predicate: 'quarantine_rollback',
        objectText: 'unproven',
        scope: 'global',
        sourceMessageId: 'quarantine-rollback-message',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    reopenLegacyBoundary();
    getMemoryDb().execSync(`
      CREATE TRIGGER force_legacy_quarantine_failure
      BEFORE INSERT ON memory_fact_legacy_quarantine
      BEGIN
        SELECT RAISE(ABORT, 'forced_legacy_quarantine_failure');
      END;
    `);

    expect(() => admitLegacyFactContributions(getMemoryDb(), 500)).toThrow(
      'forced_legacy_quarantine_failure',
    );
    expect(tableCount('memory_fact_contribution_admission')).toBe(0);
    expect(tableCount('memory_fact_legacy_quarantine')).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM memory_facts WHERE id = ?',
        fact.id,
      ),
    ).toEqual({ deleted_at: null });
  });

  it('fails schema readiness if an unbacked fact appears after the completed boundary', () => {
    exactConversationLegacyFact('post_boundary_raw_write');

    expect(() => admitLegacyFactContributions(getMemoryDb(), 500)).toThrow(
      'memory_fact_contribution_admission_integrity_failed',
    );
    expect(tableCount('memory_fact_contribution_admission')).toBe(1);
    expect(tableCount('memory_fact_contributions')).toBe(0);
  });

  it('fails closed when an immutable contribution payload is externally corrupted', () => {
    const fact = exactConversationLegacyFact('corrupt_payload');
    reopenLegacyBoundary();
    admitLegacyFactContributions(getMemoryDb(), 500);
    getMemoryDb().execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_immutable;
      UPDATE memory_fact_contributions
         SET payload_sha256 = '${'0'.repeat(64)}'
       WHERE fact_id = '${fact.id}';
    `);

    expect(() => admitLegacyFactContributions(getMemoryDb(), 600)).toThrow(
      'memory_fact_contribution_admission_integrity_failed',
    );
  });

  it('fails closed on an orphan supersession edge and permits explicit recovery', () => {
    getMemoryDb().execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;
      INSERT INTO memory_fact_contribution_supersessions(
        contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
      ) VALUES ('orphan-contribution', 'orphan-predecessor', 'orphan-successor', 100);
    `);

    expect(() => admitLegacyFactContributions(getMemoryDb(), 500)).toThrow(
      'memory_fact_contribution_admission_integrity_failed',
    );
    resetFactSchemaCacheForTests();
    expect(() => clearStructuredMemory()).not.toThrow();
    expect(tableCount('memory_fact_contribution_supersessions')).toBe(0);
  });

  it('allows an explicit full-memory clear to recover an unbacked post-boundary fact', () => {
    exactConversationLegacyFact('clear_unbacked');
    resetFactSchemaCacheForTests();

    expect(() => clearStructuredMemory()).not.toThrow();
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_fact_contribution_admission')).toBe(1);
    expect(() => ensureFactSchema()).not.toThrow();
  });

  it('allows an explicit full-memory clear to recover a corrupted contribution', () => {
    const fact = exactConversationLegacyFact('clear_corrupt_payload');
    reopenLegacyBoundary();
    admitLegacyFactContributions(getMemoryDb(), 500);
    getMemoryDb().execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_immutable;
      UPDATE memory_fact_contributions
         SET payload_sha256 = '${'0'.repeat(64)}'
       WHERE fact_id = '${fact.id}';
    `);
    resetFactSchemaCacheForTests();

    expect(() => clearStructuredMemory()).not.toThrow();
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_fact_contributions')).toBe(0);
    expect(tableCount('memory_fact_contribution_admission')).toBe(1);
  });

  it('allows an explicit full-memory clear to recover a post-boundary retired alias', () => {
    exactConversationLegacyFact('clear_retired_source');
    reopenLegacyBoundary();
    admitLegacyFactContributions(getMemoryDb(), 500);
    const db = getMemoryDb();
    db.runSync(
      `INSERT INTO memory_source_retirement_groups(id, reason, retired_at)
       VALUES ('post-boundary-retirement', 'message_deleted', 600)`,
    );
    db.runSync(
      `INSERT INTO memory_retired_sources(
         retirement_group_id, memory_owner_id, memory_conversation_id,
         source_thread_id, task_id, source_kind, source_id)
       VALUES ('post-boundary-retirement', ?, 'legacy-conversation', 'legacy-thread', '',
               'message', 'clear_retired_source-message')`,
      getLocalMemoryVaultOwnerId(db),
    );
    resetFactSchemaCacheForTests();

    expect(() => clearStructuredMemory()).not.toThrow();
    expect(tableCount('memory_facts')).toBe(0);
    expect(tableCount('memory_retired_sources')).toBe(0);
    expect(tableCount('memory_fact_contribution_admission')).toBe(1);
  });

  it('recovers a corrupt partial ledger before its first completed boundary', () => {
    const fact = exactConversationLegacyFact('partial_ledger_corrupt');
    reopenLegacyBoundary();
    admitLegacyFactContributions(getMemoryDb(), 500);
    getMemoryDb().execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_immutable;
      UPDATE memory_fact_contributions
         SET payload_sha256 = '${'0'.repeat(64)}'
       WHERE fact_id = '${fact.id}';
    `);
    reopenLegacyBoundary();
    resetFactSchemaCacheForTests();

    expect(() => ensureFactSchema()).toThrow('memory_fact_contribution_admission_integrity_failed');
    expect(() => clearStructuredMemory()).not.toThrow();
    expect(tableCount('memory_fact_contribution_admission')).toBe(1);

    const subject = upsertEntity({ name: 'user', type: 'self', now: 700 });
    expect(() =>
      recordFactWithContribution(
        {
          subjectId: subject.id,
          predicate: 'fresh_after_recovery',
          objectText: 'accepted',
          scope: 'conversation',
          sourceMessageId: 'fresh-message',
          sourceTurnId: 'fresh-turn',
          originConversationId: 'fresh-conversation',
          originThreadId: 'fresh-thread',
          now: 700,
        },
        { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
        {
          memoryConversationId: 'fresh-conversation',
          sourceThreadId: 'fresh-thread',
          taskId: null,
          producer: { producerId: 'recovery_test', producerEventId: 'fresh-event' },
          sourceAliases: [
            { sourceKind: 'message', sourceId: 'fresh-message' },
            { sourceKind: 'turn', sourceId: 'fresh-turn' },
          ],
        },
      ),
    ).not.toThrow();
    expect(tableCount('memory_fact_contributions')).toBe(1);
  });
});
