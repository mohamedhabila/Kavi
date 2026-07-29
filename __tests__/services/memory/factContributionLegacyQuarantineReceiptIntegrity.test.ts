jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { quarantineLegacyFacts } from '../../../src/services/memory/factContributionLegacyQuarantine';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
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

function insertProviderReceipt(jobId: string, factId: string): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_ingestion_receipts(
       job_id, attempt_number, episode_id, deterministic_fact_ids_json,
       provider_fact_ids_json, invalidated_fact_ids_json,
       bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json,
       active_focus_updated, open_threads_updated, provider_outcome,
       provider_outcome_code, persisted_at
     ) VALUES (?, 1, NULL, ?, '[]', '[]', '[]', '[]', 0, 0,
               'structural_only', NULL, 200)`,
    jobId,
    JSON.stringify([factId]),
  );
}

function insertStructuralReceipt(jobId: string, factId: string): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_ingestion_structural_receipts(
       job_id, attempt_number, memory_conversation_id, source_thread_id,
       persona_id, task_id, source_run_id, source_start_message_id,
       source_end_message_id, source_snapshot_sha256, source_at, episode_id,
       deterministic_fact_ids_json, provider_fact_ids_json,
       invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
       agent_run_memory_fact_ids_json, active_focus_updated,
       open_threads_updated, persisted_at
     ) VALUES (?, 1, 'legacy-conversation', 'legacy-thread', 'default', NULL,
               NULL, 'legacy-user', 'legacy-assistant', ?, 100, NULL,
               ?, '[]', '[]', '[]', '[]', 0, 0, 200)`,
    jobId,
    'a'.repeat(64),
    JSON.stringify([factId]),
  );
}

function receiptJobIds(table: string): string[] {
  return getMemoryDb()
    .getAllSync<{ job_id: string }>(`SELECT job_id FROM ${table} ORDER BY job_id`)
    .map((row) => row.job_id);
}

it('deletes only receipts containing quarantined fact lineage without rewriting sealed rows', () => {
  const subject = upsertEntity({ name: 'legacy-user', type: 'self', now: 100 });
  const fact = recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'legacy-private-value',
      objectText: 'private',
      scope: 'conversation',
      originConversationId: 'legacy-conversation',
      originThreadId: 'legacy-thread',
      sourceMessageId: 'legacy-user',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
  const row = getMemoryDb().getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ?',
    fact.id,
  );
  if (!row) throw new Error('legacy fact fixture missing');

  insertProviderReceipt('provider-affected', fact.id);
  insertProviderReceipt('provider-retained', 'unrelated-fact');
  insertStructuralReceipt('structural-affected', fact.id);
  insertStructuralReceipt('structural-retained', 'unrelated-fact');

  quarantineLegacyFacts({
    db: getMemoryDb(),
    entries: [{ row, reason: 'source_scope_unproven' }],
    quarantinedAt: 500,
  });

  expect(receiptJobIds('memory_ingestion_receipts')).toEqual(['provider-retained']);
  expect(receiptJobIds('memory_ingestion_structural_receipts')).toEqual(['structural-retained']);
});
