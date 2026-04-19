import type { SubAgentLifecycleEvent, SubAgentSnapshot, SubAgentStatus } from '../../types';

const MAX_SESSION_LABEL_CHARS = 18;
const MAX_OUTPUT_SUMMARY_CHARS = 220;
const MAX_VISUAL_DEPTH = 5;

export interface FlattenedSubAgentNode {
  snapshot: SubAgentSnapshot;
  visualDepth: number;
  hasChildren: boolean;
}

export interface SubAgentRollup {
  rootSessionId: string;
  totalAgents: number;
  descendantCount: number;
  runningCount: number;
  completedCount: number;
  cancelledCount: number;
  timeoutCount: number;
  errorCount: number;
  totalIterations: number;
  totalToolUses: number;
  deepestDepth: number;
  latestUpdatedAt: number;
}

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

function getStatusSortRank(status: SubAgentStatus): number {
  switch (status) {
    case 'running':
      return 0;
    case 'error':
      return 1;
    case 'timeout':
      return 2;
    case 'cancelled':
      return 3;
    case 'completed':
    default:
      return 4;
  }
}

function sortSubAgents(left: SubAgentSnapshot, right: SubAgentSnapshot): number {
  const rankDiff = getStatusSortRank(left.status) - getStatusSortRank(right.status);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  if (left.startedAt !== right.startedAt) {
    return right.startedAt - left.startedAt;
  }

  return left.sessionId.localeCompare(right.sessionId);
}

function buildChildrenByParentId(snapshots: SubAgentSnapshot[]): Map<string, SubAgentSnapshot[]> {
  const childrenByParentId = new Map<string, SubAgentSnapshot[]>();

  for (const snapshot of snapshots) {
    const parentSessionId = snapshot.parentSessionId?.trim();
    if (!parentSessionId || parentSessionId === snapshot.sessionId) {
      continue;
    }

    const siblings = childrenByParentId.get(parentSessionId) || [];
    siblings.push(snapshot);
    siblings.sort(sortSubAgents);
    childrenByParentId.set(parentSessionId, siblings);
  }

  return childrenByParentId;
}

function collectSubtreeSessionIds(
  rootSessionId: string,
  childrenByParentId: Map<string, SubAgentSnapshot[]>,
  visited = new Set<string>(),
): Set<string> {
  if (visited.has(rootSessionId)) {
    return visited;
  }

  visited.add(rootSessionId);
  const children = childrenByParentId.get(rootSessionId) || [];
  for (const child of children) {
    collectSubtreeSessionIds(child.sessionId, childrenByParentId, visited);
  }
  return visited;
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

export function buildSubAgentHierarchy(snapshots: SubAgentSnapshot[]): FlattenedSubAgentNode[] {
  if (snapshots.length === 0) {
    return [];
  }

  const sortedSnapshots = [...snapshots].sort(sortSubAgents);
  const byId = new Map(sortedSnapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  const childrenByParentId = buildChildrenByParentId(sortedSnapshots);

  const roots = sortedSnapshots.filter((snapshot) => {
    const parentSessionId = snapshot.parentSessionId?.trim();
    return !parentSessionId || !byId.has(parentSessionId) || parentSessionId === snapshot.sessionId;
  });

  const flattened: FlattenedSubAgentNode[] = [];
  const visited = new Set<string>();

  const visit = (snapshot: SubAgentSnapshot, treeDepth: number) => {
    if (visited.has(snapshot.sessionId)) {
      return;
    }
    visited.add(snapshot.sessionId);

    const children = (childrenByParentId.get(snapshot.sessionId) || []).filter(
      (child) => !visited.has(child.sessionId),
    );
    const visualDepth = Math.max(
      0,
      Math.min(MAX_VISUAL_DEPTH, Math.max(snapshot.depth, treeDepth)),
    );

    flattened.push({
      snapshot,
      visualDepth,
      hasChildren: children.length > 0,
    });

    for (const child of children) {
      visit(child, treeDepth + 1);
    }
  };

  for (const root of roots) {
    visit(root, Math.max(0, root.depth));
  }

  for (const snapshot of sortedSnapshots) {
    visit(snapshot, Math.max(0, snapshot.depth));
  }

  return flattened;
}

export function buildSubAgentRollupMap(snapshots: SubAgentSnapshot[]): Map<string, SubAgentRollup> {
  const sortedSnapshots = [...snapshots].sort(sortSubAgents);
  const byId = new Map(sortedSnapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  const childrenByParentId = buildChildrenByParentId(sortedSnapshots);
  const rollups = new Map<string, SubAgentRollup>();

  const visit = (sessionId: string): SubAgentRollup | undefined => {
    if (rollups.has(sessionId)) {
      return rollups.get(sessionId);
    }

    const snapshot = byId.get(sessionId);
    if (!snapshot) {
      return undefined;
    }

    let totalAgents = 1;
    let runningCount = snapshot.status === 'running' ? 1 : 0;
    let completedCount = snapshot.status === 'completed' ? 1 : 0;
    let cancelledCount = snapshot.status === 'cancelled' ? 1 : 0;
    let timeoutCount = snapshot.status === 'timeout' ? 1 : 0;
    let errorCount = snapshot.status === 'error' ? 1 : 0;
    let totalIterations = snapshot.iterations || 0;
    let totalToolUses = snapshot.toolsUsed?.length || 0;
    let deepestDepth = snapshot.depth;
    let latestUpdatedAt = snapshot.updatedAt;

    for (const child of childrenByParentId.get(sessionId) || []) {
      const childRollup = visit(child.sessionId);
      if (!childRollup) {
        continue;
      }

      totalAgents += childRollup.totalAgents;
      runningCount += childRollup.runningCount;
      completedCount += childRollup.completedCount;
      cancelledCount += childRollup.cancelledCount;
      timeoutCount += childRollup.timeoutCount;
      errorCount += childRollup.errorCount;
      totalIterations += childRollup.totalIterations;
      totalToolUses += childRollup.totalToolUses;
      deepestDepth = Math.max(deepestDepth, childRollup.deepestDepth);
      latestUpdatedAt = Math.max(latestUpdatedAt, childRollup.latestUpdatedAt);
    }

    const rollup: SubAgentRollup = {
      rootSessionId: sessionId,
      totalAgents,
      descendantCount: Math.max(0, totalAgents - 1),
      runningCount,
      completedCount,
      cancelledCount,
      timeoutCount,
      errorCount,
      totalIterations,
      totalToolUses,
      deepestDepth,
      latestUpdatedAt,
    };

    rollups.set(sessionId, rollup);
    return rollup;
  };

  for (const snapshot of sortedSnapshots) {
    visit(snapshot.sessionId);
  }

  return rollups;
}

export function buildSubAgentSubtree(
  snapshots: SubAgentSnapshot[],
  rootSessionId: string,
  fallbackRoot?: SubAgentSnapshot,
): FlattenedSubAgentNode[] {
  const childrenByParentId = buildChildrenByParentId(snapshots);
  const subtreeIds = collectSubtreeSessionIds(rootSessionId, childrenByParentId);
  const subtreeSnapshots = snapshots.filter((snapshot) => subtreeIds.has(snapshot.sessionId));
  const rootSnapshot =
    subtreeSnapshots.find((snapshot) => snapshot.sessionId === rootSessionId) || fallbackRoot;

  if (!rootSnapshot) {
    return [];
  }

  const normalizedSnapshots = [
    rootSnapshot,
    ...subtreeSnapshots.filter((snapshot) => snapshot.sessionId !== rootSnapshot.sessionId),
  ].map((snapshot) => ({
    ...snapshot,
    depth: Math.max(0, snapshot.depth - rootSnapshot.depth),
    parentSessionId:
      snapshot.sessionId === rootSnapshot.sessionId ? undefined : snapshot.parentSessionId,
  }));

  return buildSubAgentHierarchy(normalizedSnapshots);
}
