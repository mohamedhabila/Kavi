import type { getMemoryDb } from '../database';
import {
  VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH,
  VERIFIED_PROCEDURE_POLICY_CONTRACT_VERSION,
} from './policyContract';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureVerifiedProcedureObservationSchema(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_verified_procedure_state (
      memory_owner_id TEXT PRIMARY KEY CHECK(length(memory_owner_id) BETWEEN 1 AND 160),
      restrictive_authority_revision INTEGER NOT NULL
        CHECK(restrictive_authority_revision BETWEEN 0 AND 9007199254740991),
      projection_revision INTEGER NOT NULL
        CHECK(projection_revision BETWEEN restrictive_authority_revision AND 9007199254740991)
    );
    CREATE TABLE IF NOT EXISTS memory_verified_procedure_run_invalidations (
      memory_owner_id TEXT NOT NULL CHECK(length(memory_owner_id) BETWEEN 1 AND 160),
      source_run_id_hash TEXT NOT NULL
        CHECK(length(source_run_id_hash) = 64)
        CHECK(source_run_id_hash NOT GLOB '*[^0-9a-f]*'),
      invalidated_at INTEGER NOT NULL CHECK(invalidated_at >= 0),
      restrictive_authority_revision INTEGER NOT NULL
        CHECK(restrictive_authority_revision BETWEEN 1 AND 9007199254740991),
      PRIMARY KEY(memory_owner_id, source_run_id_hash)
    );
    CREATE TABLE IF NOT EXISTS memory_verified_procedure_observations (
      id TEXT PRIMARY KEY
        CHECK(length(id) = 83)
        CHECK(id GLOB 'verified_procedure_*')
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
      procedure_id TEXT NOT NULL CHECK(length(procedure_id) BETWEEN 1 AND 160),
      procedure_contract_digest TEXT NOT NULL
        CHECK(length(procedure_contract_digest) = 64)
        CHECK(procedure_contract_digest NOT GLOB '*[^0-9a-f]*'),
      platform TEXT NOT NULL CHECK(platform IN ('android', 'ios')),
      precondition_ids_json TEXT NOT NULL CHECK(length(precondition_ids_json) BETWEEN 2 AND 4096),
      precondition_ids_hash TEXT NOT NULL
        CHECK(length(precondition_ids_hash) = 64)
        CHECK(precondition_ids_hash NOT GLOB '*[^0-9a-f]*'),
      evidence_manifest_json TEXT NOT NULL
        CHECK(length(evidence_manifest_json) BETWEEN 2 AND ${VERIFIED_PROCEDURE_MAX_EVIDENCE_MANIFEST_LENGTH}),
      evidence_manifest_digest TEXT NOT NULL
        CHECK(length(evidence_manifest_digest) = 64)
        CHECK(evidence_manifest_digest NOT GLOB '*[^0-9a-f]*'),
      evidence_id_digest TEXT NOT NULL
        CHECK(length(evidence_id_digest) = 64)
        CHECK(evidence_id_digest NOT GLOB '*[^0-9a-f]*'),
      linkage_digest TEXT NOT NULL
        CHECK(length(linkage_digest) = 64)
        CHECK(linkage_digest NOT GLOB '*[^0-9a-f]*'),
      terminal_proof_digest TEXT NOT NULL
        CHECK(length(terminal_proof_digest) = 64)
        CHECK(terminal_proof_digest NOT GLOB '*[^0-9a-f]*'),
      contract_version INTEGER NOT NULL CHECK(contract_version = ${VERIFIED_PROCEDURE_POLICY_CONTRACT_VERSION}),
      observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
      created_at INTEGER NOT NULL CHECK(created_at >= observed_at),
      UNIQUE(
        memory_owner_id,
        source_run_id_hash,
        procedure_id,
        procedure_contract_digest,
        platform,
        precondition_ids_hash
      )
    );
    CREATE INDEX IF NOT EXISTS idx_verified_procedure_owner_recent
      ON memory_verified_procedure_observations(
        memory_owner_id,
        observed_at DESC,
        id DESC
      );
    CREATE INDEX IF NOT EXISTS idx_verified_procedure_exact_scope
      ON memory_verified_procedure_observations(
        memory_owner_id,
        procedure_id,
        procedure_contract_digest,
        platform,
        precondition_ids_hash,
        observed_at DESC,
        id DESC
      );
    CREATE INDEX IF NOT EXISTS idx_verified_procedure_provenance
      ON memory_verified_procedure_observations(
        memory_owner_id,
        memory_conversation_id_hash,
        source_thread_id_hash,
        source_run_id_hash
      );
    CREATE INDEX IF NOT EXISTS idx_verified_procedure_run_invalidations_recent
      ON memory_verified_procedure_run_invalidations(
        memory_owner_id,
        restrictive_authority_revision DESC,
        source_run_id_hash
      );
  `);
}
