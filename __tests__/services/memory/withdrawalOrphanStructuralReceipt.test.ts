jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { probeMemoryWithdrawalResiduals } from '../../../src/services/memory/withdrawalResidualProbe';
import {
  CODE_OWNED_NORMAL_TEST_SENSITIVITY,
  recordContributionBackedFact,
} from '../../helpers/memoryRetirementTestFixtures';

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

it('deletes and probes an exact structural receipt whose ingestion job is missing', () => {
  const subject = upsertEntity({ name: 'withdrawal-user', type: 'self', now: 100 });
  const fact = recordContributionBackedFact(
    {
      subjectId: subject.id,
      predicate: 'private-value',
      objectText: 'remove me',
      scope: 'conversation',
      originConversationId: 'withdrawal-conversation',
      originThreadId: 'withdrawal-thread',
      sourceMessageId: 'withdrawal-user-message',
      sourceTurnId: 'withdrawal-assistant-message',
      now: 100,
    },
    {
      memoryConversationId: 'withdrawal-conversation',
      sourceThreadId: 'withdrawal-thread',
      producerEventId: 'withdrawal-orphan-structural-receipt',
      sensitivityDeclaration: CODE_OWNED_NORMAL_TEST_SENSITIVITY,
    },
  ).fact;
  const orphanJobId = 'missing-ingestion-job';
  getMemoryDb().runSync(
    `INSERT INTO memory_ingestion_structural_receipts(
       job_id, attempt_number, memory_conversation_id, source_thread_id,
       persona_id, task_id, source_run_id, source_start_message_id,
       source_end_message_id, source_snapshot_sha256, source_at, episode_id,
       deterministic_fact_ids_json, provider_fact_ids_json,
       invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
       agent_run_memory_fact_ids_json, active_focus_updated,
       open_threads_updated, persisted_at
     ) VALUES (?, 1, 'withdrawal-conversation', 'withdrawal-thread', 'default',
               NULL, NULL, 'withdrawal-user-message', 'withdrawal-assistant-message',
               ?, 100, NULL, ?, '[]', '[]', '[]', '[]', 0, 0, 101)`,
    orphanJobId,
    'b'.repeat(64),
    JSON.stringify([fact.id]),
  );
  expect(
    getMemoryDb().getFirstSync('SELECT id FROM memory_ingestion_jobs WHERE id = ?', orphanJobId),
  ).toBeNull();
  const preWithdrawalProbe = probeMemoryWithdrawalResiduals(getMemoryDb(), {
    factIds: [],
    retrievalTermStats: [],
    evidenceIds: [],
    observationIds: [],
    verifiedProcedureObservationIds: [],
    episodeIds: [],
    reflectionIds: [],
    workingBlocks: [],
    entityIds: [],
    ingestionJobIds: [],
    ingestionReceiptJobIds: [orphanJobId],
    affectedScopes: [],
    sources: [],
    checkEmbeddingCache: false,
  });
  expect(preWithdrawalProbe.status).toBe('residual');
  expect(preWithdrawalProbe.counts.ingestionReceipts).toBe(1);

  const result = withdrawMemoryFact(fact.id, 500);

  expect(result.status).toBe('withdrawn');
  if (result.status !== 'withdrawn') throw new Error('expected withdrawal');
  expect(result.receipt.counts.ingestionReceipts).toBe(1);
  expect(
    getMemoryDb().getFirstSync(
      'SELECT job_id FROM memory_ingestion_structural_receipts WHERE job_id = ?',
      orphanJobId,
    ),
  ).toBeNull();
});
