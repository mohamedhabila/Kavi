import type { getMemoryDb } from './sqlite-store';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureRetrievalEventSchema(db: MemoryDb): void {
  db.execSync(`
    DROP TABLE IF EXISTS memory_retrieval_log;

    CREATE TABLE IF NOT EXISTS memory_retrieval_events (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK(operation IN ('prompt_assembly', 'explicit_search', 'explicit_recall')),
      mode TEXT NOT NULL CHECK(mode IN ('query', 'recent', 'disabled')),
      outcome TEXT NOT NULL CHECK(outcome IN ('completed', 'degraded', 'failed', 'disabled')),
      query_hash TEXT NOT NULL CHECK(length(query_hash) = 64 AND query_hash NOT GLOB '*[^0-9a-f]*'),
      query_length INTEGER NOT NULL CHECK(query_length >= 0 AND query_length <= 20000),
      query_unit_count INTEGER NOT NULL CHECK(query_unit_count >= 0 AND query_unit_count <= 4096),
      memory_conversation_id_hash TEXT CHECK(memory_conversation_id_hash IS NULL OR (length(memory_conversation_id_hash) = 64 AND memory_conversation_id_hash NOT GLOB '*[^0-9a-f]*')),
      source_thread_id_hash TEXT CHECK(source_thread_id_hash IS NULL OR (length(source_thread_id_hash) = 64 AND source_thread_id_hash NOT GLOB '*[^0-9a-f]*')),
      task_scope_present INTEGER NOT NULL CHECK(task_scope_present IN (0, 1)),
      candidate_fact_count INTEGER NOT NULL CHECK(candidate_fact_count >= 0 AND candidate_fact_count <= 1000000),
      selected_fact_count INTEGER NOT NULL CHECK(selected_fact_count >= 0 AND selected_fact_count <= candidate_fact_count),
      selected_fact_ids_json TEXT NOT NULL,
      candidate_episode_count INTEGER NOT NULL CHECK(candidate_episode_count >= 0 AND candidate_episode_count <= 1000000),
      selected_episode_count INTEGER NOT NULL CHECK(selected_episode_count >= 0 AND selected_episode_count <= candidate_episode_count),
      selected_episode_ids_json TEXT NOT NULL,
      plan_ms INTEGER NOT NULL CHECK(plan_ms >= 0 AND plan_ms <= 600000),
      fact_recall_ms INTEGER NOT NULL CHECK(fact_recall_ms >= 0 AND fact_recall_ms <= 600000),
      episode_recall_ms INTEGER NOT NULL CHECK(episode_recall_ms >= 0 AND episode_recall_ms <= 600000),
      candidate_fetch_ms INTEGER NOT NULL CHECK(candidate_fetch_ms >= 0 AND candidate_fetch_ms <= 600000),
      score_ms INTEGER NOT NULL CHECK(score_ms >= 0 AND score_ms <= 600000),
      selector_ms INTEGER NOT NULL CHECK(selector_ms >= 0 AND selector_ms <= 600000),
      total_ms INTEGER NOT NULL CHECK(total_ms >= 0 AND total_ms <= 600000),
      selector_mode TEXT NOT NULL CHECK(selector_mode IN ('deterministic', 'semantic')),
      selector_outcome TEXT NOT NULL CHECK(selector_outcome IN ('not_requested', 'applied', 'deterministic_fallback')),
      barrier_outcome TEXT CHECK(barrier_outcome IS NULL OR barrier_outcome IN ('no_job', 'completed', 'degraded', 'timed_out')),
      barrier_wait_ms INTEGER CHECK(barrier_wait_ms IS NULL OR (barrier_wait_ms >= 0 AND barrier_wait_ms <= 600000)),
      barrier_queue_age_ms INTEGER CHECK(barrier_queue_age_ms IS NULL OR (barrier_queue_age_ms >= 0 AND barrier_queue_age_ms <= 2678400000)),
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      CHECK(selector_mode = 'semantic' OR selector_outcome = 'not_requested'),
      CHECK(
        (barrier_outcome IS NULL AND barrier_wait_ms IS NULL AND barrier_queue_age_ms IS NULL)
        OR (barrier_outcome IS NOT NULL AND barrier_wait_ms IS NOT NULL)
      ),
      CHECK(
        (mode = 'disabled' AND outcome = 'disabled'
          AND candidate_fact_count = 0 AND selected_fact_count = 0
          AND candidate_episode_count = 0 AND selected_episode_count = 0
          AND selected_fact_ids_json = '[]' AND selected_episode_ids_json = '[]'
          AND plan_ms = 0 AND fact_recall_ms = 0 AND episode_recall_ms = 0
          AND candidate_fetch_ms = 0 AND score_ms = 0 AND selector_ms = 0 AND total_ms = 0
          AND selector_mode = 'deterministic' AND selector_outcome = 'not_requested'
          AND barrier_outcome IS NULL AND barrier_wait_ms IS NULL AND barrier_queue_age_ms IS NULL)
        OR (mode != 'disabled' AND outcome != 'disabled')
      )
    );
    CREATE INDEX IF NOT EXISTS idx_memory_retrieval_events_thread
      ON memory_retrieval_events(source_thread_id_hash, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_retrieval_events_created
      ON memory_retrieval_events(created_at DESC, id DESC);
  `);
}

export function clearRetrievalEventStore(db: MemoryDb): void {
  db.runSync('DELETE FROM memory_retrieval_events');
}
