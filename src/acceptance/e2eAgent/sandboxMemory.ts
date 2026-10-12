// ---------------------------------------------------------------------------
// Kavi — E2E memory sandbox (Jest expo-sqlite mock)
// ---------------------------------------------------------------------------

import { closeMemoryDb, getMemoryDb } from '../../services/memory/database';
import { closeExecutionJournalDb } from '../../services/executionJournal/database';
import { closeRemindersDb } from '../../services/scheduler/reminders/database';
import { closeTranscriptArchiveDb } from '../../services/transcriptArchive/database';
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

/**
 * Resetting the mock closes every SQLite connection, so each store that keeps one open is
 * closed first and reopens on its next use instead of holding a dead handle.
 */
function resetEveryDatabase(): void {
  closeMemoryDb();
  closeExecutionJournalDb();
  closeRemindersDb();
  closeTranscriptArchiveDb();
  getExpoSqliteMock().__resetExpoSqliteForTests?.();
}

export function resetE2EMemorySandbox(): void {
  resetEveryDatabase();
  resetMemoryCoreSchemaCacheForTests();
  ensureMemoryCoreSchema();
}

export const E2E_RESETTABLE_MEMORY_TABLES = [
  'memory_items',
  'memory_capture_cursor',
  'memory_prompt_log',
  'memory_turns',
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
  resetEveryDatabase();
}
