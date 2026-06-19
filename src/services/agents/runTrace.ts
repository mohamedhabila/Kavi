import type {
  AgentRunControlGraphAuditEvent,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import { GRAPH_OBSERVABILITY_AUDIT_TYPES } from '../../engine/graph/graphObservability';

export interface AgentRunTraceEvent {
  type: string;
  timestamp: number;
  detail?: string;
}

export interface AgentRunTraceIteration {
  iteration: number;
  startedAt: number;
  events: AgentRunTraceEvent[];
}

const TRACE_RELEVANT_TYPES = new Set<string>([
  'MODEL_TURN_STARTED',
  'MODEL_TURN_COMPLETED',
  'TOOL_RESULT_RECORDED',
  'TOOL_RESULTS_RECORDED',
  'ASYNC_WAITING',
  'FINALIZATION_HELD',
  'FINAL_CANDIDATE_READY',
  'GOAL_EVIDENCE_ADDED',
  'GOALS_UPDATED',
  'RUN_RESUMED_FROM_TERMINAL_GRAPH',
  ...Object.values(GRAPH_OBSERVABILITY_AUDIT_TYPES),
]);

function isTraceRelevantAuditEvent(event: AgentRunControlGraphAuditEvent): boolean {
  return TRACE_RELEVANT_TYPES.has(event.type);
}

export function buildAgentRunTrace(
  controlGraph: Pick<AgentRunControlGraphState, 'audit'> | undefined,
): AgentRunTraceIteration[] {
  const audit = (controlGraph?.audit ?? []).filter(isTraceRelevantAuditEvent);
  if (audit.length === 0) {
    return [];
  }

  const grouped = new Map<number, AgentRunTraceIteration>();
  for (const event of audit) {
    const iteration = event.iteration ?? 0;
    const bucket =
      grouped.get(iteration) ??
      ({
        iteration,
        startedAt: event.timestamp,
        events: [],
      } satisfies AgentRunTraceIteration);
    bucket.startedAt = Math.min(bucket.startedAt, event.timestamp);
    bucket.events.push({
      type: event.type,
      timestamp: event.timestamp,
      ...(event.detail ? { detail: event.detail } : {}),
    });
    grouped.set(iteration, bucket);
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      events: [...entry.events].sort((left, right) => left.timestamp - right.timestamp),
    }))
    .sort((left, right) => left.iteration - right.iteration);
}

export function hasAgentRunTrace(
  controlGraph: Pick<AgentRunControlGraphState, 'audit'> | undefined,
): boolean {
  return buildAgentRunTrace(controlGraph).length > 0;
}
