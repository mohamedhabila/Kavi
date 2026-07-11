import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureProductExperienceObservationSchema(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_product_experience_observations (
      id TEXT PRIMARY KEY
        CHECK(length(id) = 83)
        CHECK(id GLOB 'product_experience_*')
        CHECK(id NOT GLOB '*[^a-z0-9_]*'),
      memory_owner_id TEXT NOT NULL CHECK(length(memory_owner_id) BETWEEN 1 AND 160),
      memory_conversation_id_hash TEXT NOT NULL
        CHECK(length(memory_conversation_id_hash) = 64)
        CHECK(memory_conversation_id_hash NOT GLOB '*[^0-9a-f]*'),
      source_thread_id_hash TEXT NOT NULL
        CHECK(length(source_thread_id_hash) = 64)
        CHECK(source_thread_id_hash NOT GLOB '*[^0-9a-f]*'),
      source_run_id_hash TEXT NOT NULL
        CHECK(length(source_run_id_hash) = 64)
        CHECK(source_run_id_hash NOT GLOB '*[^0-9a-f]*'),
      domain_id TEXT NOT NULL CHECK(length(domain_id) BETWEEN 1 AND 160),
      environment_id TEXT NOT NULL CHECK(length(environment_id) BETWEEN 1 AND 160),
      procedure_id TEXT NOT NULL CHECK(length(procedure_id) BETWEEN 1 AND 160),
      precondition_ids_json TEXT NOT NULL CHECK(length(precondition_ids_json) BETWEEN 2 AND 4096),
      precondition_ids_hash TEXT NOT NULL
        CHECK(length(precondition_ids_hash) = 64)
        CHECK(precondition_ids_hash NOT GLOB '*[^0-9a-f]*'),
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure')),
      authority TEXT NOT NULL CHECK(authority IN ('tool_observed', 'verified')),
      evidence_kind TEXT NOT NULL
        CHECK(evidence_kind IN ('tool_result', 'effect_receipt', 'runtime_verifier')),
      evidence_id_hash TEXT NOT NULL
        CHECK(length(evidence_id_hash) = 64)
        CHECK(evidence_id_hash NOT GLOB '*[^0-9a-f]*'),
      contract_version INTEGER NOT NULL CHECK(contract_version = 1),
      observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
      created_at INTEGER NOT NULL CHECK(created_at >= observed_at),
      UNIQUE(
        memory_owner_id,
        memory_conversation_id_hash,
        source_thread_id_hash,
        source_run_id_hash,
        domain_id,
        environment_id,
        procedure_id,
        precondition_ids_hash
      )
    );
    CREATE INDEX IF NOT EXISTS idx_product_experience_owner_recent
      ON memory_product_experience_observations(
        memory_owner_id,
        observed_at DESC,
        id DESC
      );
    CREATE INDEX IF NOT EXISTS idx_product_experience_exact_scope
      ON memory_product_experience_observations(
        memory_owner_id,
        memory_conversation_id_hash,
        source_thread_id_hash,
        domain_id,
        environment_id,
        procedure_id,
        precondition_ids_hash,
        observed_at DESC,
        id DESC
      );
  `);
}
