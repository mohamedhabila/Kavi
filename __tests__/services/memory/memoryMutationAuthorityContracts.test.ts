jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  clearEpisodeAccessPolicies,
  deleteEpisodeAccessPolicies,
} from '../../../src/services/memory/episodes/accessPolicySchema';
import {
  bindEpisodeAccessPolicy,
  bindEpisodeAccessPolicyInTransaction,
} from '../../../src/services/memory/episodes/accessPolicyStore';
import {
  addFactEvidence,
  addFactEvidenceInTransaction,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import { replaceEpisodeRetrievalTermsInTransaction } from '../../../src/services/memory/episodes/retrievalIndex';
import { setFactSensitivityFloorInTransaction } from '../../../src/services/memory/facts/factContributionMaterialization';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { deleteFactRetrievalTermsInTransaction } from '../../../src/services/memory/facts/retrievalIndex';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function requireAuthoritySnapshot() {
  const snapshot = captureMemoryAuthoritySnapshot();
  if (!snapshot) throw new Error('expected memory authority snapshot');
  return snapshot;
}

function expectProjectionStaleOnly(snapshot: ReturnType<typeof requireAuthoritySnapshot>): void {
  expect(isMemoryProjectionSnapshotCurrent(snapshot)).toBe(false);
  expect(isMemoryProjectionSnapshotDurablyCurrent(snapshot)).toBe(false);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(snapshot)).toBe(true);
}

function expectAuthorityCurrent(snapshot: ReturnType<typeof requireAuthoritySnapshot>): void {
  expect(isMemoryProjectionSnapshotCurrent(snapshot)).toBe(true);
  expect(isMemoryProjectionSnapshotDurablyCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(snapshot)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(snapshot)).toBe(true);
}

function seedFact(): string {
  const subject = upsertEntity({ name: 'benutzer', type: 'self', now: 100 });
  return recordFact({
    subjectId: subject.id,
    predicate: 'preferencia',
    objectText: 'réponses concises',
    scope: 'global',
    now: 100,
  }).fact.id;
}

function seedEpisode() {
  const episode = recordThreadLocalEpisode({
    conversationId: 'conversation-policy-contract',
    threadId: 'thread-policy-contract',
    taskId: null,
    summary: '予定を確認 تم التحقق',
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: 'policy-message-user',
      sourceAssistantMessageId: 'policy-message-assistant',
      userContent: '予定を確認',
      assistantContent: 'تم التحقق',
    }),
    startedAt: 100,
    endedAt: 100,
    now: 100,
  });
  if (!episode) throw new Error('expected episode');
  return episode;
}

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

describe('memory mutation authority contracts', () => {
  it('rejects direct low-level mutations without the caller-owned transaction', () => {
    const db = getMemoryDb();
    expect(() => addFactEvidenceInTransaction({ factId: 'fact-contract' })).toThrow(
      'fact_evidence_transaction_required',
    );
    expect(() =>
      bindEpisodeAccessPolicyInTransaction(db, {
        episodeId: 'episode-contract',
        memoryOwnerId: getLocalMemoryVaultOwnerId(db),
        memoryConversationId: 'conversation-contract',
        sourceThreadId: 'thread-contract',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
      }),
    ).toThrow('episode_access_policy_transaction_required');
    expect(() => deleteEpisodeAccessPolicies(db, [])).toThrow(
      'episode_access_policy_delete_transaction_required',
    );
    expect(() => clearEpisodeAccessPolicies(db)).toThrow(
      'episode_access_policy_clear_transaction_required',
    );
    expect(() =>
      replaceEpisodeRetrievalTermsInTransaction(db, {
        id: 'episode-contract',
        summary: '摘要',
        entities: [],
        toolNames: [],
      }),
    ).toThrow('episode_retrieval_index_transaction_required');
    expect(() => deleteFactRetrievalTermsInTransaction(db, 'fact-contract')).toThrow(
      'fact_retrieval_index_transaction_required',
    );
    expect(() => setFactSensitivityFloorInTransaction('fact-contract', 'restricted')).toThrow(
      'fact_sensitivity_floor_transaction_required',
    );
  });

  it('advances projection freshness for evidence changes, not exact replays', () => {
    const factId = seedFact();
    const beforeEvidence = requireAuthoritySnapshot();

    expect(
      addFactEvidence({
        factId,
        messageId: 'evidence-message',
        role: 'user',
        quote: 'حقيقة مؤكدة',
        now: 200,
      }),
    ).not.toBeNull();
    expectProjectionStaleOnly(beforeEvidence);

    const afterEvidence = requireAuthoritySnapshot();
    addFactEvidence({
      factId,
      messageId: 'evidence-message',
      role: 'user',
      quote: 'حقيقة مؤكدة',
      now: 300,
    });
    expectAuthorityCurrent(afterEvidence);
  });

  it('rolls evidence and projection freshness back together', () => {
    const factId = seedFact();
    const beforeEvidence = requireAuthoritySnapshot();

    expect(() =>
      runMemoryTransaction(() => {
        addFactEvidence({ factId, messageId: 'rollback-evidence', now: 200 });
        throw new Error('forced_evidence_rollback');
      }),
    ).toThrow('forced_evidence_rollback');

    expect(
      getMemoryDb().getFirstSync(
        'SELECT id FROM memory_fact_evidence WHERE fact_id = ? AND message_id = ?',
        factId,
        'rollback-evidence',
      ),
    ).toBeNull();
    expectAuthorityCurrent(beforeEvidence);
  });

  it('advances projection freshness when a thread-local episode gains an access policy', () => {
    const episode = seedEpisode();
    const db = getMemoryDb();
    const input = {
      episodeId: episode.id,
      memoryOwnerId: getLocalMemoryVaultOwnerId(db),
      memoryConversationId: 'conversation-policy-contract',
      sourceThreadId: 'thread-policy-contract',
      personaId: 'default',
      taskId: null,
      shareability: 'session_threads' as const,
      boundAt: 100,
    };
    const beforePolicy = requireAuthoritySnapshot();

    bindEpisodeAccessPolicy(db, input, 100);
    expectProjectionStaleOnly(beforePolicy);

    const afterPolicy = requireAuthoritySnapshot();
    bindEpisodeAccessPolicy(db, input, 100);
    expectAuthorityCurrent(afterPolicy);
  });

  it('rolls an access-policy insert and projection freshness back together', () => {
    const episode = seedEpisode();
    const db = getMemoryDb();
    const beforePolicy = requireAuthoritySnapshot();

    expect(() =>
      runMemoryTransaction(() => {
        bindEpisodeAccessPolicy(
          db,
          {
            episodeId: episode.id,
            memoryOwnerId: getLocalMemoryVaultOwnerId(db),
            memoryConversationId: 'conversation-policy-contract',
            sourceThreadId: 'thread-policy-contract',
            personaId: 'default',
            taskId: null,
            shareability: 'session_threads',
            boundAt: 100,
          },
          100,
        );
        throw new Error('forced_policy_rollback');
      }),
    ).toThrow('forced_policy_rollback');

    expect(
      db.getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        episode.id,
      ),
    ).toBeNull();
    expectAuthorityCurrent(beforePolicy);
  });
});
