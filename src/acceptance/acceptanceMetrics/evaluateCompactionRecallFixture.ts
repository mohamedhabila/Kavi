// ---------------------------------------------------------------------------
// Kavi — Compaction recall fixture evaluator
// ---------------------------------------------------------------------------

import { buildPostCompactionSystemContent } from '../../services/context/postCompactionReinject';
import { applyCompactionResultToWorkingMessages } from '../../engine/orchestratorCompaction';
import type { CompactResult } from '../../services/context/types';
import type { Message } from '../../types/message';
import type { AcceptanceFixtureOutcome } from './types';
import type { CompactionRecallFixture } from './compactionRecallFixtures';

function hasMarkers(content: string, markers: ReadonlyArray<string>): string | undefined {
  for (const marker of markers) {
    if (!content.includes(marker)) {
      return marker;
    }
  }
  return undefined;
}

export function evaluateCompactionRecallFixture(
  fixture: CompactionRecallFixture,
): AcceptanceFixtureOutcome {
  const reinjectedContent = buildPostCompactionSystemContent({
    summary: '[Conversation Summary]\n\n## Task Overview\nLong transcript compacted.',
    goalsPromptSection: fixture.goalsPromptSection,
    profileSections: fixture.profileSections,
  });

  const missingFromBuilder = hasMarkers(reinjectedContent, [
    ...fixture.requiredGoalMarkers,
    ...fixture.requiredProfileMarkers,
  ]);
  if (missingFromBuilder) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `post-compaction builder missing marker: ${missingFromBuilder}`,
    };
  }

  const priorMessages: Message[] = [
    { id: 'user-1', role: 'user', content: 'Start task', timestamp: 1 },
    { id: 'assistant-1', role: 'assistant', content: 'Working...', timestamp: 2 },
    { id: 'user-2', role: 'user', content: 'Continue task', timestamp: 3 },
    { id: 'assistant-2', role: 'assistant', content: 'Still working...', timestamp: 4 },
  ];
  const compactResult: CompactResult = {
    ok: true,
    compacted: true,
    tier: 'aggressive',
    result: {
      summary: '[Conversation Summary]\n\n## Task Overview\nLong transcript compacted.',
      firstKeptEntryId: 'user-2',
      tokensBefore: 48_000,
      tokensAfter: 9_000,
    },
  };

  const applied = applyCompactionResultToWorkingMessages(priorMessages, compactResult, {
    goalsPromptSection: fixture.goalsPromptSection,
    profileSections: fixture.profileSections,
  });
  const systemMessage = applied.messages.find((message) => message.role === 'system');
  const systemContent = typeof systemMessage?.content === 'string' ? systemMessage.content : '';

  const missingFromTranscript = hasMarkers(systemContent, [
    ...fixture.requiredGoalMarkers,
    ...fixture.requiredProfileMarkers,
  ]);
  if (missingFromTranscript) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `compacted transcript missing marker: ${missingFromTranscript}`,
    };
  }

  return { fixtureId: fixture.id, passed: true };
}
