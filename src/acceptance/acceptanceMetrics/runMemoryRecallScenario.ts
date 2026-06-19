// ---------------------------------------------------------------------------
// Kavi — Run a 3-turn memory recall scenario (ingestion + retrieval)
// ---------------------------------------------------------------------------

import { drainIngestionQueue } from '../../services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { orchestrateMemoryRetrieval } from '../../services/memory/retrievalOrchestrator';
import { evaluateMemoryRecallResult } from './evaluateMemoryRecallResult';
import type { MemoryRecallFixture } from './memoryRecallFixtures';
import type { AcceptanceFixtureOutcome } from './types';

export async function runMemoryRecallScenario(
  fixture: MemoryRecallFixture,
  now = 100,
): Promise<AcceptanceFixtureOutcome> {
  const turn1Messages = fixture.turn1;
  const turn2Messages = [...fixture.turn1, ...fixture.turn2];

  await recordCompletedTurnForMemory({
    threadId: fixture.threadId,
    messages: turn1Messages,
    now,
  });
  await drainIngestionQueue({
    loadMessagesForThread: () => turn1Messages,
    now,
  });

  await recordCompletedTurnForMemory({
    threadId: fixture.threadId,
    messages: turn2Messages,
    now: now + 10,
  });
  await drainIngestionQueue({
    loadMessagesForThread: () => turn2Messages,
    now: now + 10,
  });

  const retrieval = await orchestrateMemoryRetrieval({
    userMessage: fixture.turn3Query,
    conversationId: fixture.threadId,
    limit: 8,
    now: now + 20,
  });

  return evaluateMemoryRecallResult({
    fixtureId: fixture.id,
    facts: retrieval.facts,
    requiredStructuralTokens: fixture.requiredStructuralTokens,
  });
}