import type {
  MemoryRetrievalBarrierOutcome,
  MemoryRetrievalCandidateStrategy,
  MemoryRetrievalExpansion,
  MemoryRetrievalLocalSimilarityOutcome,
  MemoryRetrievalMode,
  MemoryRetrievalOperation,
  MemoryRetrievalOutcome,
  MemoryRetrievalSelectorMode,
  MemoryRetrievalSelectorOutcome,
} from './retrievalEventTypes';

export interface MemoryRetrievalEventRow {
  id: string;
  operation: MemoryRetrievalOperation;
  mode: MemoryRetrievalMode;
  outcome: MemoryRetrievalOutcome;
  query_hash: string;
  query_length: number;
  query_unit_count: number;
  memory_conversation_id_hash: string | null;
  source_thread_id_hash: string | null;
  task_scope_present: number;
  candidate_fact_count: number;
  selected_fact_count: number;
  selected_fact_ids_json: string;
  candidate_episode_count: number;
  selected_episode_count: number;
  selected_episode_ids_json: string;
  plan_ms: number;
  fact_recall_ms: number;
  episode_recall_ms: number;
  candidate_fetch_ms: number;
  score_ms: number;
  selector_ms: number;
  evidence_expansion_ms: number;
  total_ms: number;
  candidate_strategy: MemoryRetrievalCandidateStrategy;
  local_similarity_outcome: MemoryRetrievalLocalSimilarityOutcome;
  candidate_eligible_scan_count: number;
  candidate_pinned_count: number;
  candidate_exact_quoted_count: number;
  candidate_lexical_count: number;
  candidate_entity_count: number;
  candidate_temporal_count: number;
  candidate_local_similarity_count: number;
  candidate_union_count: number;
  candidate_diversified_count: number;
  candidate_union_ms: number;
  expansion_outcome: MemoryRetrievalExpansion['outcome'];
  expansion_requested_source_count: number;
  expansion_accepted_source_count: number;
  expansion_source_with_evidence_count: number;
  expansion_emitted_evidence_count: number;
  expansion_prompt_budget_dropped_count: number;
  expansion_prompt_chars: number;
  selector_mode: MemoryRetrievalSelectorMode;
  selector_outcome: MemoryRetrievalSelectorOutcome;
  barrier_outcome: MemoryRetrievalBarrierOutcome | null;
  barrier_wait_ms: number | null;
  barrier_queue_age_ms: number | null;
  created_at: number;
}
