import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  buildSubAgentHierarchy,
  buildSubAgentRollupMap,
  type FlattenedSubAgentNode,
  type SubAgentRollup,
} from './lifecycle/subAgentHierarchyPresentation';

export type DelegatedWorkSection = 'active' | 'attention' | 'recent';
export type DelegatedWorkActivityKind =
  | 'starting'
  | 'researching'
  | 'reviewing'
  | 'creating'
  | 'waiting'
  | 'working'
  | 'completed'
  | 'cancelled'
  | 'needs_attention';

export interface DelegatedWorkGroup {
  id: string;
  rootSnapshot: SubAgentSnapshot;
  nodes: FlattenedSubAgentNode[];
  rollup: SubAgentRollup;
  section: DelegatedWorkSection;
  activityKind: DelegatedWorkActivityKind;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  canCancel: boolean;
  canOpenSourceConversation: boolean;
  canPrepareRetry: boolean;
  latestUpdatedAt: number;
}

export interface DelegatedWorkQueuePresentation {
  groups: DelegatedWorkGroup[];
  sections: ReadonlyArray<{
    key: DelegatedWorkSection;
    groups: DelegatedWorkGroup[];
  }>;
  counts: {
    active: number;
    attention: number;
    recent: number;
    total: number;
    runningWorkers: number;
  };
}

const SECTION_ORDER: Readonly<Record<DelegatedWorkSection, number>> = {
  active: 0,
  attention: 1,
  recent: 2,
};

function resolveRootSessionId(
  snapshot: SubAgentSnapshot,
  byId: ReadonlyMap<string, SubAgentSnapshot>,
): string {
  const visited = new Set<string>();
  let current = snapshot;

  while (true) {
    if (visited.has(current.sessionId)) {
      return [...visited].sort((left, right) => left.localeCompare(right))[0] || snapshot.sessionId;
    }
    visited.add(current.sessionId);

    const parentId = current.parentSessionId?.trim();
    if (!parentId || parentId === current.sessionId) return current.sessionId;
    const parent = byId.get(parentId);
    if (!parent) return current.sessionId;
    current = parent;
  }
}

function resolveSection(rollup: SubAgentRollup): DelegatedWorkSection {
  if (rollup.runningCount > 0) return 'active';
  if (rollup.errorCount > 0 || rollup.timeoutCount > 0) return 'attention';
  return 'recent';
}

function resolveRunningActivity(snapshot: SubAgentSnapshot): DelegatedWorkActivityKind {
  if (snapshot.launchState === 'queued' || snapshot.launchState === 'bootstrapping') {
    return 'starting';
  }

  const toolName = snapshot.activeToolName?.trim().toLowerCase() || '';
  if (!toolName) return 'working';
  if (toolName === 'sessions_wait' || toolName.endsWith('_wait')) return 'waiting';
  if (toolName.startsWith('web_') || toolName.includes('search')) return 'researching';
  if (
    toolName.startsWith('read_') ||
    toolName.includes('fetch') ||
    toolName.includes('snapshot') ||
    toolName.includes('history')
  ) {
    return 'reviewing';
  }
  if (
    toolName.startsWith('write_') ||
    toolName.includes('create') ||
    toolName.includes('edit') ||
    toolName.includes('update')
  ) {
    return 'creating';
  }
  return 'working';
}

function resolveActivityKind(
  nodes: ReadonlyArray<FlattenedSubAgentNode>,
  rollup: SubAgentRollup,
): DelegatedWorkActivityKind {
  if (rollup.runningCount > 0) {
    const activeSnapshot = nodes
      .map((node) => node.snapshot)
      .filter((snapshot) => snapshot.status === 'running')
      .sort((left, right) => {
        const toolDifference =
          Number(Boolean(right.activeToolName)) - Number(Boolean(left.activeToolName));
        return toolDifference || right.updatedAt - left.updatedAt;
      })[0];
    return activeSnapshot ? resolveRunningActivity(activeSnapshot) : 'working';
  }
  if (rollup.errorCount > 0 || rollup.timeoutCount > 0) return 'needs_attention';
  if (rollup.cancelledCount > 0) return 'cancelled';
  return 'completed';
}

function sortGroups(left: DelegatedWorkGroup, right: DelegatedWorkGroup): number {
  const sectionDifference = SECTION_ORDER[left.section] - SECTION_ORDER[right.section];
  if (sectionDifference !== 0) return sectionDifference;
  if (left.latestUpdatedAt !== right.latestUpdatedAt) {
    return right.latestUpdatedAt - left.latestUpdatedAt;
  }
  return left.id.localeCompare(right.id);
}

/** Builds the advanced Queue directly from canonical worker snapshots. */
export function buildDelegatedWorkQueuePresentation(params: {
  snapshots: ReadonlyArray<SubAgentSnapshot>;
  conversations?: ReadonlyArray<Pick<Conversation, 'id' | 'title'>>;
}): DelegatedWorkQueuePresentation {
  const snapshots = [...params.snapshots];
  const hierarchy = buildSubAgentHierarchy(snapshots);
  const rollups = buildSubAgentRollupMap(snapshots);
  const byId = new Map(snapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  const conversationsById = new Map(
    (params.conversations ?? []).map((conversation) => [conversation.id, conversation]),
  );
  const nodesByRoot = new Map<string, FlattenedSubAgentNode[]>();

  for (const node of hierarchy) {
    const rootId = resolveRootSessionId(node.snapshot, byId);
    const nodes = nodesByRoot.get(rootId) ?? [];
    nodes.push(node);
    nodesByRoot.set(rootId, nodes);
  }

  const groups = Array.from(nodesByRoot.entries())
    .map(([rootId, nodes]): DelegatedWorkGroup | null => {
      const rootSnapshot = byId.get(rootId) ?? nodes[0]?.snapshot;
      const rollup = rollups.get(rootId);
      if (!rootSnapshot || !rollup) return null;

      const sourceConversationId = rootSnapshot.parentConversationId.trim();
      const sourceConversation = conversationsById.get(sourceConversationId);
      const sourceConversationTitle = sourceConversation?.title;
      const section = resolveSection(rollup);
      return {
        id: rootId,
        rootSnapshot,
        nodes,
        rollup,
        section,
        activityKind: resolveActivityKind(nodes, rollup),
        sourceConversationId,
        ...(sourceConversation ? { sourceConversationTitle } : {}),
        canCancel: rollup.runningCount > 0,
        canOpenSourceConversation: Boolean(sourceConversation),
        canPrepareRetry: section === 'attention' && Boolean(sourceConversation),
        latestUpdatedAt: rollup.latestUpdatedAt,
      };
    })
    .filter((group): group is DelegatedWorkGroup => group !== null)
    .sort(sortGroups);

  const sectionKeys: DelegatedWorkSection[] = ['active', 'attention', 'recent'];
  const sections = sectionKeys
    .map((key) => ({ key, groups: groups.filter((group) => group.section === key) }))
    .filter((section) => section.groups.length > 0);

  return {
    groups,
    sections,
    counts: {
      active: groups.filter((group) => group.section === 'active').length,
      attention: groups.filter((group) => group.section === 'attention').length,
      recent: groups.filter((group) => group.section === 'recent').length,
      total: groups.length,
      runningWorkers: groups.reduce((sum, group) => sum + group.rollup.runningCount, 0),
    },
  };
}
