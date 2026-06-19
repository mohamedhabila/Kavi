import type { SubAgentLifecycleEvent, SubAgentSnapshot } from '../../../types/subAgent';

const MAX_SESSION_LABEL_CHARS = 18;
const MAX_OUTPUT_SUMMARY_CHARS = 220;

export function getSubAgentSessionLabel(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return 'unknown';
  }
  return trimmed.length <= MAX_SESSION_LABEL_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_SESSION_LABEL_CHARS - 1)}...`;
}

export function getSubAgentDisplayName(
  snapshot: Pick<SubAgentSnapshot, 'name' | 'sessionId'>,
): string {
  const name = snapshot.name?.trim();
  return name || `Sub-agent ${getSubAgentSessionLabel(snapshot.sessionId)}`;
}

export function getSubAgentElapsedMs(
  snapshot: Pick<SubAgentSnapshot, 'startedAt' | 'updatedAt' | 'status'>,
  now = Date.now(),
): number {
  const endTime =
    snapshot.status === 'running'
      ? Math.max(now, snapshot.updatedAt, snapshot.startedAt)
      : Math.max(snapshot.updatedAt, snapshot.startedAt);
  return Math.max(0, endTime - snapshot.startedAt);
}

export function formatCompactElapsed(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function summarizeSubAgentOutput(
  output?: string,
  maxLength = MAX_OUTPUT_SUMMARY_CHARS,
): string | undefined {
  if (!output) {
    return undefined;
  }

  const normalized = output.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function summarizeSubAgentVisibleActivity(
  snapshot: Pick<SubAgentSnapshot, 'output' | 'currentActivity' | 'lastToolResultPreview'>,
  maxLength = MAX_OUTPUT_SUMMARY_CHARS,
): string | undefined {
  return (
    summarizeSubAgentOutput(snapshot.output, maxLength) ||
    summarizeSubAgentOutput(snapshot.currentActivity, maxLength) ||
    summarizeSubAgentOutput(snapshot.lastToolResultPreview, maxLength)
  );
}

function formatToolSummary(toolsUsed?: string[]): string | undefined {
  const uniqueTools = [...new Set((toolsUsed || []).map((tool) => tool.trim()).filter(Boolean))];
  if (uniqueTools.length === 0) {
    return undefined;
  }
  return uniqueTools.length === 1 ? `Tool: ${uniqueTools[0]}` : `Tools: ${uniqueTools.join(', ')}`;
}

export function buildSubAgentLifecycleMessage(
  snapshot: SubAgentSnapshot,
  event: SubAgentLifecycleEvent,
): string {
  const name = getSubAgentDisplayName(snapshot);
  const elapsed = formatCompactElapsed(getSubAgentElapsedMs(snapshot));
  const firstLine =
    event === 'started'
      ? `${name} started at depth ${snapshot.depth} using ${snapshot.sandboxPolicy} sandbox access.`
      : event === 'completed'
        ? `${name} completed in ${elapsed}.`
        : event === 'timeout'
          ? `${name} timed out after ${elapsed}.`
          : event === 'cancelled'
            ? `${name} was cancelled after ${elapsed}.`
            : `${name} ${snapshot.status === 'timeout' ? 'timed out' : 'ended with an error'} after ${elapsed}.`;

  return [firstLine, formatToolSummary(snapshot.toolsUsed), snapshot.output?.trim()]
    .filter((value): value is string => !!value)
    .join('\n\n');
}
