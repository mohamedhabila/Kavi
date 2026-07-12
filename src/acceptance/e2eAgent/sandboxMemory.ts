// ---------------------------------------------------------------------------
// Kavi — E2E memory sandbox (Jest expo-sqlite mock)
// ---------------------------------------------------------------------------

import { closeMemoryDb, getMemoryDb } from '../../services/memory/database';
import { closeExecutionJournalDb } from '../../services/executionJournal/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../services/memory/schema';
import { countEpisodes } from '../../services/memory/episodes/queries';
import { countCompletedIngestionJobsForThread } from '../../services/memory/ingestionQueue';
import { listFacts } from '../../services/memory/facts/queries';
import type { MemoryFact } from '../../services/memory/facts/types';
import { resolveGraphWorkingBlockScope } from '../../engine/goals/graphTaskScope';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import { getWorkingBlock, type WorkingBlockLabel } from '../../services/memory/workingBlocks';

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
  ensureFactSchema();
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
  'memory_ingestion_receipts',
  'memory_migration_state',
  'memory_reflections',
  'memory_retrieval_events',
  'memory_retrieval_outcomes',
  'memory_tasks',
  'memory_verified_procedure_observations',
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

export function countE2ECompletedIngestionJobs(conversationId: string): number {
  return countCompletedIngestionJobsForThread(conversationId);
}

export function countE2EEpisodes(conversationId: string): number {
  return countEpisodes({ conversationId, threadId: conversationId });
}

export function readE2EWorkingBlockContent(
  conversationId: string,
  label: WorkingBlockLabel,
  graphSnapshots: ReadonlyArray<AgentRunControlGraphState> = [],
): string {
  const snapshot = graphSnapshots[graphSnapshots.length - 1];
  const scope = resolveGraphWorkingBlockScope({
    conversationId,
    graphState: snapshot,
  });
  return getWorkingBlock(label, scope)?.content ?? '';
}

export function findMemoryFactsMatching(params: {
  predicate: string;
  value: string;
}): MemoryFact[] {
  const predicate = params.predicate.trim().toLowerCase();
  const value = params.value.trim().toLowerCase();
  return listFacts({ includeInvalidated: false }).filter(
    (fact) =>
      fact.predicate.trim().toLowerCase() === predicate &&
      fact.objectText.trim().toLowerCase() === value &&
      fact.deletedAt == null &&
      fact.invalidAt == null,
  );
}
