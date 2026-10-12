import type { ForegroundScenarioMemoryItemsState } from './foregroundScenarioMemoryItemsEvidence';
import type { E2EScenarioTurnTrace } from './types';

/** What memory did on one turn: what its prompt showed, and whether extraction caught up. */
export type E2ERedactedMemoryTurnEvidence = {
  extractionSettled: boolean;
  extractionWaitMs: number;
  promptStatus: E2EScenarioTurnTrace['memoryPrompt']['status'];
  promptBuildCount: number;
  promptItemCount: number;
  promptTurnCount: number;
  maxPromptChars: number;
  maxPromptBuildMs: number;
};

export type E2ERedactedMemoryFinalEvidence = {
  itemCount: number;
  currentItemCount: number;
  supersededItemCount: number;
  pinnedItemCount: number;
  sensitiveItemCount: number;
  indexedTurnCount: number;
};

export function buildMemoryTurnEvidence(turn: E2EScenarioTurnTrace): E2ERedactedMemoryTurnEvidence {
  const builds = turn.memoryPrompt.builds;
  return {
    extractionSettled: turn.memoryExtractionSettled,
    extractionWaitMs: turn.memoryExtractionWaitMs,
    promptStatus: turn.memoryPrompt.status,
    promptBuildCount: builds.length,
    promptItemCount: new Set(builds.flatMap((build) => build.itemIds)).size,
    promptTurnCount: new Set(builds.flatMap((build) => build.turnIds)).size,
    maxPromptChars: Math.max(0, ...builds.map((build) => build.chars)),
    maxPromptBuildMs: Math.max(0, ...builds.map((build) => build.durationMs)),
  };
}

export function buildMemoryFinalEvidence(
  state: ForegroundScenarioMemoryItemsState,
): E2ERedactedMemoryFinalEvidence {
  const current = state.items.filter((item) => item.supersededBy === null);
  return {
    itemCount: state.items.length,
    currentItemCount: current.length,
    supersededItemCount: state.items.length - current.length,
    pinnedItemCount: current.filter((item) => item.pinned).length,
    sensitiveItemCount: current.filter((item) => item.sensitive).length,
    indexedTurnCount: state.indexedTurnCount,
  };
}
