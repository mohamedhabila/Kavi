// ---------------------------------------------------------------------------
// Kavi — Compaction recall fixture evaluator
// ---------------------------------------------------------------------------

import { applyCompactionResultToWorkingMessages } from '../../engine/orchestratorCompaction';
import { buildAgentTurnPromptBundle } from '../../engine/graph/agentTurnPromptBundle';
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

function countOccurrences(content: string, marker: string): number {
  if (marker.length === 0) {
    return 0;
  }

  return content.split(marker).length - 1;
}

export function evaluateCompactionRecallFixture(
  fixture: CompactionRecallFixture,
): AcceptanceFixtureOutcome {
  const currentTurnPrompt = buildAgentTurnPromptBundle({
    effectiveForceTextThisTurn: false,
    goalsPromptSection: fixture.goalsPromptSection,
    groundedRequestScopedTools: [],
    iteration: 1,
    maxToolIterations: 8,
    resolvedPrompt: 'You are Kavi, a helpful mobile assistant.',
    selectedTools: [],
    skillPrompts: '',
    toolingEnabledForProvider: false,
  }).enrichedSystemPrompt;

  const missingFromCurrentPrompt = hasMarkers(currentTurnPrompt, fixture.requiredGoalMarkers);
  if (missingFromCurrentPrompt) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `current-turn prompt missing graph marker: ${missingFromCurrentPrompt}`,
    };
  }

  const duplicatedCurrentGoalMarker = fixture.requiredGoalMarkers.find(
    (marker) => countOccurrences(currentTurnPrompt, marker) !== 1,
  );
  if (duplicatedCurrentGoalMarker) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `current-turn prompt graph marker must occur exactly once: ${duplicatedCurrentGoalMarker}`,
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

  const applied = applyCompactionResultToWorkingMessages(priorMessages, compactResult);
  const systemMessage = applied.messages.find((message) => message.role === 'system');
  const systemContent = typeof systemMessage?.content === 'string' ? systemMessage.content : '';

  const missingFromTranscript = hasMarkers(systemContent, fixture.requiredSummaryMarkers);
  if (missingFromTranscript) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `compacted transcript missing summary marker: ${missingFromTranscript}`,
    };
  }

  const staleGoalMarker = fixture.requiredGoalMarkers.find((marker) =>
    systemContent.includes(marker),
  );
  if (staleGoalMarker) {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `compacted transcript retained stale graph marker: ${staleGoalMarker}`,
    };
  }

  return { fixtureId: fixture.id, passed: true };
}
