// ---------------------------------------------------------------------------
// Kavi — E2E memory sandbox (Jest expo-sqlite mock)
// ---------------------------------------------------------------------------

import { closeMemoryDb, getMemoryDb } from '../../services/memory/database';
import { closeExecutionJournalDb } from '../../services/executionJournal/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../services/memory/schema';
import {
  ensureMemoryCoreSchema,
  resetMemoryCoreSchemaCacheForTests,
} from '../../services/memory/core/memorySchema';

type ExpoSqliteMock = {
  __resetExpoSqliteForTests?: () => void;
};

function getExpoSqliteMock(): ExpoSqliteMock {
  return jest.requireMock('expo-sqlite') as ExpoSqliteMock;
}

export function resetE2EMemorySandbox(): void {
  closeMemoryDb();
  closeExecutionJournalDb();
  getExpoSqliteMock().__resetExpoSqliteForTests?.();
  resetFactSchemaCacheForTests();
  resetMemoryCoreSchemaCacheForTests();
  ensureFactSchema();
  ensureMemoryCoreSchema();
}

export const E2E_RESETTABLE_MEMORY_TABLES = [
  'memory_consolidation_state',
  'memory_entities',
  'memory_episodes',
  'memory_fact_evidence',
  'memory_fact_term_stats',
  'memory_fact_terms',
  'memory_facts',
  'memory_ingestion_jobs',
  'memory_ingestion_source_snapshots',
  'memory_ingestion_structural_receipts',
  'memory_ingestion_receipts',
  'memory_items',
  'memory_migration_state',
  'memory_capture_cursor',
  'memory_prompt_log',
  'memory_reflections',
  'memory_retrieval_events',
  'memory_retrieval_outcomes',
  'memory_tasks',
  'memory_verified_procedure_observations',
  'memory_turns',
  'memory_working_blocks',
] as const;

export function assertE2EMemorySandboxReset(): void {
  const db = getMemoryDb();
  for (const table of E2E_RESETTABLE_MEMORY_TABLES) {
    const row = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    const count = Number(row?.count ?? 0);
    if (count !== 0) {
      throw new Error(`E2E memory reset left ${count} row(s) in ${table}.`);
    }
  }
}

export function teardownE2EMemorySandbox(): void {
  closeMemoryDb();
  closeExecutionJournalDb();
  getExpoSqliteMock().__resetExpoSqliteForTests?.();
}
