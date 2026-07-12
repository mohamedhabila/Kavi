import type { ConversationUsageEntry } from '../../types/usage';
import type { E2EEstimatedCostSummary } from './types';

export function aggregateE2EEstimatedCost(
  entries: ReadonlyArray<Pick<ConversationUsageEntry, 'estimatedCost'>>,
): E2EEstimatedCostSummary {
  if (entries.length === 0) return { status: 'unavailable', usd: null };
  let usd = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.estimatedCost) || entry.estimatedCost < 0) {
      return { status: 'unavailable', usd: null };
    }
    usd += entry.estimatedCost;
    if (!Number.isFinite(usd)) return { status: 'unavailable', usd: null };
  }
  return { status: 'available', usd };
}
