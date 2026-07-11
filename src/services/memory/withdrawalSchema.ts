import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureWithdrawalSchema(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_withdrawals (
      id TEXT PRIMARY KEY,
      target_fact_id TEXT NOT NULL UNIQUE,
      memory_conversation_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason = 'user_request'),
      withdrawn_at INTEGER NOT NULL CHECK(withdrawn_at >= 0)
    );
    CREATE TABLE IF NOT EXISTS memory_withdrawal_facts (
      withdrawal_id TEXT NOT NULL,
      fact_id TEXT NOT NULL PRIMARY KEY
    );
    CREATE INDEX IF NOT EXISTS idx_memory_withdrawal_facts_withdrawal
      ON memory_withdrawal_facts(withdrawal_id, fact_id);
    CREATE TABLE IF NOT EXISTS memory_withdrawal_sources (
      withdrawal_id TEXT NOT NULL,
      memory_conversation_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('message', 'turn', 'run')),
      source_id TEXT NOT NULL,
      PRIMARY KEY (
        withdrawal_id,
        memory_conversation_id,
        source_thread_id,
        task_id,
        source_kind,
        source_id
      )
    );
    CREATE INDEX IF NOT EXISTS idx_memory_withdrawal_sources_lookup
      ON memory_withdrawal_sources(
        memory_conversation_id,
        source_thread_id,
        task_id,
        source_kind,
        source_id,
        withdrawal_id
      );
  `);
}

export function clearWithdrawalStore(db: MemoryDb): void {
  db.execSync(`
    DELETE FROM memory_withdrawal_sources;
    DELETE FROM memory_withdrawal_facts;
    DELETE FROM memory_withdrawals;
  `);
}
