import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureRetrievalEventSchema(db: MemoryDb): void {
  let existingColumns = db
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_retrieval_events)')
    .map((column) => column.name);
  const legacyOutcomeColumn = existingColumns.includes('local_semantic_outcome');
  const legacyCountColumn = existingColumns.includes('candidate_local_semantic_count');
  if (legacyOutcomeColumn !== legacyCountColumn) {
    throw new Error('memory_retrieval_local_similarity_schema_incomplete');
  }
  if (legacyOutcomeColumn && legacyCountColumn) {
    if (
      existingColumns.includes('local_similarity_outcome') ||
      existingColumns.includes('candidate_local_similarity_count')
    ) {
      throw new Error('memory_retrieval_local_similarity_schema_conflict');
    }
    db.execSync(`
      ALTER TABLE memory_retrieval_events
        RENAME COLUMN local_semantic_outcome TO local_similarity_outcome;
      ALTER TABLE memory_retrieval_events
        RENAME COLUMN candidate_local_semantic_count TO candidate_local_similarity_count;
    `);
    existingColumns = db
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_retrieval_events)')
      .map((column) => column.name);
  }
  if (existingColumns.length > 0) {
    const additions = [
      [
        'evidence_expansion_ms',
        'INTEGER NOT NULL DEFAULT 0 CHECK(evidence_expansion_ms >= 0 AND evidence_expansion_ms <= 600000)',
      ],
      [
        'expansion_outcome',
        "TEXT NOT NULL DEFAULT 'not_requested' CHECK(expansion_outcome IN ('not_requested', 'completed', 'scope_unavailable', 'failed'))",
      ],
      [
        'expansion_requested_source_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_requested_source_count >= 0 AND expansion_requested_source_count <= 1000000)',
      ],
      [
        'expansion_accepted_source_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_accepted_source_count >= 0 AND expansion_accepted_source_count <= 12)',
      ],
      [
        'expansion_source_with_evidence_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_source_with_evidence_count >= 0 AND expansion_source_with_evidence_count <= 12)',
      ],
      [
        'expansion_emitted_evidence_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_emitted_evidence_count >= 0 AND expansion_emitted_evidence_count <= 24)',
      ],
      [
        'expansion_prompt_budget_dropped_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_prompt_budget_dropped_count >= 0 AND expansion_prompt_budget_dropped_count <= 1000000)',
      ],
      [
        'expansion_prompt_chars',
        'INTEGER NOT NULL DEFAULT 0 CHECK(expansion_prompt_chars >= 0 AND expansion_prompt_chars <= 3200)',
      ],
      [
        'candidate_strategy',
        "TEXT NOT NULL DEFAULT 'not_requested' CHECK(candidate_strategy IN ('not_requested', 'lexical', 'hybrid'))",
      ],
      [
        'local_similarity_outcome',
        "TEXT NOT NULL DEFAULT 'not_requested' CHECK(local_similarity_outcome IN ('not_requested', 'unavailable', 'applied'))",
      ],
      [
        'candidate_eligible_scan_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_eligible_scan_count >= 0 AND candidate_eligible_scan_count <= 500)',
      ],
      [
        'candidate_pinned_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_pinned_count >= 0 AND candidate_pinned_count <= 2000)',
      ],
      [
        'candidate_exact_quoted_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_exact_quoted_count >= 0 AND candidate_exact_quoted_count <= 2000)',
      ],
      [
        'candidate_lexical_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_lexical_count >= 0 AND candidate_lexical_count <= 2000)',
      ],
      [
        'candidate_entity_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_entity_count >= 0 AND candidate_entity_count <= 32)',
      ],
      [
        'candidate_temporal_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_temporal_count >= 0 AND candidate_temporal_count <= 24)',
      ],
      [
        'candidate_local_similarity_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_local_similarity_count >= 0 AND candidate_local_similarity_count <= 32)',
      ],
      [
        'candidate_union_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_union_count >= 0 AND candidate_union_count <= 2000)',
      ],
      [
        'candidate_diversified_count',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_diversified_count >= 0 AND candidate_diversified_count <= 2000)',
      ],
      [
        'candidate_union_ms',
        'INTEGER NOT NULL DEFAULT 0 CHECK(candidate_union_ms >= 0 AND candidate_union_ms <= 600000)',
      ],
    ] as const;
    const missingAdditions = additions.filter(([name]) => !existingColumns.includes(name));
    if (missingAdditions.length > 0) {
      db.execSync(
        missingAdditions
          .map(
            ([name, definition]) =>
              `ALTER TABLE memory_retrieval_events ADD COLUMN ${name} ${definition};`,
          )
          .join('\n'),
      );
    }
  }
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
      evidence_expansion_ms INTEGER NOT NULL DEFAULT 0 CHECK(evidence_expansion_ms >= 0 AND evidence_expansion_ms <= 600000),
      total_ms INTEGER NOT NULL CHECK(total_ms >= 0 AND total_ms <= 600000),
      candidate_strategy TEXT NOT NULL DEFAULT 'not_requested' CHECK(candidate_strategy IN ('not_requested', 'lexical', 'hybrid')),
      local_similarity_outcome TEXT NOT NULL DEFAULT 'not_requested' CHECK(local_similarity_outcome IN ('not_requested', 'unavailable', 'applied')),
      candidate_eligible_scan_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_eligible_scan_count >= 0 AND candidate_eligible_scan_count <= 500),
      candidate_pinned_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_pinned_count >= 0 AND candidate_pinned_count <= 2000),
      candidate_exact_quoted_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_exact_quoted_count >= 0 AND candidate_exact_quoted_count <= 2000),
      candidate_lexical_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_lexical_count >= 0 AND candidate_lexical_count <= 2000),
      candidate_entity_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_entity_count >= 0 AND candidate_entity_count <= 32),
      candidate_temporal_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_temporal_count >= 0 AND candidate_temporal_count <= 24),
      candidate_local_similarity_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_local_similarity_count >= 0 AND candidate_local_similarity_count <= 32),
      candidate_union_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_union_count >= 0 AND candidate_union_count <= 2000),
      candidate_diversified_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_diversified_count >= 0 AND candidate_diversified_count <= 2000),
      candidate_union_ms INTEGER NOT NULL DEFAULT 0 CHECK(candidate_union_ms >= 0 AND candidate_union_ms <= 600000),
      expansion_outcome TEXT NOT NULL DEFAULT 'not_requested' CHECK(expansion_outcome IN ('not_requested', 'completed', 'scope_unavailable', 'failed')),
      expansion_requested_source_count INTEGER NOT NULL DEFAULT 0 CHECK(expansion_requested_source_count >= 0 AND expansion_requested_source_count <= 1000000),
      expansion_accepted_source_count INTEGER NOT NULL DEFAULT 0 CHECK(expansion_accepted_source_count >= 0 AND expansion_accepted_source_count <= 12),
      expansion_source_with_evidence_count INTEGER NOT NULL DEFAULT 0 CHECK(expansion_source_with_evidence_count >= 0 AND expansion_source_with_evidence_count <= 12),
      expansion_emitted_evidence_count INTEGER NOT NULL DEFAULT 0 CHECK(expansion_emitted_evidence_count >= 0 AND expansion_emitted_evidence_count <= 24),
      expansion_prompt_budget_dropped_count INTEGER NOT NULL DEFAULT 0 CHECK(expansion_prompt_budget_dropped_count >= 0 AND expansion_prompt_budget_dropped_count <= 1000000),
      expansion_prompt_chars INTEGER NOT NULL DEFAULT 0 CHECK(expansion_prompt_chars >= 0 AND expansion_prompt_chars <= 3200),
      selector_mode TEXT NOT NULL CHECK(selector_mode IN ('deterministic', 'semantic')),
      selector_outcome TEXT NOT NULL CHECK(selector_outcome IN ('not_requested', 'applied', 'deterministic_fallback')),
      barrier_outcome TEXT CHECK(barrier_outcome IS NULL OR barrier_outcome IN ('no_job', 'completed', 'degraded', 'timed_out')),
      barrier_wait_ms INTEGER CHECK(barrier_wait_ms IS NULL OR (barrier_wait_ms >= 0 AND barrier_wait_ms <= 600000)),
      barrier_queue_age_ms INTEGER CHECK(barrier_queue_age_ms IS NULL OR (barrier_queue_age_ms >= 0 AND barrier_queue_age_ms <= 2678400000)),
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      CHECK(total_ms >= evidence_expansion_ms),
      CHECK(candidate_union_ms <= fact_recall_ms),
      CHECK(candidate_diversified_count <= candidate_union_count),
      CHECK(local_similarity_outcome = 'applied' OR candidate_local_similarity_count = 0),
      CHECK(
        candidate_strategy != 'not_requested'
        OR (local_similarity_outcome = 'not_requested'
          AND candidate_eligible_scan_count = 0
          AND candidate_pinned_count = 0
          AND candidate_exact_quoted_count = 0
          AND candidate_lexical_count = 0
          AND candidate_entity_count = 0
          AND candidate_temporal_count = 0
          AND candidate_local_similarity_count = 0
          AND candidate_union_count = 0
          AND candidate_diversified_count = 0
          AND candidate_union_ms = 0)
      ),
      CHECK(
        candidate_strategy != 'lexical'
        OR (local_similarity_outcome = 'not_requested'
          AND candidate_eligible_scan_count = 0
          AND candidate_entity_count = 0
          AND candidate_temporal_count = 0
          AND candidate_local_similarity_count = 0
          AND candidate_union_count = candidate_fact_count
          AND candidate_diversified_count = candidate_fact_count
          AND candidate_union_ms = 0)
      ),
      CHECK(
        candidate_strategy != 'hybrid'
        OR (candidate_fact_count <= 2000
          AND candidate_pinned_count <= 64
          AND candidate_exact_quoted_count <= 24
          AND candidate_entity_count <= candidate_eligible_scan_count
          AND candidate_temporal_count <= candidate_eligible_scan_count
          AND candidate_local_similarity_count <= candidate_eligible_scan_count
          AND candidate_fact_count <= candidate_union_count
          AND candidate_union_count <= candidate_pinned_count + candidate_exact_quoted_count
            + candidate_lexical_count + candidate_entity_count + candidate_temporal_count
            + candidate_local_similarity_count
          AND candidate_diversified_count <= candidate_fact_count)
      ),
      CHECK(expansion_outcome != 'failed' OR outcome IN ('degraded', 'failed')),
      CHECK(expansion_accepted_source_count <= expansion_requested_source_count),
      CHECK(expansion_source_with_evidence_count <= expansion_accepted_source_count),
      CHECK(
        (expansion_outcome = 'not_requested'
          AND expansion_requested_source_count = 0
          AND expansion_accepted_source_count = 0
          AND expansion_source_with_evidence_count = 0
          AND expansion_emitted_evidence_count = 0
          AND expansion_prompt_budget_dropped_count = 0
          AND expansion_prompt_chars = 0
          AND evidence_expansion_ms = 0)
        OR (expansion_outcome = 'scope_unavailable'
          AND expansion_accepted_source_count = 0
          AND expansion_source_with_evidence_count = 0
          AND expansion_emitted_evidence_count = 0
          AND expansion_prompt_budget_dropped_count = 0
          AND expansion_prompt_chars = 0
          AND evidence_expansion_ms = 0)
        OR (expansion_outcome = 'failed'
          AND expansion_accepted_source_count = 0
          AND expansion_source_with_evidence_count = 0
          AND expansion_emitted_evidence_count = 0
          AND expansion_prompt_budget_dropped_count = 0
          AND expansion_prompt_chars = 0)
        OR (expansion_outcome = 'completed'
          AND ((expansion_emitted_evidence_count = 0 AND expansion_prompt_chars = 0)
            OR (expansion_emitted_evidence_count > 0
              AND expansion_source_with_evidence_count > 0
              AND expansion_prompt_chars > 0)))
      ),
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
          AND candidate_fetch_ms = 0 AND score_ms = 0 AND selector_ms = 0
          AND evidence_expansion_ms = 0 AND total_ms = 0
          AND candidate_strategy = 'not_requested'
          AND expansion_outcome = 'not_requested'
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
