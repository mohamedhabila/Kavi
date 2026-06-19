import type {
  AgentGoal,
  AgentRunControlGraphAuditEvent,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import {
  MAX_SAFE_PREVIEW_LENGTH,
  hashString,
  redactStructuralString,
  tailItems,
  uniqueSorted,
  type E2ERedactedEvidencePrefixCount,
  type E2ERedactedHash,
  type E2ERedactedStructuralString,
} from './e2eTraceRedaction';

export type E2ERedactedGoalTrace = {
  id: string;
  status: AgentGoal['status'];
  completionPolicy?: AgentGoal['completionPolicy'];
  successCriteria: E2ERedactedStructuralString[];
  evidenceCount: number;
  evidencePrefixCounts: E2ERedactedEvidencePrefixCount[];
};

export type E2ERedactedGraphSnapshotTrace = {
  status: AgentRunControlGraphState['status'];
  iteration: number;
  finalizationHoldReason?: string;
  terminalReason?: string;
  activeTaskId?: string;
  goalIdsByStatus: Record<AgentGoal['status'], string[]>;
  goalSummaries: E2ERedactedGoalTrace[];
  expectedToolNames: string[];
  observedToolResults: Array<{
    name: string;
    failed: boolean;
    canonicalized: boolean;
    graphApplied: boolean;
    evidenceCount: number;
    evidencePrefixCounts: E2ERedactedEvidencePrefixCount[];
  }>;
  pendingAsyncCount: number;
  lastModelToolNames: string[];
  sessionActivatedToolNames: string[];
  auditEventCount: number;
  selectedToolSurfaceEventCount: number;
  observedToolResultCount: number;
  auditEvents: E2ERedactedGraphAuditEvent[];
  selectedToolSurfaceEvents: E2ERedactedGraphAuditEvent[];
  performance: Pick<
    AgentRunControlGraphState['performance'],
    | 'lastCandidateToolCount'
    | 'lastActiveToolCount'
    | 'maxActiveToolCount'
    | 'lastActiveToolTokenEstimate'
    | 'maxActiveToolTokenEstimate'
  >;
};

export type E2ERedactedGraphAuditEvent = {
  type: string;
  iteration?: number;
  detailHash?: E2ERedactedHash;
  detailPreview?: string;
};

const MAX_AUDIT_EVENTS_PER_SNAPSHOT = 32;
const MAX_SELECTED_TOOL_SURFACE_EVENTS_PER_SNAPSHOT = 8;
const MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT = 64;
const TOOL_SURFACE_AUDIT_TYPE = 'TOOL_SURFACE_SELECTED';
const SAFE_STRUCTURED_AUDIT_DETAIL_TYPES = new Set([
  'COMPLETION_GATE',
  'TOOL_SURFACE_SELECTED',
  'TOOL_SURFACE_TOKEN_AUDIT',
  'MEMORY_RETRIEVAL',
  'LOOP_DETECTED',
  'TOOL_BATCH_INCOMPLETE',
]);

function buildGoalIdsByStatus(
  goals: ReadonlyArray<AgentGoal> | undefined,
): Record<AgentGoal['status'], string[]> {
  const byStatus: Record<AgentGoal['status'], string[]> = {
    pending: [],
    active: [],
    completed: [],
    blocked: [],
  };
  for (const goal of goals ?? []) {
    byStatus[goal.status].push(goal.id);
  }
  return {
    pending: uniqueSorted(byStatus.pending),
    active: uniqueSorted(byStatus.active),
    completed: uniqueSorted(byStatus.completed),
    blocked: uniqueSorted(byStatus.blocked),
  };
}

function evidencePrefix(value: string): string {
  const separatorIndex = value.indexOf(':');
  return separatorIndex > 0 ? value.slice(0, separatorIndex).trim() : 'unscoped';
}

function buildEvidencePrefixCounts(
  evidence: ReadonlyArray<string> | undefined,
): E2ERedactedEvidencePrefixCount[] {
  const counts = new Map<string, number>();
  for (const entry of evidence ?? []) {
    const prefix = evidencePrefix(entry);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((left, right) => left.prefix.localeCompare(right.prefix));
}

function buildGoalSummaries(goals: ReadonlyArray<AgentGoal> | undefined): E2ERedactedGoalTrace[] {
  return (goals ?? []).map((goal) => ({
    id: goal.id,
    status: goal.status,
    ...(goal.completionPolicy ? { completionPolicy: goal.completionPolicy } : {}),
    successCriteria: (goal.successCriteria ?? []).map(redactStructuralString),
    evidenceCount: goal.evidence.length,
    evidencePrefixCounts: buildEvidencePrefixCounts(goal.evidence),
  }));
}

function safeAuditDetail(
  type: string,
  detail: string | undefined,
): {
  detailHash?: E2ERedactedHash;
  detailPreview?: string;
} {
  if (!detail?.trim()) {
    return {};
  }
  const trimmed = detail.trim();
  if (!SAFE_STRUCTURED_AUDIT_DETAIL_TYPES.has(type)) {
    return {
      detailHash: hashString(trimmed),
    };
  }
  return {
    detailHash: hashString(trimmed),
    detailPreview:
      trimmed.length > MAX_SAFE_PREVIEW_LENGTH
        ? `${trimmed.slice(0, MAX_SAFE_PREVIEW_LENGTH)}...`
        : trimmed,
  };
}

function buildAuditEventTrace(event: AgentRunControlGraphAuditEvent): E2ERedactedGraphAuditEvent {
  return {
    type: event.type,
    ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
    ...safeAuditDetail(event.type, event.detail),
  };
}

export function buildGraphSnapshotTrace(
  snapshot: AgentRunControlGraphState,
): E2ERedactedGraphSnapshotTrace {
  const sourceAuditEvents = snapshot.audit ?? [];
  const sourceObservedToolResults = snapshot.observedToolResults ?? [];
  const auditEvents = tailItems(sourceAuditEvents, MAX_AUDIT_EVENTS_PER_SNAPSHOT).map(
    buildAuditEventTrace,
  );
  const selectedToolSurfaceEvents = tailItems(
    sourceAuditEvents.filter((event) => event.type === TOOL_SURFACE_AUDIT_TYPE),
    MAX_SELECTED_TOOL_SURFACE_EVENTS_PER_SNAPSHOT,
  ).map(buildAuditEventTrace);
  const performance = snapshot.performance;
  return {
    status: snapshot.status,
    iteration: snapshot.iteration ?? 0,
    ...(snapshot.finalizationHoldReason
      ? { finalizationHoldReason: snapshot.finalizationHoldReason }
      : {}),
    ...(snapshot.terminalReason ? { terminalReason: snapshot.terminalReason } : {}),
    ...(snapshot.activeTaskId ? { activeTaskId: snapshot.activeTaskId } : {}),
    goalIdsByStatus: buildGoalIdsByStatus(snapshot.goals),
    goalSummaries: buildGoalSummaries(snapshot.goals),
    expectedToolNames: uniqueSorted((snapshot.expectedToolCalls ?? []).map((call) => call.name)),
    observedToolResults: tailItems(
      sourceObservedToolResults,
      MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT,
    ).map((result) => ({
      name: result.name,
      failed: result.failed === true,
      canonicalized: result.canonicalized === true,
      graphApplied: result.graphApplied === true,
      evidenceCount: result.evidence?.length ?? 0,
      evidencePrefixCounts: buildEvidencePrefixCounts(result.evidence),
    })),
    pendingAsyncCount: snapshot.pendingAsyncCount ?? 0,
    lastModelToolNames: uniqueSorted(snapshot.lastModelToolNames ?? []),
    sessionActivatedToolNames: uniqueSorted(snapshot.sessionActivatedToolNames ?? []),
    auditEventCount: sourceAuditEvents.length,
    selectedToolSurfaceEventCount: sourceAuditEvents.filter(
      (event) => event.type === TOOL_SURFACE_AUDIT_TYPE,
    ).length,
    observedToolResultCount: sourceObservedToolResults.length,
    auditEvents,
    selectedToolSurfaceEvents,
    performance: {
      lastCandidateToolCount: performance?.lastCandidateToolCount ?? 0,
      lastActiveToolCount: performance?.lastActiveToolCount ?? 0,
      maxActiveToolCount: performance?.maxActiveToolCount ?? 0,
      lastActiveToolTokenEstimate: performance?.lastActiveToolTokenEstimate ?? 0,
      maxActiveToolTokenEstimate: performance?.maxActiveToolTokenEstimate ?? 0,
    },
  };
}
