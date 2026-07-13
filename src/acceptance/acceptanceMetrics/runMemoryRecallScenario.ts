// ---------------------------------------------------------------------------
// Kavi — Run a 3-turn memory recall scenario (ingestion + retrieval)
// ---------------------------------------------------------------------------

import {
  drainIngestionQueue,
  getIngestionJob,
  type IngestionJob,
} from '../../services/memory/ingestionQueue';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { orchestrateMemoryRetrieval } from '../../services/memory/retrievalOrchestrator';
import { resolveLocalMemoryAccessScope } from '../../services/memory/memoryScopeStore';
import { evaluateMemoryRecallResult } from './evaluateMemoryRecallResult';
import type { MemoryRecallFixture } from './memoryRecallFixtures';
import type { AcceptanceFixtureOutcome } from './types';

const MEMORY_INGESTION_WAIT_TIMEOUT_MS = 5_000;
const MEMORY_INGESTION_INITIAL_POLL_MS = 2;
const MEMORY_INGESTION_MAX_POLL_MS = 32;

async function waitForCompletedIngestionJob(jobId: string): Promise<IngestionJob> {
  const deadline = Date.now() + MEMORY_INGESTION_WAIT_TIMEOUT_MS;
  let pollDelayMs = MEMORY_INGESTION_INITIAL_POLL_MS;

  while (true) {
    const job = getIngestionJob(jobId);
    if (!job) {
      throw new Error(`Memory ingestion job ${jobId} disappeared before completion`);
    }
    if (job.status === 'completed_structural' || job.status === 'completed_enriched') {
      return job;
    }
    if (job.status === 'degraded' || job.status === 'failed') {
      throw new Error(
        `Memory ingestion job ${jobId} became unavailable (${job.status}:${job.outcomeCode ?? 'unknown'})`,
      );
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for memory ingestion job ${jobId} (${job.status})`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollDelayMs, remainingMs)));
    pollDelayMs = Math.min(pollDelayMs * 2, MEMORY_INGESTION_MAX_POLL_MS);
  }
}

function requireEnqueuedJobId(
  fixtureId: string,
  turn: 1 | 2,
  result: Awaited<ReturnType<typeof recordCompletedTurnForMemory>>,
): string {
  if (!result.processed || !result.enqueued || !result.jobId) {
    throw new Error(
      `Memory recall fixture ${fixtureId} turn ${turn} was not enqueued (${result.skipped ?? 'unknown'})`,
    );
  }
  return result.jobId;
}

export async function runMemoryRecallScenario(
  fixture: MemoryRecallFixture,
  now = 100,
): Promise<AcceptanceFixtureOutcome> {
  const turn1Messages = fixture.turn1;
  const turn2Messages = [...fixture.turn1, ...fixture.turn2];
  const turn1SourceEndMessageId = fixture.turn1[fixture.turn1.length - 1]?.id;
  const turn2SourceEndMessageId = fixture.turn2[fixture.turn2.length - 1]?.id;
  if (!turn1SourceEndMessageId || !turn2SourceEndMessageId) {
    throw new Error(`Memory recall fixture ${fixture.id} is missing a final assistant message`);
  }

  const turn1Result = await recordCompletedTurnForMemory({
    threadId: fixture.threadId,
    messages: turn1Messages,
    sourceEndMessageId: turn1SourceEndMessageId,
    now,
  });
  const turn1JobId = requireEnqueuedJobId(fixture.id, 1, turn1Result);
  await drainIngestionQueue({
    now,
  });
  await waitForCompletedIngestionJob(turn1JobId);

  const turn2Result = await recordCompletedTurnForMemory({
    threadId: fixture.threadId,
    messages: turn2Messages,
    sourceEndMessageId: turn2SourceEndMessageId,
    now: now + 10,
  });
  const turn2JobId = requireEnqueuedJobId(fixture.id, 2, turn2Result);
  await drainIngestionQueue({
    now: now + 10,
  });
  await waitForCompletedIngestionJob(turn2JobId);

  const retrieval = await orchestrateMemoryRetrieval({
    userMessage: fixture.turn3Query,
    memoryScope: resolveLocalMemoryAccessScope({
      memoryConversationId: fixture.threadId,
      sourceThreadId: fixture.threadId,
      personaId: 'default',
      taskId: null,
    }),
    limit: 8,
    now: now + 20,
  });

  return evaluateMemoryRecallResult({
    fixtureId: fixture.id,
    facts: retrieval.facts,
    requiredStructuralTokens: fixture.requiredStructuralTokens,
  });
}
