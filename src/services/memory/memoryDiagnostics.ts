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
import { readRecentRetrievals, type RetrievalLogEntry } from './retrievalLog';

const DEFAULT_DIAGNOSTICS_LIMIT = 32;
const MAX_DIAGNOSTICS_LIMIT = 32;

export interface MemoryDiagnosticsSnapshot {
  threadId: string | null;
  budgetEntries: BudgetAuditEntry[];
  retrievalEntries: RetrievalLogEntry[];
}

export function loadMemoryDiagnosticsSnapshot(options: {
  threadId?: string | null;
  limit?: number;
} = {}): MemoryDiagnosticsSnapshot {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_DIAGNOSTICS_LIMIT, MAX_DIAGNOSTICS_LIMIT));
  const threadId = options.threadId?.trim() || null;

  const recentBudget = getRecentBudgetAuditEntries(limit);
  const budgetEntries = threadId
    ? recentBudget.filter((entry) => entry.conversationId === threadId)
    : recentBudget;

  const retrievalEntries = threadId
    ? readRecentRetrievals({ threadId, limit })
    : [];

  return {
    threadId,
    budgetEntries,
    retrievalEntries,
  };
}

export function formatBudgetLayerBreakdown(
  layers: Record<BudgetAuditLayer, number>,
): string {
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