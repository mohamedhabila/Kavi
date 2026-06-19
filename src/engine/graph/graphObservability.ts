import type { LoopDetectionResult } from '../loopDetection';
import type { CompletionGateDecision } from './completionGate';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';
import type { ToolSurfaceTokenAudit } from './toolSurfaceTokenAudit';

export const GRAPH_OBSERVABILITY_AUDIT_TYPES = {
  COMPLETION_GATE: 'COMPLETION_GATE',
  TOOL_SURFACE_SELECTED: 'TOOL_SURFACE_SELECTED',
  TOOL_SURFACE_TOKEN_AUDIT: 'TOOL_SURFACE_TOKEN_AUDIT',
  MEMORY_RETRIEVAL: 'MEMORY_RETRIEVAL',
  LOOP_DETECTED: 'LOOP_DETECTED',
  TOOL_BATCH_INCOMPLETE: 'TOOL_BATCH_INCOMPLETE',
} as const;

export type GraphObservabilityAuditType =
  (typeof GRAPH_OBSERVABILITY_AUDIT_TYPES)[keyof typeof GRAPH_OBSERVABILITY_AUDIT_TYPES];

const MAX_TOOL_SURFACE_NAMES = 12;

export function buildCompletionGateObservabilityDetail(
  decision: CompletionGateDecision,
): string {
  if (decision.type === 'ready') {
    return 'decision:ready';
  }

  if (decision.type === 'auto_complete_goals') {
    return `decision:auto_complete_goals,reason:${decision.reason}`;
  }

  return `decision:hold,reason:${decision.reason}`;
}

export function buildToolSurfaceObservabilityDetail(params: {
  toolCount: number;
  toolNames: ReadonlyArray<string>;
  tokenEstimate: number;
}): string {
  const uniqueToolNames = Array.from(new Set(params.toolNames.map((name) => name.trim()).filter(Boolean)));
  const listedNames = uniqueToolNames.slice(0, MAX_TOOL_SURFACE_NAMES).join(',');
  const overflow =
    uniqueToolNames.length > MAX_TOOL_SURFACE_NAMES
      ? `,+${uniqueToolNames.length - MAX_TOOL_SURFACE_NAMES}`
      : '';
  return `count:${params.toolCount},tokens:${params.tokenEstimate},tools:${listedNames}${overflow}`;
}

const MAX_EVICTED_TOOL_NAMES = 8;

export function buildToolSurfaceTokenAuditDetail(audit: ToolSurfaceTokenAudit): string {
  const evictedNames = audit.evictedToolNames.slice(0, MAX_EVICTED_TOOL_NAMES).join(',');
  const evictedOverflow =
    audit.evictedToolNames.length > MAX_EVICTED_TOOL_NAMES
      ? `,+${audit.evictedToolNames.length - MAX_EVICTED_TOOL_NAMES}`
      : '';
  const evictedSegment =
    audit.evictedToolNames.length > 0 ? `,evicted:${evictedNames}${evictedOverflow}` : '';
  return `count:${audit.selectedCount},tokens:${audit.estimatedTokens},sessionPinned:${audit.sessionPinnedCount},turnPinned:${audit.turnPinnedCount}${evictedSegment}`;
}

export function buildMemoryRetrievalObservabilityDetail(params: {
  factCount: number;
  episodeCount: number;
  sectionCount: number;
}): string {
  return `facts:${params.factCount},episodes:${params.episodeCount},sections:${params.sectionCount}`;
}

export function buildToolBatchIncompleteObservabilityDetail(params: {
  expectedCount: number;
  settledCount: number;
  unsettledToolCallIds: ReadonlyArray<string>;
}): string {
  const unsettledIds = params.unsettledToolCallIds.join(',');
  return (
    `expected:${params.expectedCount},settled:${params.settledCount}` +
    (unsettledIds ? `,unsettled:${unsettledIds}` : '')
  );
}

export function buildLoopDetectedObservabilityDetail(
  loopCheck: Pick<LoopDetectionResult, 'loopDetected' | 'level' | 'type'>,
): string | undefined {
  if (!loopCheck.loopDetected) {
    return undefined;
  }

  return `level:${loopCheck.level ?? 'unknown'},type:${loopCheck.type ?? 'unknown'}`;
}

export function buildGraphObservabilityRecordedEvent(params: {
  observabilityType: GraphObservabilityAuditType;
  iteration?: number;
  detail?: string;
  timestamp?: number;
}): Extract<AgentControlGraphEvent, { type: 'GRAPH_OBSERVABILITY_RECORDED' }> {
  return {
    type: 'GRAPH_OBSERVABILITY_RECORDED',
    observabilityType: params.observabilityType,
    ...(params.iteration !== undefined ? { iteration: params.iteration } : {}),
    ...(params.detail ? { detail: params.detail } : {}),
    ...(params.timestamp !== undefined ? { timestamp: params.timestamp } : {}),
  };
}