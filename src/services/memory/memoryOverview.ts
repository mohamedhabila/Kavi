// ---------------------------------------------------------------------------
// Kavi — Memory overview snapshot
// ---------------------------------------------------------------------------
// Read-only aggregate for the Memory screen Overview tab. Uses structural
// SQLite reads only — no NLP, no heuristics.
// ---------------------------------------------------------------------------

import { listFacts } from './facts/queries';
import type { MemoryFact } from './facts/types';
import { countPendingIngestionJobs } from './ingestionQueue';
import { getLatestActiveMemoryTask, type MemoryTask } from './tasks';
import { listRecentWorkingBlocks, type WorkingMemoryBlock } from './workingBlocks';
import {
  getConsolidationStatusSnapshot,
  type ConsolidationStatusSnapshot,
} from './consolidationStatus';

export interface MemoryOverviewSnapshot {
  focus: WorkingMemoryBlock | null;
  activeTask: MemoryTask | null;
  recentFacts: MemoryFact[];
  consolidation: ConsolidationStatusSnapshot;
  pendingIngestionJobs: number;
}

export function loadMemoryOverviewSnapshot(
  options: {
    recentFactLimit?: number;
  } = {},
): MemoryOverviewSnapshot {
  const limit = Math.max(1, Math.min(options.recentFactLimit ?? 8, 50));

  return {
    focus: listRecentWorkingBlocks('active_focus', 1)[0] ?? null,
    activeTask: getLatestActiveMemoryTask(),
    recentFacts: listFacts({ limit }),
    consolidation: getConsolidationStatusSnapshot(),
    pendingIngestionJobs: countPendingIngestionJobs(),
  };
}
