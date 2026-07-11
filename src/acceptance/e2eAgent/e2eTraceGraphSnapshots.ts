import type {
  AgentGoal,
  AgentRunControlGraphAuditEvent,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import {
  hashString,
  tailItems,
  uniqueSorted,
  type E2ERedactedHash,
  type E2ERedactedHashCount,
} from './e2eTraceRedaction';
import { buildRedactedToolName, buildRedactedToolNameList } from './e2eTraceToolNames';
import type { RequestUnderstandingSnapshot } from '../../types/requestUnderstanding';
import { normalizeRequestUnderstandingSnapshot } from '../../services/agents/requestUnderstandingProjection';

export type E2ERedactedGoalTrace = {
  goalIdHash: E2ERedactedHash;
  status: AgentGoal['status'];
  completionPolicy?: AgentGoal['completionPolicy'];
  successCriteriaCount: number;
  successCriteriaHashes: E2ERedactedHash[];
  evidenceCount: number;
  evidenceSourceHashCounts: E2ERedactedHashCount[];
};

export type E2ERedactedGraphSnapshotTrace = {
  status: AgentRunControlGraphState['status'];
  iteration: number;
  finalizationHoldReasonHash?: E2ERedactedHash;
  terminalReasonHash?: E2ERedactedHash;
  activeTaskIdHash?: E2ERedactedHash;
  goalIdHashesByStatus: Record<AgentGoal['status'], E2ERedactedHash[]>;
  goalSummaries: E2ERedactedGoalTrace[];
  expectedToolNames: string[];
  expectedToolNameHashes: E2ERedactedHash[];
  observedToolResults: Array<{
    name?: string;
    nameHash: E2ERedactedHash;
    failed: boolean;
    canonicalized: boolean;
    graphApplied: boolean;
    evidenceCount: number;
    evidenceSourceHashCounts: E2ERedactedHashCount[];
  }>;
  pendingAsyncCount: number;
  lastModelToolNames: string[];
  lastModelToolNameHashes: E2ERedactedHash[];
  sessionActivatedToolNames: string[];
  sessionActivatedToolNameHashes: E2ERedactedHash[];
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
  requestUnderstanding?: RequestUnderstandingSnapshot;
};

const PUBLIC_GRAPH_AUDIT_TYPES = [
  'ASYNC_WAITING',
  'BLOCKED',
  'CANCELLED',
  'COMPLETION_GATE',
  'FAILED',
  'FINALIZATION_HELD',
  'FINALIZED',
  'FINAL_CANDIDATE_READY',
  'GOALS_UPDATED',
  'GOAL_EVIDENCE_ADDED',
  'LOOP_DETECTED',
  'MEMORY_RETRIEVAL',
  'MODEL_TURN_COMPLETED',
  'MODEL_TURN_FAILED',
  'MODEL_TURN_STARTED',
  'PERFORMANCE_METRICS_RECORDED',
  'REQUEST_UNDERSTANDING_PROJECTED',
  'SESSION_ACTIVATED_TOOLS_UPDATED',
  'TOOL_BATCH_INCOMPLETE',
  'TOOL_RESULTS_RECORDED',
  'TOOL_RESULT_RECORDED',
  'TOOL_SURFACE_SELECTED',
  'TOOL_SURFACE_TOKEN_AUDIT',
  'TURN_DIRECTIVES_CONSUMED',
  'TURN_DIRECTIVES_RECORDED',
  'YIELDED',
] as const;

export type E2ERedactedGraphAuditType = (typeof PUBLIC_GRAPH_AUDIT_TYPES)[number] | 'OTHER';

export type E2ERedactedGraphAuditEvent = {
  type: E2ERedactedGraphAuditType;
  typeHash?: E2ERedactedHash;
  iteration?: number;
  detailHash?: E2ERedactedHash;
};

const MAX_AUDIT_EVENTS_PER_SNAPSHOT = 32;
const MAX_SELECTED_TOOL_SURFACE_EVENTS_PER_SNAPSHOT = 8;
const MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT = 64;
const TOOL_SURFACE_AUDIT_TYPE = 'TOOL_SURFACE_SELECTED';
const PUBLIC_GRAPH_AUDIT_TYPE_SET = new Set<string>(PUBLIC_GRAPH_AUDIT_TYPES);

function hashUniqueValues(values: Iterable<string>): E2ERedactedHash[] {
  return uniqueSorted(values)
    .map(hashString)
    .sort((left, right) => left.hash.localeCompare(right.hash));
}

function buildGoalIdHashesByStatus(
  goals: ReadonlyArray<AgentGoal> | undefined,
): Record<AgentGoal['status'], E2ERedactedHash[]> {
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
    pending: hashUniqueValues(byStatus.pending),
    active: hashUniqueValues(byStatus.active),
    completed: hashUniqueValues(byStatus.completed),
    blocked: hashUniqueValues(byStatus.blocked),
  };
}

function evidenceSource(value: string): string {
  const separatorIndex = value.indexOf(':');
  return separatorIndex > 0 ? value.slice(0, separatorIndex).trim() : 'unscoped';
}

function buildEvidenceSourceHashCounts(
  evidence: ReadonlyArray<string> | undefined,
): E2ERedactedHashCount[] {
  const counts = new Map<string, number>();
  for (const entry of evidence ?? []) {
    const source = evidenceSource(entry);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ valueHash: hashString(source), count }))
    .sort((left, right) => left.valueHash.hash.localeCompare(right.valueHash.hash));
}

function buildGoalSummaries(goals: ReadonlyArray<AgentGoal> | undefined): E2ERedactedGoalTrace[] {
  return (goals ?? []).map((goal) => {
    const successCriteria = goal.successCriteria ?? [];
    return {
      goalIdHash: hashString(goal.id),
      status: goal.status,
      ...(goal.completionPolicy ? { completionPolicy: goal.completionPolicy } : {}),
      successCriteriaCount: successCriteria.length,
      successCriteriaHashes: successCriteria.map((criterion) => hashString(criterion.trim())),
      evidenceCount: goal.evidence.length,
      evidenceSourceHashCounts: buildEvidenceSourceHashCounts(goal.evidence),
    };
  });
}

function optionalHash(value: string | undefined): E2ERedactedHash | undefined {
  const trimmed = value?.trim();
  return trimmed ? hashString(trimmed) : undefined;
}

function buildAuditEventTrace(event: AgentRunControlGraphAuditEvent): E2ERedactedGraphAuditEvent {
  const type = PUBLIC_GRAPH_AUDIT_TYPE_SET.has(event.type)
    ? (event.type as E2ERedactedGraphAuditType)
    : 'OTHER';
  const typeHash = type === 'OTHER' ? hashString(event.type) : undefined;
  const detailHash = optionalHash(event.detail);
  return {
    type,
    ...(typeHash ? { typeHash } : {}),
    ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
    ...(detailHash ? { detailHash } : {}),
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
  const finalizationHoldReasonHash = optionalHash(snapshot.finalizationHoldReason);
  const terminalReasonHash = optionalHash(snapshot.terminalReason);
  const activeTaskIdHash = optionalHash(snapshot.activeTaskId);
  const expectedToolNames = buildRedactedToolNameList(
    (snapshot.expectedToolCalls ?? []).map((call) => call.name),
  );
  const lastModelToolNames = buildRedactedToolNameList(snapshot.lastModelToolNames ?? []);
  const sessionActivatedToolNames = buildRedactedToolNameList(
    snapshot.sessionActivatedToolNames ?? [],
  );
  const requestUnderstanding = normalizeRequestUnderstandingSnapshot(
    snapshot.requestUnderstanding,
  );
  return {
    status: snapshot.status,
    iteration: snapshot.iteration ?? 0,
    ...(finalizationHoldReasonHash ? { finalizationHoldReasonHash } : {}),
    ...(terminalReasonHash ? { terminalReasonHash } : {}),
    ...(activeTaskIdHash ? { activeTaskIdHash } : {}),
    goalIdHashesByStatus: buildGoalIdHashesByStatus(snapshot.goals),
    goalSummaries: buildGoalSummaries(snapshot.goals),
    expectedToolNames: expectedToolNames.names,
    expectedToolNameHashes: expectedToolNames.nameHashes,
    observedToolResults: tailItems(
      sourceObservedToolResults,
      MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT,
    ).map((result) => ({
      ...buildRedactedToolName(result.name),
      failed: result.failed === true,
      canonicalized: result.canonicalized === true,
      graphApplied: result.graphApplied === true,
      evidenceCount: result.evidence?.length ?? 0,
      evidenceSourceHashCounts: buildEvidenceSourceHashCounts(result.evidence),
    })),
    pendingAsyncCount: snapshot.pendingAsyncCount ?? 0,
    lastModelToolNames: lastModelToolNames.names,
    lastModelToolNameHashes: lastModelToolNames.nameHashes,
    sessionActivatedToolNames: sessionActivatedToolNames.names,
    sessionActivatedToolNameHashes: sessionActivatedToolNames.nameHashes,
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
    ...(requestUnderstanding ? { requestUnderstanding } : {}),
  };
}
