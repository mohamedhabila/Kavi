// ---------------------------------------------------------------------------
// Kavi — E2E memory sandbox (Jest expo-sqlite mock)
// ---------------------------------------------------------------------------

import { closeMemoryDb } from '../../services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../services/memory/schema';
import { ensureDefaultBlocks } from '../../services/memory/blocks';
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
  getExpoSqliteMock().__resetExpoSqliteForTests?.();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
}

export function teardownE2EMemorySandbox(): void {
  closeMemoryDb();
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
