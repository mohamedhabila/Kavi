jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../../helpers/chatStoreHarness';
import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithContributionInTransaction } from '../../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as sourceRetirementCoordinator from '../../../src/services/memory/sourceRetirementCoordinator';
import { hashVerifiedProcedureProvenanceSync } from '../../../src/services/memory/verifiedProcedure/provenanceHash';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function addPublicationReceipt(input: {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  disposition: null | 'enqueued';
}): void {
  const store = useChatStore.getState();
  store.addMessage(input.conversationId, {
    id: input.userMessageId,
    role: 'user',
    content: 'طلب حذف دقيق',
    timestamp: 10,
  });
  store.addMessage(input.conversationId, {
    id: input.assistantMessageId,
    role: 'assistant',
    content: '削除を確認しました',
    timestamp: 11,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
  expect(
    store.transitionMessageMemoryPublication(input.conversationId, input.assistantMessageId, null)
      .status,
  ).toBe('applied');
  if (input.disposition === 'enqueued') {
    expect(
      store.transitionMessageMemoryPublication(
        input.conversationId,
        input.assistantMessageId,
        'enqueued',
      ).status,
    ).toBe('applied');
  }
}

function seedTaskContribution(input: {
  conversationId: string;
  memoryConversationId?: string;
  userMessageId: string;
  assistantMessageId: string;
  taskId: string;
  now: number;
}): string {
  const memoryConversationId = input.memoryConversationId ?? input.conversationId;
  const subjectId = upsertEntity({
    name: `subject-${input.taskId}`,
    type: 'self',
    now: input.now,
  }).id;
  return recordFactWithContributionInTransaction(
    {
      subjectId,
      predicate: 'تفضيل',
      objectText: '青',
      attributes: { taskId: input.taskId },
      scope: 'session',
      originConversationId: memoryConversationId,
      originThreadId: input.conversationId,
      originTaskId: input.taskId,
      sourceMessageId: input.userMessageId,
      sourceTurnId: input.assistantMessageId,
      now: input.now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId,
      sourceThreadId: input.conversationId,
      taskId: input.taskId,
      producer: {
        producerId: 'conversation_delete_retirement_test',
        producerEventId: `event-${input.taskId}`,
      },
      sourceAliases: [
        { sourceKind: 'message', sourceId: input.userMessageId },
        { sourceKind: 'turn', sourceId: input.assistantMessageId },
      ],
    },
  ).result.fact.id;
}

function countRows(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

describe('conversation deletion source retirement', () => {
  it('retires every exact task scope before deleting one conversation', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt({
      conversationId,
      userMessageId: 'delete-user',
      assistantMessageId: 'delete-assistant',
      disposition: 'enqueued',
    });
    let factIds: string[] = [];
    runMemoryTransaction(() => {
      factIds = ['task-a', 'task-b'].map((taskId, index) =>
        seedTaskContribution({
          conversationId,
          userMessageId: 'delete-user',
          assistantMessageId: 'delete-assistant',
          taskId,
          now: 100 + index,
        }),
      );
    });

    useChatStore.getState().deleteConversation(conversationId);

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(
      getMemoryDb().getAllSync<{ id: string }>(
        `SELECT id FROM memory_facts WHERE id IN (?, ?) ORDER BY id ASC`,
        ...factIds,
      ),
    ).toEqual([]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_retired_sources
          WHERE source_thread_id = ? AND source_kind = 'turn'
            AND source_id = ?`,
        conversationId,
        'delete-assistant',
      )?.count,
    ).toBe(2);
  });

  it('terminalizes an open receipt without inventing an imprecise source tuple', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt({
      conversationId,
      userMessageId: 'open-user',
      assistantMessageId: 'open-assistant',
      disposition: null,
    });
    const originalTransition = useChatStore.getState().transitionMessageMemoryPublication;
    const transition = jest.fn(originalTransition);
    useChatStore.setState({ transitionMessageMemoryPublication: transition });
    try {
      useChatStore.getState().deleteConversation(conversationId);

      expect(transition).toHaveBeenCalledWith(conversationId, 'open-assistant', 'withdrawn');
      expect(useChatStore.getState().conversations).toEqual([]);
      expect(countRows('memory_retired_sources')).toBe(0);
    } finally {
      useChatStore.setState({ transitionMessageMemoryPublication: originalTransition });
    }
  });

  it('deletes and fences verified-procedure evidence even when no causal source row exists', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    ensureFactSchema();
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const rawDigest = 'a'.repeat(64);
    const sourceRunIdHash = hashVerifiedProcedureProvenanceSync(
      'source-run',
      'verified-run-without-causal-source',
    );
    const evidenceManifest = JSON.stringify({
      version: 1,
      procedureId: 'calendar-list-to-create-event',
      procedureContractDigest: `sha256:${rawDigest}`,
      evidenceId: `sha256:${'b'.repeat(64)}`,
      orderedSteps: [
        {
          stepKey: 'calendar-list',
          receiptId: `ter_${'c'.repeat(32)}`,
          contractIdentityDigest: `sha256:${'d'.repeat(64)}`,
          requestDigest: `sha256:${'e'.repeat(64)}`,
          resultDigest: `sha256:${'f'.repeat(64)}`,
        },
        {
          stepKey: 'calendar-create-event',
          receiptId: `ter_${'1'.repeat(32)}`,
          contractIdentityDigest: `sha256:${'2'.repeat(64)}`,
          requestDigest: `sha256:${'3'.repeat(64)}`,
          resultDigest: `sha256:${'4'.repeat(64)}`,
        },
      ],
      linkageDigest: `sha256:${'5'.repeat(64)}`,
      sourceLineage: {
        sourceMessageIdHash: '6'.repeat(64),
        sourceRunIdHash: '7'.repeat(64),
        sourceTurnIdHash: '8'.repeat(64),
        taskIdHash: null,
      },
      terminalProofDigest: `sha256:${'9'.repeat(64)}`,
    });
    db.runSync(
      `INSERT INTO memory_verified_procedure_observations(
         id, memory_owner_id, memory_conversation_id_hash, source_thread_id_hash,
         source_run_id_hash, procedure_id, procedure_contract_digest, platform,
         precondition_ids_json, precondition_ids_hash, evidence_manifest_json,
         evidence_manifest_digest, evidence_id_digest, linkage_digest,
         terminal_proof_digest, contract_version, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ios', '[]', ?, ?, ?, ?, ?, ?, 1, 10, 10)`,
      `verified_procedure_${'a'.repeat(64)}`,
      memoryOwnerId,
      hashVerifiedProcedureProvenanceSync('memory-conversation', conversationId),
      hashVerifiedProcedureProvenanceSync('source-thread', conversationId),
      sourceRunIdHash,
      'calendar-list-to-create-event',
      rawDigest,
      'b'.repeat(64),
      evidenceManifest,
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      'f'.repeat(64),
    );
    expect(countRows('memory_ingestion_job_sources')).toBe(0);
    expect(countRows('memory_fact_contribution_sources')).toBe(0);

    useChatStore.getState().deleteConversation(conversationId);

    expect(countRows('memory_verified_procedure_observations')).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_verified_procedure_run_invalidations
          WHERE memory_owner_id = ? AND source_run_id_hash = ?`,
        memoryOwnerId,
        sourceRunIdHash,
      )?.count,
    ).toBe(1);
  });

  it('pages target reflections without failing on a large unrelated vault', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    ensureFactSchema();
    const db = getMemoryDb();
    runMemoryTransaction(() => {
      db.runSync(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 4096
         )
         INSERT INTO memory_reflections(
           id, scope, thread_id, task_id, period_start, period_end, kind, content,
           source_episode_ids_json, source_fact_ids_json, created_at, updated_at, deleted_at
         )
         SELECT 'reflection-unrelated-' || printf('%05d', value),
                'session', 'unrelated-thread-' || value, NULL, 0, 1, 'summary',
                'unrelated-' || value, '[]', '[]', 1, 1, NULL
           FROM sequence`,
      );
      db.runSync(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 259
         )
         INSERT INTO memory_reflections(
           id, scope, thread_id, task_id, period_start, period_end, kind, content,
           source_episode_ids_json, source_fact_ids_json, created_at, updated_at, deleted_at
         )
         SELECT 'reflection-target-' || printf('%05d', value),
                'session', ?, NULL, 0, 1, 'summary', 'private-target-' || value,
                '[]', '[]', 1, 1, NULL
           FROM sequence`,
        conversationId,
      );
    });

    useChatStore.getState().deleteConversation(conversationId);

    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_reflections WHERE thread_id = ?',
        conversationId,
      )?.count,
    ).toBe(0);
    expect(countRows('memory_reflections')).toBe(4_097);
  });

  it('fails closed when an enqueued receipt has no exact persisted source proof', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt({
      conversationId,
      userMessageId: 'unproven-user',
      assistantMessageId: 'unproven-assistant',
      disposition: 'enqueued',
    });

    expect(() => useChatStore.getState().deleteConversation(conversationId)).toThrow(
      'conversation_delete_memory_publication_fence_unavailable',
    );
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(countRows('memory_source_retirement_groups')).toBe(0);
  });

  it('recovers idempotently when chat receipt mutation fails after the memory fence commits', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt({
      conversationId,
      userMessageId: 'recovery-user',
      assistantMessageId: 'recovery-assistant',
      disposition: 'enqueued',
    });
    runMemoryTransaction(() => {
      seedTaskContribution({
        conversationId,
        userMessageId: 'recovery-user',
        assistantMessageId: 'recovery-assistant',
        taskId: 'recovery-task',
        now: 100,
      });
    });
    const originalTransition = useChatStore.getState().transitionMessageMemoryPublication;
    useChatStore.setState({
      transitionMessageMemoryPublication: jest.fn(() => ({
        status: 'rejected' as const,
        reason: 'transition_conflict' as const,
      })),
    });
    expect(() => useChatStore.getState().deleteConversation(conversationId)).toThrow(
      'conversation_delete_memory_publication_commit_transition_conflict',
    );
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(countRows('memory_source_retirement_groups')).toBe(1);

    useChatStore.setState({ transitionMessageMemoryPublication: originalTransition });
    useChatStore.getState().deleteConversation(conversationId);
    expect(useChatStore.getState().conversations).toEqual([]);
    expect(countRows('memory_source_retirement_groups')).toBe(1);
  });

  it('pages exact sources and remains idempotent after chat state is gone', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    addPublicationReceipt({
      conversationId,
      userMessageId: 'paged-user',
      assistantMessageId: 'paged-assistant',
      disposition: 'enqueued',
    });
    runMemoryTransaction(() => {
      for (let index = 0; index < 130; index += 1) {
        seedTaskContribution({
          conversationId,
          userMessageId: 'paged-user',
          assistantMessageId: 'paged-assistant',
          taskId: `paged-task-${String(index).padStart(3, '0')}`,
          now: 100 + index,
        });
      }
    });

    useChatStore.getState().deleteConversation(conversationId);
    const operationCount = countRows('memory_source_retirement_groups');
    expect(operationCount).toBe(2);
    expect(countRows('memory_retired_fact_contributions')).toBe(130);
    expect(countRows('memory_fact_contributions')).toBe(0);
    expect(countRows('memory_facts')).toBe(0);

    useChatStore.getState().deleteConversation(conversationId);
    expect(countRows('memory_source_retirement_groups')).toBe(operationCount);
  });

  it('keeps a committed deletion when the post-commit WAL checkpoint fails', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'model');
    let factId = '';
    runMemoryTransaction(() => {
      factId = seedTaskContribution({
        conversationId,
        userMessageId: 'checkpoint-user',
        assistantMessageId: 'checkpoint-assistant',
        taskId: 'checkpoint-task',
        now: 100,
      });
    });
    const db = getMemoryDb();
    const execSync = db.execSync.bind(db);
    const checkpoint = jest.spyOn(db, 'execSync').mockImplementation((statement: string) => {
      if (statement === 'PRAGMA wal_checkpoint(TRUNCATE)') {
        throw new Error('forced_checkpoint_failure');
      }
      return execSync(statement);
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => useChatStore.getState().deleteConversation(conversationId)).not.toThrow();
      expect(checkpoint).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      checkpoint.mockRestore();
      log.mockRestore();
    }

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(db.getFirstSync('SELECT id FROM memory_facts WHERE id = ?', factId)).toBeNull();
  });

  it('discards one side thread without retiring its parent workspace sibling', () => {
    const parentId = useChatStore.getState().createConversation('provider', 'model');
    const sideId = useChatStore.getState().createSideThread(parentId)!;
    addPublicationReceipt({
      conversationId: parentId,
      userMessageId: 'parent-user',
      assistantMessageId: 'parent-assistant',
      disposition: 'enqueued',
    });
    addPublicationReceipt({
      conversationId: sideId,
      userMessageId: 'side-user',
      assistantMessageId: 'side-assistant',
      disposition: 'enqueued',
    });
    let parentFactId = '';
    let sideFactId = '';
    runMemoryTransaction(() => {
      parentFactId = seedTaskContribution({
        conversationId: parentId,
        userMessageId: 'parent-user',
        assistantMessageId: 'parent-assistant',
        taskId: 'parent-task',
        now: 100,
      });
      sideFactId = seedTaskContribution({
        conversationId: sideId,
        memoryConversationId: parentId,
        userMessageId: 'side-user',
        assistantMessageId: 'side-assistant',
        taskId: 'side-task',
        now: 110,
      });
    });

    expect(useChatStore.getState().discardSideThread(sideId)).toBe(true);

    expect(useChatStore.getState().conversations.map(({ id }) => id)).toEqual([parentId]);
    expect(
      getMemoryDb().getFirstSync<{ id: string }>(
        'SELECT id FROM memory_facts WHERE id = ?',
        parentFactId,
      ),
    ).toEqual({ id: parentFactId });
    expect(
      getMemoryDb().getFirstSync<{ id: string }>(
        'SELECT id FROM memory_facts WHERE id = ?',
        sideFactId,
      ),
    ).toBeNull();
  });

  it('rolls every conversation back when a later clear-all retirement fails', () => {
    const conversationIds = ['first', 'second'].map((label) => {
      const conversationId = useChatStore.getState().createConversation('provider', 'model');
      addPublicationReceipt({
        conversationId,
        userMessageId: `${label}-user`,
        assistantMessageId: `${label}-assistant`,
        disposition: 'enqueued',
      });
      runMemoryTransaction(() => {
        seedTaskContribution({
          conversationId,
          userMessageId: `${label}-user`,
          assistantMessageId: `${label}-assistant`,
          taskId: `${label}-task`,
          now: label === 'first' ? 100 : 110,
        });
      });
      return conversationId;
    });
    const retire = sourceRetirementCoordinator.retireExactMemorySources;
    const coordinatorSpy = jest.spyOn(sourceRetirementCoordinator, 'retireExactMemorySources');
    let calls = 0;
    coordinatorSpy.mockImplementation((request) => {
      calls += 1;
      if (calls === 2) throw new Error('forced_clear_all_failure');
      return retire(request);
    });
    try {
      expect(() => useChatStore.getState().clearAllConversations()).toThrow(
        'forced_clear_all_failure',
      );
    } finally {
      coordinatorSpy.mockRestore();
    }

    expect(calls).toBe(2);
    expect(
      useChatStore
        .getState()
        .conversations.map(({ id }) => id)
        .sort(),
    ).toEqual([...conversationIds].sort());
    expect(countRows('memory_source_retirement_groups')).toBe(0);
    expect(countRows('memory_retired_sources')).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE deleted_at IS NOT NULL',
      )?.count,
    ).toBe(0);
  });
});
