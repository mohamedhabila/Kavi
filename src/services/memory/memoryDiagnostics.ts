// ---------------------------------------------------------------------------
// Kavi — Memory diagnostics snapshot
// ---------------------------------------------------------------------------
// Read-only aggregate for budget audit and retrieval log surfaces.
// Structural counts and IDs only — no message bodies or query text.
// ---------------------------------------------------------------------------

import {
  getRecentBudgetAuditEntries,
  type BudgetAuditEntry,
  type BudgetAuditLayer,
} from '../context/budgetAudit';
import { buildMemoryRetrievalScopeHash, readRecentMemoryRetrievalEvents } from './retrievalLog';
import type { MemoryRetrievalEvent } from './retrievalEventTypes';
import { canReadLongTermMemory } from './policy';

const DEFAULT_DIAGNOSTICS_LIMIT = 32;
const MAX_DIAGNOSTICS_LIMIT = 32;

export interface MemoryDiagnosticsSnapshot {
  threadId: string | null;
  budgetEntries: BudgetAuditEntry[];
  retrievalEntries: MemoryRetrievalEvent[];
}

export async function loadMemoryDiagnosticsSnapshot(
  options: {
    threadId?: string | null;
    limit?: number;
  } = {},
): Promise<MemoryDiagnosticsSnapshot> {
  const limit = Math.max(
    1,
    Math.min(options.limit ?? DEFAULT_DIAGNOSTICS_LIMIT, MAX_DIAGNOSTICS_LIMIT),
  );
  const threadId = options.threadId?.trim() || null;

  const recentBudget = getRecentBudgetAuditEntries(limit);
  const budgetEntries = threadId
    ? recentBudget.filter((entry) => entry.conversationId === threadId)
    : recentBudget;

  let retrievalEntries: MemoryRetrievalEvent[] = [];
  if (threadId && canReadLongTermMemory()) {
    try {
      const sourceThreadIdHash = await buildMemoryRetrievalScopeHash('source_thread', threadId);
      if (sourceThreadIdHash) {
        retrievalEntries = readRecentMemoryRetrievalEvents({ sourceThreadIdHash, limit });
      }
    } catch {
      retrievalEntries = [];
    }
  }

  return {
    threadId,
    budgetEntries,
    retrievalEntries,
  };
}

export function formatBudgetLayerBreakdown(layers: Record<BudgetAuditLayer, number>): string {
  return (Object.entries(layers) as Array<[BudgetAuditLayer, number]>)
    .filter(([, count]) => count > 0)
    .map(([layer, count]) => `${layer}:${count}`)
    .join(' · ');
}

export function formatRetrievalIdList(ids: ReadonlyArray<string>, maxVisible = 3): string {
  if (ids.length === 0) {
    return '—';
  }
  const visible = ids.slice(0, maxVisible).join(',');
  if (ids.length <= maxVisible) {
    return visible;
  }
  return `${visible},+${ids.length - maxVisible}`;
}
