/**
 * Mutable or derived state removed by an ordinary user-requested memory reset.
 * The causal ledgers and their canonical fact parents are intentionally absent.
 */
export const USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES = [
  'memory_verified_procedure_run_invalidations',
  'memory_verified_procedure_observations',
  'memory_verified_procedure_state',
  'memory_retrieval_outcomes',
  'memory_fact_observations',
  'memory_fact_evidence',
  'memory_fact_legacy_quarantine',
  'memory_fact_terms',
  'memory_fact_term_stats',
  'memory_episode_terms',
  'memory_episode_access_policies',
  'memory_episodes',
  'memory_fact_explicit_overrides',
  'memory_working_blocks',
  'memory_consolidation_state',
  'memory_migration_state',
  'memory_ingestion_receipts',
  'memory_ingestion_jobs',
  'memory_ingestion_source_snapshots',
  'memory_ingestion_job_sources',
  'memory_tasks',
  'memory_reflections',
  'memory_retrieval_events',
  'memory_entities',
] as const;

/** Contribution table schemas rebuilt only by privileged physical test cleanup. */
export const FULL_RESET_REBUILT_CONTRIBUTION_TABLES = [
  'memory_fact_contributions',
  'memory_fact_contribution_supersessions',
  'memory_fact_contribution_supersession_snapshots',
  'memory_fact_contribution_sources',
] as const;

/**
 * Table schemas retained by an ordinary reset. Causal payload parents are
 * physically purged; only the content-free retirement tables retain rows.
 */
export const USER_RESET_PRESERVED_STRUCTURED_MEMORY_TABLES = [
  ...FULL_RESET_REBUILT_CONTRIBUTION_TABLES,
  'memory_facts',
  'memory_source_retirement_groups',
  'memory_source_retirement_requests',
  'memory_retired_sources',
  'memory_retired_fact_contributions',
  'memory_retired_facts',
] as const;

/**
 * Immutable retirement tables dropped only by the privileged full-database
 * cleanup used for isolated evaluation and test teardown.
 */
export const FULL_RESET_DROPPED_RETIREMENT_TABLES = [
  'memory_source_retirement_requests',
  'memory_retired_sources',
  'memory_retired_fact_contributions',
  'memory_retired_facts',
  'memory_source_retirement_groups',
] as const;

/** External triggers survive retirement-table drops unless removed explicitly. */
export const FULL_RESET_DROPPED_RETIREMENT_PARENT_TRIGGERS = [
  'trg_memory_fact_contribution_delete_immutable',
  'trg_memory_fact_contribution_insert_immutable',
  'trg_memory_retired_fact_contribution_parent_identity_update',
  'trg_memory_retired_fact_parent_delete',
  'trg_memory_retired_fact_parent_insert',
  'trg_memory_retired_fact_parent_identity_update',
] as const;

/**
 * Tables that must be empty at both ends of an isolated evaluation. This is a
 * privileged physical reset classification, not the user-reset contract.
 */
export const CLEARED_STRUCTURED_MEMORY_TABLES = [
  ...USER_RESET_CLEARED_STRUCTURED_MEMORY_TABLES,
  ...FULL_RESET_REBUILT_CONTRIBUTION_TABLES,
  'memory_facts',
  ...FULL_RESET_DROPPED_RETIREMENT_TABLES,
] as const;

export const PRESERVED_STRUCTURED_MEMORY_TABLES = [
  'memory_vault_identity',
  'memory_episode_retrieval_index_meta',
  'memory_fact_contribution_admission',
] as const;
