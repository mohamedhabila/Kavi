import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureRetrievalOutcomeSchema(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_retrieval_outcomes (
      retrieval_event_id TEXT PRIMARY KEY
        CHECK(length(retrieval_event_id) BETWEEN 17 AND 128)
        CHECK(retrieval_event_id GLOB 'retrieval_event_*')
        CHECK(retrieval_event_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
      memory_owner_id TEXT NOT NULL CHECK(length(memory_owner_id) BETWEEN 1 AND 160),
      memory_conversation_id_hash TEXT NOT NULL
        CHECK(length(memory_conversation_id_hash) = 64)
        CHECK(memory_conversation_id_hash NOT GLOB '*[^0-9a-f]*'),
      source_thread_id_hash TEXT NOT NULL
        CHECK(length(source_thread_id_hash) = 64)
        CHECK(source_thread_id_hash NOT GLOB '*[^0-9a-f]*'),
      assistant_message_id_hash TEXT NOT NULL
        CHECK(length(assistant_message_id_hash) = 64)
        CHECK(assistant_message_id_hash NOT GLOB '*[^0-9a-f]*'),
      outcome TEXT NOT NULL CHECK(outcome IN ('helpful', 'wrong', 'irrelevant')),
      evidence_source TEXT NOT NULL CHECK(evidence_source = 'user_explicit'),
      contract_version INTEGER NOT NULL CHECK(contract_version = 1),
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_retrieval_outcomes_scope
      ON memory_retrieval_outcomes(
        memory_owner_id,
        memory_conversation_id_hash,
        source_thread_id_hash,
        updated_at DESC,
        retrieval_event_id
      );
    CREATE INDEX IF NOT EXISTS idx_memory_retrieval_outcomes_message
      ON memory_retrieval_outcomes(
        memory_owner_id,
        source_thread_id_hash,
        assistant_message_id_hash
      );
    CREATE TRIGGER IF NOT EXISTS trg_memory_retrieval_event_delete_outcomes
      AFTER DELETE ON memory_retrieval_events
      BEGIN
        DELETE FROM memory_retrieval_outcomes
         WHERE retrieval_event_id = OLD.id;
      END;
  `);
}
