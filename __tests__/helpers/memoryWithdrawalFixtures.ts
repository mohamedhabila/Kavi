import { rowToFact, type FactRow } from '../../src/services/memory/facts/types';
import { replaceFactRetrievalTerms } from '../../src/services/memory/facts/retrievalIndex';
import { enqueueIngestionJob } from '../../src/services/memory/ingestionQueueStore';
import { getMemoryDb } from '../../src/services/memory/sqlite-store';

export function cloneMemoryFactForWithdrawal(
  sourceFactId: string,
  cloneId: string,
  overrides: Record<string, string | number | null> = {},
): void {
  const db = getMemoryDb();
  const columns = db
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_facts)')
    .map((column) => column.name);
  const source = db.getFirstSync<Record<string, string | number | null>>(
    'SELECT * FROM memory_facts WHERE id = ?',
    sourceFactId,
  );
  if (!source) throw new Error('test source fact missing');
  const clone = {
    ...source,
    id: cloneId,
    valid_at: 900,
    invalid_at: 1_500,
    created_at: 900,
    updated_at: 1_500,
    ...overrides,
  };
  db.runSync(
    `INSERT INTO memory_facts (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    ...columns.map((column) => clone[column]),
  );
  replaceFactRetrievalTerms(rowToFact(clone as unknown as FactRow));
}

export function insertMemoryIngestionReceiptForWithdrawal(
  jobId: string,
  deterministicFactIdsJson: string,
): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_ingestion_receipts(
       job_id, attempt_number, episode_id, deterministic_fact_ids_json,
       provider_fact_ids_json, invalidated_fact_ids_json,
       bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json,
       active_focus_updated, open_threads_updated, provider_outcome,
       provider_outcome_code, persisted_at
     ) VALUES (?, 1, NULL, ?, '[]', '[]', '[]', '[]', 0, 0,
               'structural_only', NULL, 2)`,
    jobId,
    deterministicFactIdsJson,
  );
}

export function insertMemoryRetrievalEventForWithdrawal(
  id: string,
  selectedFactIdsJson: string,
  selectedEpisodeIdsJson: string,
  selectedFactCount: number,
  selectedEpisodeCount: number,
): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_retrieval_events(
       id, operation, mode, outcome, query_hash, query_length, query_unit_count,
       memory_conversation_id_hash, source_thread_id_hash, task_scope_present,
       candidate_fact_count, selected_fact_count, selected_fact_ids_json,
       candidate_episode_count, selected_episode_count, selected_episode_ids_json,
       plan_ms, fact_recall_ms, episode_recall_ms, candidate_fetch_ms, score_ms,
       selector_ms, total_ms, selector_mode, selector_outcome, barrier_outcome,
       barrier_wait_ms, barrier_queue_age_ms, created_at
     ) VALUES (?, 'prompt_assembly', 'query', 'completed', ?, 1, 1,
               NULL, NULL, 1, ?, ?, ?, ?, ?, ?,
               1, 1, 1, 1, 1, 0, 6, 'deterministic', 'not_requested', NULL,
               NULL, NULL, 2)`,
    id,
    'a'.repeat(64),
    selectedFactCount,
    selectedFactCount,
    selectedFactIdsJson,
    selectedEpisodeCount,
    selectedEpisodeCount,
    selectedEpisodeIdsJson,
  );
}

export function requireMemoryIngestionJob(
  input: Parameters<typeof enqueueIngestionJob>[0],
): NonNullable<ReturnType<typeof enqueueIngestionJob>> {
  const job = enqueueIngestionJob(input);
  if (!job) throw new Error('test ingestion job missing');
  return job;
}
