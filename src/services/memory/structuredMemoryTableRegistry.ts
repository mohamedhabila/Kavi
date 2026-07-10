export const CLEARED_STRUCTURED_MEMORY_TABLES = [
  'memory_fact_observations',
  'memory_fact_evidence',
  'memory_fact_terms',
  'memory_fact_term_stats',
  'memory_episode_terms',
  'memory_episode_access_policies',
  'memory_episodes',
  'memory_facts',
  'memory_blocks',
  'memory_working_blocks',
  'memory_consolidation_state',
  'memory_migration_state',
  'memory_ingestion_receipts',
  'memory_ingestion_jobs',
  'memory_tasks',
  'memory_reflections',
  'memory_chunks',
  'memory_retrieval_events',
  'memory_withdrawal_sources',
  'memory_withdrawal_facts',
  'memory_withdrawals',
  'memory_entities',
] as const;

export const PRESERVED_STRUCTURED_MEMORY_TABLES = [
  'memory_vault_identity',
  'memory_episode_retrieval_index_meta',
] as const;
