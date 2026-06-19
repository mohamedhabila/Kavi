// ---------------------------------------------------------------------------
// Kavi — Chitchat memory ingestion fixture evaluator
// ---------------------------------------------------------------------------

import { drainIngestionQueue } from '../../services/memory/ingestionQueue';
import { listEpisodes } from '../../services/memory/episodes/queries';
import { recordCompletedTurnForMemory } from '../../services/memory/lifecycle';
import { getWorkingBlock } from '../../services/memory/workingBlocks';
import type { AcceptanceFixtureOutcome } from './types';
import type { MemoryChitchatIngestionFixture } from './memoryChitchatIngestionFixtures';

export async function evaluateMemoryChitchatIngestionFixture(
  fixture: MemoryChitchatIngestionFixture,
  now = 100,
): Promise<AcceptanceFixtureOutcome> {
  const recordResult = await recordCompletedTurnForMemory({
    threadId: fixture.threadId,
    messages: fixture.messages,
    threadTitle: fixture.threadTitle,
    now,
  });

  if (!recordResult.processed) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `turn not processed (${recordResult.skipped ?? 'unknown'})`,
    };
  }

  await drainIngestionQueue({
    loadMessagesForThread: () => fixture.messages,
    now,
  });

  const episodes = listEpisodes({ threadId: fixture.threadId, limit: 5 });
  if (episodes.length === 0) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: 'no episode persisted after drainIngestionQueue',
    };
  }

  const focus =
    getWorkingBlock('active_focus', {
      conversationId: fixture.threadId,
      threadId: fixture.threadId,
    })?.content ?? '';

  if (!focus.includes(fixture.expectedFocusToken)) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `active_focus missing token [${fixture.expectedFocusToken}]; got [${focus}]`,
    };
  }

  return {
    fixtureId: fixture.id,
    passed: true,
    detail: `episodes=${episodes.length}, focus token present`,
  };
}
