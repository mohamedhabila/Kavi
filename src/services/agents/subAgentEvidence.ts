import type { SubAgentActivityEntry, SubAgentSnapshot } from '../../types/subAgent';
import { normalizeFinalizationPreviewText } from './finalizationText';

const DEFAULT_ACTIVITY_LIMIT = 6;

function cloneActivityEntry(entry: SubAgentActivityEntry): SubAgentActivityEntry {
  return {
    timestamp: entry.timestamp,
    kind: entry.kind,
    text: entry.text,
  };
}

export function selectRecentSubAgentEvidenceActivity(
  snapshot: Pick<SubAgentSnapshot, 'activityLog'> | undefined,
  limit = DEFAULT_ACTIVITY_LIMIT,
): SubAgentActivityEntry[] {
  const activityLog = snapshot?.activityLog ?? [];
  if (activityLog.length === 0) {
    return [];
  }

  return activityLog.slice(-Math.max(1, limit)).map(cloneActivityEntry);
}

export function buildSubAgentEvidenceActivityLines(
  snapshot: Pick<SubAgentSnapshot, 'activityLog'> | undefined,
  limit = DEFAULT_ACTIVITY_LIMIT,
): string[] {
  return selectRecentSubAgentEvidenceActivity(snapshot, limit)
    .map((entry) => {
      const text = normalizeFinalizationPreviewText(entry.text, 220);
      return text ? `${entry.kind}: ${text}` : undefined;
    })
    .filter((line): line is string => Boolean(line));
}
