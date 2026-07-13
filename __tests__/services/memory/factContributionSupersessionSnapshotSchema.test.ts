jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { upsertEntity } from '../../../src/services/memory/entities';
import { assertFactContributionAdmissionIntegrity } from '../../../src/services/memory/factContributionAdmissionIntegrity';
import { recordFactWithContribution } from '../../../src/services/memory/facts/mutations';
import type { FactRow } from '../../../src/services/memory/facts/types';
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
});

function createContributedFact(input: {
  subjectId: string;
  objectText: string;
  messageId: string;
  eventId: string;
  now: number;
  pinned?: boolean;
  reviewState?: 'auto' | 'verified';
}) {
  return recordFactWithContribution(
    {
      subjectId: input.subjectId,
      predicate: 'favorite_color',
      objectText: input.objectText,
      scope: 'global',
      sourceMessageId: input.messageId,
      pinned: input.pinned,
      reviewState: input.reviewState,
      now: input.now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      producer: { producerId: 'snapshot_schema_test', producerEventId: input.eventId },
      sourceAliases: [{ sourceKind: 'message', sourceId: input.messageId }],
    },
  ).fact;
}

function contributionIdForFact(factId: string): string {
  const row = getMemoryDb().getFirstSync<{ id: string }>(
    'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
    factId,
  );
  if (!row) throw new Error('test_contribution_missing');
  return row.id;
}

function insertSnapshot(input: {
  contributionId: string;
  successor: FactRow;
  pinnedInputExplicit: 0 | 1;
  reviewStateInputExplicit: 0 | 1;
}): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_fact_contribution_supersession_snapshots(
       contribution_id, successor_fact_id, superseded_at, snapshot_version,
       pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
       successor_review_state_baseline, successor_sensitivity_floor,
       successor_sensitivity_policy_version
     ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    input.contributionId,
    input.successor.id,
    input.successor.created_at,
    input.pinnedInputExplicit,
    input.reviewStateInputExplicit,
    input.successor.pinned,
    input.successor.review_state,
    input.successor.sensitivity,
    input.successor.sensitivity_policy_version,
  );
}

describe('fact contribution supersession snapshot schema', () => {
  it('uses one strict normalized snapshot header and flag-free predecessor edges', () => {
    const db = getMemoryDb();
    expect(
      db
        .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contribution_supersessions)')
        .map((column) => column.name),
    ).toEqual(['contribution_id', 'predecessor_fact_id', 'successor_fact_id', 'superseded_at']);
    expect(
      db
        .getAllSync<{
          name: string;
        }>('PRAGMA table_info(memory_fact_contribution_supersession_snapshots)')
        .map((column) => column.name),
    ).toEqual([
      'contribution_id',
      'successor_fact_id',
      'superseded_at',
      'snapshot_version',
      'pinned_input_explicit',
      'review_state_input_explicit',
      'successor_pinned_baseline',
      'successor_review_state_baseline',
      'successor_sensitivity_floor',
      'successor_sensitivity_policy_version',
    ]);
    expect(
      db.getFirstSync<{ sql: string }>(
        `SELECT sql FROM sqlite_master
          WHERE type = 'table'
            AND name = 'memory_fact_contribution_supersession_snapshots'`,
      )?.sql,
    ).toContain('WITHOUT ROWID');
  });

  it('seals the successor baseline and removes an orphaned snapshot with its final edge', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const predecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-1',
      eventId: 'event-1',
      now: 100,
    });
    const successor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-2',
      eventId: 'event-2',
      now: 200,
      pinned: true,
      reviewState: 'verified',
    });
    const db = getMemoryDb();
    const contributionId = contributionIdForFact(successor.id);
    const successorRow = db.getFirstSync<FactRow>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      successor.id,
    );
    if (!successorRow) throw new Error('test_successor_missing');
    db.runSync(
      'UPDATE memory_facts SET invalid_at = ?, updated_at = ? WHERE id = ?',
      200,
      200,
      predecessor.id,
    );

    expect(() =>
      db.runSync(
        `INSERT INTO memory_fact_contribution_supersessions(
           contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
         ) VALUES (?, ?, ?, ?)`,
        contributionId,
        predecessor.id,
        successor.id,
        200,
      ),
    ).toThrow('memory_fact_contribution_supersession_parent_invalid');
    expect(() =>
      db.runSync(
        `INSERT INTO memory_fact_contribution_supersession_snapshots(
           contribution_id, successor_fact_id, superseded_at, snapshot_version,
           pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
           successor_review_state_baseline, successor_sensitivity_floor,
           successor_sensitivity_policy_version
         ) VALUES (?, ?, 200, 1, 1, 1, 0, 'verified', ?, ?)`,
        contributionId,
        successor.id,
        successorRow.sensitivity,
        successorRow.sensitivity_policy_version,
      ),
    ).toThrow('memory_fact_contribution_supersession_snapshot_parent_invalid');

    insertSnapshot({
      contributionId,
      successor: successorRow,
      pinnedInputExplicit: 1,
      reviewStateInputExplicit: 1,
    });
    db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, ?)`,
      contributionId,
      predecessor.id,
      successor.id,
      200,
    );

    db.runSync(
      `UPDATE memory_facts
          SET sensitivity_policy_version = sensitivity_policy_version + 1
        WHERE id = ?`,
      successor.id,
    );
    expect(() => assertFactContributionAdmissionIntegrity(db)).not.toThrow();
    expect(() =>
      db.runSync(
        `UPDATE memory_fact_contribution_supersession_snapshots
            SET successor_pinned_baseline = 0
          WHERE contribution_id = ?`,
        contributionId,
      ),
    ).toThrow('memory_fact_contribution_supersession_snapshot_immutable');
    expect(() =>
      db.runSync(
        `DELETE FROM memory_fact_contribution_supersession_snapshots
          WHERE contribution_id = ?`,
        contributionId,
      ),
    ).toThrow('memory_fact_contribution_supersession_snapshot_immutable');

    db.runSync('DELETE FROM memory_facts WHERE id = ?', predecessor.id);

    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_contribution_supersession_snapshots
          WHERE contribution_id = ?`,
        contributionId,
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions WHERE id = ?',
        contributionId,
      )?.count,
    ).toBe(1);
    expect(() => assertFactContributionAdmissionIntegrity(db)).not.toThrow();
  });

  it('rejects two causal successors for one predecessor', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const predecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-fork-predecessor',
      eventId: 'event-fork-predecessor',
      now: 100,
    });
    const firstSuccessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-fork-first',
      eventId: 'event-fork-first',
      now: 200,
    });
    const secondSuccessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'red',
      messageId: 'message-fork-second',
      eventId: 'event-fork-second',
      now: 200,
    });
    const db = getMemoryDb();
    const firstContributionId = contributionIdForFact(firstSuccessor.id);
    const secondContributionId = contributionIdForFact(secondSuccessor.id);
    const firstRow = db.getFirstSync<FactRow>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      firstSuccessor.id,
    );
    const secondRow = db.getFirstSync<FactRow>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      secondSuccessor.id,
    );
    if (!firstRow || !secondRow) throw new Error('test_successor_missing');
    db.runSync(
      'UPDATE memory_facts SET invalid_at = 200, updated_at = 200 WHERE id = ?',
      predecessor.id,
    );
    insertSnapshot({
      contributionId: firstContributionId,
      successor: firstRow,
      pinnedInputExplicit: 0,
      reviewStateInputExplicit: 0,
    });
    db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, 200)`,
      firstContributionId,
      predecessor.id,
      firstSuccessor.id,
    );

    expect(() =>
      runMemoryTransaction(() => {
        insertSnapshot({
          contributionId: secondContributionId,
          successor: secondRow,
          pinnedInputExplicit: 0,
          reviewStateInputExplicit: 0,
        });
        db.runSync(
          `INSERT INTO memory_fact_contribution_supersessions(
             contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
           ) VALUES (?, ?, ?, 200)`,
          secondContributionId,
          predecessor.id,
          secondSuccessor.id,
        );
      }),
    ).toThrow();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersession_snapshots',
      )?.count,
    ).toBe(1);
  });

  it('fails admission while a snapshot has no exact predecessor edge', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const predecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-orphan-1',
      eventId: 'event-orphan-1',
      now: 100,
    });
    const successor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-orphan-2',
      eventId: 'event-orphan-2',
      now: 200,
    });
    const db = getMemoryDb();
    const contributionId = contributionIdForFact(successor.id);
    const successorRow = db.getFirstSync<FactRow>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      successor.id,
    );
    if (!successorRow) throw new Error('test_successor_missing');
    db.runSync(
      'UPDATE memory_facts SET invalid_at = 200, updated_at = 200 WHERE id = ?',
      predecessor.id,
    );
    insertSnapshot({
      contributionId,
      successor: successorRow,
      pinnedInputExplicit: 0,
      reviewStateInputExplicit: 0,
    });

    expect(() => assertFactContributionAdmissionIntegrity(db)).toThrow(
      'memory_fact_contribution_admission_integrity_invalid',
    );
  });
});
