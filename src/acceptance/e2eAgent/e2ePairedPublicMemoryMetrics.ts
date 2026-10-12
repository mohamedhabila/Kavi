// ---------------------------------------------------------------------------
// Kavi — Paired E2E public memory metrics
// ---------------------------------------------------------------------------
// How the turns of one paired condition read memory, from the memory prompt log the app
// writes for every request: whether each turn's reads were recorded, opted out (memory
// off) or missing, and how many distinct memories and past exchanges they selected. Counts
// only — no ids or text reach the public report.
// ---------------------------------------------------------------------------

import type { E2EScenarioTurnTrace } from './types';

export type E2EPairedPublicMemoryMetrics = Readonly<{
  turnStatusCounts: Readonly<{ recorded: number; missing: number; optOut: number }>;
  buildCount: number;
  selectedItemCount: number;
  selectedPastTurnCount: number;
  promptChars: number;
}>;

export function buildE2EPairedPublicMemoryMetrics(
  turnTraces: ReadonlyArray<Pick<E2EScenarioTurnTrace, 'memoryPrompt'>>,
): E2EPairedPublicMemoryMetrics {
  const turnStatusCounts = { recorded: 0, missing: 0, optOut: 0 };
  const itemIds = new Set<string>();
  const pastTurnIds = new Set<string>();
  let buildCount = 0;
  let promptChars = 0;
  for (const { memoryPrompt } of turnTraces) {
    if (memoryPrompt.status === 'recorded') turnStatusCounts.recorded += 1;
    else if (memoryPrompt.status === 'opt_out') turnStatusCounts.optOut += 1;
    else turnStatusCounts.missing += 1;
    for (const build of memoryPrompt.builds) {
      buildCount += 1;
      promptChars += build.chars;
      for (const id of build.itemIds) itemIds.add(id);
      for (const id of build.turnIds) pastTurnIds.add(id);
    }
  }
  return {
    turnStatusCounts,
    buildCount,
    selectedItemCount: itemIds.size,
    selectedPastTurnCount: pastTurnIds.size,
    promptChars,
  };
}
