import {
  createInitialAgentRunControlGraphState,
  MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS,
  normalizeAgentRunControlGraphPerformance,
  normalizeAgentRunControlGraphToolCallRefs,
  normalizeAgentRunControlGraphToolResultRefs,
  normalizeAgentRunControlGraphTurnDirectives,
} from '../../services/agents/agentControlGraphState';
import { normalizeAgentRunControlGraphAsyncWorkState } from '../../services/agents/agentRunAsyncState';
import type {
  AgentControlAuditEvent,
  AgentControlGraphEvent,
  AgentControlGraphMachineContext,
  AgentControlGraphSnapshot,
  AgentControlGraphStatus,
  AgentControlPerformance,
  AgentControlToolCallRef,
  AgentControlToolResultRef,
  AgentControlTurnDirectives,
  TerminalAgentControlGraphEvent,
  TerminalAgentControlGraphStatus,
} from './agentControlGraphTypes';

export function normalizeToolCallRefs(
  calls: ReadonlyArray<AgentControlToolCallRef> | undefined,
): AgentControlToolCallRef[] {
  return normalizeAgentRunControlGraphToolCallRefs(calls);
}

export function normalizeToolResultRefs(
  results: ReadonlyArray<AgentControlToolResultRef> | undefined,
): AgentControlToolResultRef[] {
  return normalizeAgentRunControlGraphToolResultRefs(results);
}

export function getTimestamp(event?: { timestamp?: number }): number {
  return event?.timestamp ?? Date.now();
}

export function isTerminalAgentControlGraphStatus(
  status: AgentControlGraphStatus,
): status is TerminalAgentControlGraphStatus {
  return (
    status === 'blocked' ||
    status === 'finalized' ||
    status === 'yielded' ||
    status === 'cancelled' ||
    status === 'failed'
  );
}

export function appendAudit(
  audit: ReadonlyArray<AgentControlAuditEvent>,
  event: AgentControlGraphEvent,
  detail?: string,
): AgentControlAuditEvent[] {
  return [
    ...audit,
    {
      type: event.type,
      timestamp: getTimestamp(event),
      ...('iteration' in event ? { iteration: event.iteration } : {}),
      ...(detail ? { detail } : {}),
    },
  ].slice(-MAX_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS);
}

export function buildTerminalAssignment(
  context: AgentControlGraphMachineContext,
  event: TerminalAgentControlGraphEvent,
): Partial<AgentControlGraphMachineContext> {
  const timestamp = getTimestamp(event);
  return {
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 0,
    asyncWork: normalizeAgentRunControlGraphAsyncWorkState({
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: timestamp,
    }),
    finalizationHoldReason: undefined,
    terminalReason: event.reason,
    updatedAt: timestamp,
    audit: appendAudit(context.audit, event, event.reason),
  };
}

export function mergeToolResults(
  existing: ReadonlyArray<AgentControlToolResultRef>,
  incoming: ReadonlyArray<AgentControlToolResultRef>,
): AgentControlToolResultRef[] {
  const byId = new Map<string, AgentControlToolResultRef>();
  for (const result of existing) {
    byId.set(result.id, result);
  }
  for (const result of normalizeToolResultRefs(incoming)) {
    byId.set(result.id, result);
  }
  return Array.from(byId.values());
}

export function getMissingToolResultIds(
  context: Pick<AgentControlGraphMachineContext, 'expectedToolCalls' | 'observedToolResults'>,
): string[] {
  const observed = new Set(context.observedToolResults.map((result) => result.id));
  return context.expectedToolCalls.map((call) => call.id).filter((id) => !observed.has(id));
}

export function willObserveAllToolResults(
  context: AgentControlGraphMachineContext,
  incoming: ReadonlyArray<AgentControlToolResultRef>,
): boolean {
  const observed = new Set(context.observedToolResults.map((result) => result.id));
  for (const result of incoming) {
    if (result.id.trim()) {
      observed.add(result.id.trim());
    }
  }
  return context.expectedToolCalls.every((call) => observed.has(call.id));
}

export function buildInitialContext(
  snapshot?: Partial<AgentControlGraphSnapshot>,
): AgentControlGraphSnapshot {
  return createInitialAgentRunControlGraphState(snapshot);
}

export function mergeTurnDirectives(
  current: Partial<AgentControlTurnDirectives> | undefined,
  patch: Partial<AgentControlTurnDirectives>,
): AgentControlTurnDirectives {
  return normalizeAgentRunControlGraphTurnDirectives({
    ...current,
    ...patch,
  });
}

export function clearOneShotTurnDirectives(
  current: Partial<AgentControlTurnDirectives> | undefined,
): AgentControlTurnDirectives {
  const next: Record<string, unknown> = {
    ...current,
    forceFinalText: false,
    requireWorkflowTool: false,
  };
  delete next.forcedTextReason;
  delete next.maxTokensOverride;
  return normalizeAgentRunControlGraphTurnDirectives(next as Partial<AgentControlTurnDirectives>);
}

export function mergePerformanceMetrics(
  current: Partial<AgentControlPerformance> | undefined,
  patch: Partial<AgentControlPerformance>,
  timestamp: number,
): AgentControlPerformance {
  const base = normalizeAgentRunControlGraphPerformance(current);
  const incoming = normalizeAgentRunControlGraphPerformance({
    ...patch,
    updatedAt: timestamp,
  });
  const timeToFirstTokenMs =
    patch.timeToFirstTokenMs !== undefined ? incoming.timeToFirstTokenMs : base.timeToFirstTokenMs;

  return normalizeAgentRunControlGraphPerformance({
    modelTurnCount: base.modelTurnCount + incoming.modelTurnCount,
    modelDurationMs: base.modelDurationMs + incoming.modelDurationMs,
    ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
    toolExecutionCount: base.toolExecutionCount + incoming.toolExecutionCount,
    toolExecutionDurationMs: base.toolExecutionDurationMs + incoming.toolExecutionDurationMs,
    lastCandidateToolCount:
      patch.lastCandidateToolCount !== undefined
        ? incoming.lastCandidateToolCount
        : base.lastCandidateToolCount,
    lastActiveToolCount:
      patch.lastActiveToolCount !== undefined
        ? incoming.lastActiveToolCount
        : base.lastActiveToolCount,
    maxActiveToolCount: Math.max(
      base.maxActiveToolCount,
      incoming.maxActiveToolCount,
      incoming.lastActiveToolCount,
    ),
    lastActiveToolTokenEstimate:
      patch.lastActiveToolTokenEstimate !== undefined
        ? incoming.lastActiveToolTokenEstimate
        : base.lastActiveToolTokenEstimate,
    maxActiveToolTokenEstimate: Math.max(
      base.maxActiveToolTokenEstimate,
      incoming.maxActiveToolTokenEstimate,
      incoming.lastActiveToolTokenEstimate,
    ),
    updatedAt: timestamp,
  });
}
