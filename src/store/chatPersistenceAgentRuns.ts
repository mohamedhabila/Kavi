import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunCheckpoint,
  AgentRunControlGraphPerformance,
  AgentRunControlGraphState,
  AgentRunEvidenceEntry,
  AgentRunPlan,
  AgentRunSummary,
} from '../types/agentRun';
import { normalizeAgentRunControlGraphState } from '../services/agents/agentControlGraphState';
import {
  MAX_PERSISTED_AGENT_RUN_CHECKPOINTS,
  MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS,
  MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_REFS,
  MAX_PERSISTED_AGENT_RUN_EVIDENCE,
  MAX_PERSISTED_EVIDENCE_CONTENT_CHARS,
  MAX_PERSISTED_EVIDENCE_PATH_CHARS,
  MAX_PERSISTED_EVIDENCE_URI_CHARS,
  MAX_PERSISTED_LIST_ITEMS,
  MAX_PERSISTED_LOG_DETAIL_CHARS,
  MAX_PERSISTED_LOG_TITLE_CHARS,
  MAX_PERSISTED_PENDING_ASYNC_OPERATIONS,
  MAX_PERSISTED_PLAN_RAW_CHARS,
  MAX_PERSISTED_PLAN_TEXT_CHARS,
  MAX_PERSISTED_WORKSTREAMS,
} from './chatPersistenceLimits';
import {
  keepAnchoredTail,
  sanitizeNonNegativeNumber,
  truncateText,
} from './chatPersistencePrimitives';

function sanitizeAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(value)
    .map<[string, string | number | boolean] | null>(([key, entryValue]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return null;
      }

      if (typeof entryValue === 'string') {
        const normalizedValue = truncateText(entryValue, MAX_PERSISTED_LOG_TITLE_CHARS);
        return normalizedValue ? [normalizedKey, normalizedValue] : null;
      }

      if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        return [normalizedKey, entryValue];
      }

      return null;
    })
    .filter((entry): entry is [string, string | number | boolean] => entry !== null);

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : undefined;
}

function sanitizeAgentRunAsyncOperation(operation: AgentRunAsyncOperation): AgentRunAsyncOperation {
  return {
    key: truncateText(operation.key, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.key,
    kind: operation.kind,
    resourceId:
      truncateText(operation.resourceId, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.resourceId,
    displayName:
      truncateText(operation.displayName, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.displayName,
    status: operation.status,
    lastUpdatedByTool:
      truncateText(operation.lastUpdatedByTool, MAX_PERSISTED_LOG_TITLE_CHARS) ||
      operation.lastUpdatedByTool,
    updatedAt: operation.updatedAt,
    monitorToolNames: operation.monitorToolNames
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((toolName) => truncateText(toolName, MAX_PERSISTED_LOG_TITLE_CHARS) || toolName),
    ...(operation.waitToolName
      ? {
          waitToolName:
            truncateText(operation.waitToolName, MAX_PERSISTED_LOG_TITLE_CHARS) ||
            operation.waitToolName,
        }
      : {}),
    ...(operation.statusArgs
      ? { statusArgs: sanitizeAsyncOperationArgs(operation.statusArgs) }
      : {}),
    ...(operation.waitArgs ? { waitArgs: sanitizeAsyncOperationArgs(operation.waitArgs) } : {}),
  };
}

function sanitizeAgentRunControlGraph(
  controlGraph: AgentRunControlGraphState | undefined,
): AgentRunControlGraphState | undefined {
  const normalized = normalizeAgentRunControlGraphState(controlGraph);
  if (!normalized) {
    return undefined;
  }

  return {
    ...normalized,
    expectedToolCalls: normalized.expectedToolCalls
      .slice(-MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_REFS)
      .map((call) => ({
        id: truncateText(call.id, MAX_PERSISTED_LOG_TITLE_CHARS) || call.id,
        name: truncateText(call.name, MAX_PERSISTED_LOG_TITLE_CHARS) || call.name,
      })),
    observedToolResults: normalized.observedToolResults
      .slice(-MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_REFS)
      .map((result) => ({
        id: truncateText(result.id, MAX_PERSISTED_LOG_TITLE_CHARS) || result.id,
        name: truncateText(result.name, MAX_PERSISTED_LOG_TITLE_CHARS) || result.name,
        ...(result.failed ? { failed: true } : {}),
      })),
    lastModelToolNames: normalized.lastModelToolNames
      .slice(-MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_REFS)
      .map((toolName) => truncateText(toolName, MAX_PERSISTED_LOG_TITLE_CHARS) || toolName),
    ...(normalized.activeTaskId
      ? {
          activeTaskId:
            truncateText(normalized.activeTaskId, MAX_PERSISTED_LOG_TITLE_CHARS) ||
            normalized.activeTaskId,
        }
      : {}),
    asyncWork: {
      awaitingBackgroundWorkers: normalized.asyncWork.awaitingBackgroundWorkers,
      pendingOperations: normalized.asyncWork.pendingOperations
        .slice(0, MAX_PERSISTED_PENDING_ASYNC_OPERATIONS)
        .map((operation) => sanitizeAgentRunAsyncOperation(operation)),
      updatedAt: normalized.asyncWork.updatedAt,
    },
    performance: sanitizeAgentRunControlGraphPerformance(normalized.performance),
    turnDirectives: {
      ...normalized.turnDirectives,
      ...(normalized.turnDirectives.incompleteFinalTextContinuationPrefix
        ? {
            incompleteFinalTextContinuationPrefix: truncateText(
              normalized.turnDirectives.incompleteFinalTextContinuationPrefix,
              MAX_PERSISTED_LOG_DETAIL_CHARS,
            ),
          }
        : {}),
    },
    audit: normalized.audit
      .slice(-MAX_PERSISTED_AGENT_RUN_CONTROL_GRAPH_AUDIT_EVENTS)
      .map((event) => ({
        type: truncateText(event.type, MAX_PERSISTED_LOG_TITLE_CHARS) || event.type,
        timestamp: event.timestamp,
        ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
        ...(event.detail
          ? { detail: truncateText(event.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) }
          : {}),
      })),
  };
}

function sanitizeAgentRunControlGraphPerformance(
  performance: AgentRunControlGraphPerformance,
): AgentRunControlGraphPerformance {
  return {
    modelTurnCount: sanitizeNonNegativeNumber(performance.modelTurnCount),
    modelDurationMs: sanitizeNonNegativeNumber(performance.modelDurationMs),
    ...(performance.timeToFirstTokenMs !== undefined
      ? { timeToFirstTokenMs: sanitizeNonNegativeNumber(performance.timeToFirstTokenMs) }
      : {}),
    toolExecutionCount: sanitizeNonNegativeNumber(performance.toolExecutionCount),
    toolExecutionDurationMs: sanitizeNonNegativeNumber(performance.toolExecutionDurationMs),
    lastCandidateToolCount: sanitizeNonNegativeNumber(performance.lastCandidateToolCount),
    lastActiveToolCount: sanitizeNonNegativeNumber(performance.lastActiveToolCount),
    maxActiveToolCount: sanitizeNonNegativeNumber(performance.maxActiveToolCount),
    lastActiveToolTokenEstimate: sanitizeNonNegativeNumber(performance.lastActiveToolTokenEstimate),
    maxActiveToolTokenEstimate: sanitizeNonNegativeNumber(performance.maxActiveToolTokenEstimate),
    updatedAt: sanitizeNonNegativeNumber(performance.updatedAt),
  };
}

function sanitizeCheckpoint(entry: AgentRunCheckpoint): AgentRunCheckpoint {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    kind: entry.kind,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    ...(entry.detail ? { detail: truncateText(entry.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) } : {}),
  };
}

function sanitizeEvidenceEntry(entry: AgentRunEvidenceEntry): AgentRunEvidenceEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    recorder: entry.recorder,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    content: truncateText(entry.content, MAX_PERSISTED_EVIDENCE_CONTENT_CHARS) || entry.content,
    ...(entry.dedupeKey
      ? { dedupeKey: truncateText(entry.dedupeKey, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.sourceName
      ? { sourceName: truncateText(entry.sourceName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.sourceUri
      ? { sourceUri: truncateText(entry.sourceUri, MAX_PERSISTED_EVIDENCE_URI_CHARS) }
      : {}),
    ...(entry.toolName
      ? { toolName: truncateText(entry.toolName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.workerSessionId
      ? { workerSessionId: truncateText(entry.workerSessionId, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.artifactWorkspacePath
      ? {
          artifactWorkspacePath: truncateText(
            entry.artifactWorkspacePath,
            MAX_PERSISTED_EVIDENCE_PATH_CHARS,
          ),
        }
      : {}),
    ...(entry.tags?.length
      ? {
          tags: entry.tags
            .slice(0, MAX_PERSISTED_LIST_ITEMS)
            .map((tag) => truncateText(tag, MAX_PERSISTED_LOG_TITLE_CHARS) || tag),
        }
      : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sanitizeRunSummary(summary: AgentRunSummary): AgentRunSummary {
  return {
    assistantTurns: summary.assistantTurns,
    startedTools: summary.startedTools,
    completedTools: summary.completedTools,
    failedTools: summary.failedTools,
    spawnedSubAgents: summary.spawnedSubAgents,
    ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
  };
}

function sanitizeAgentRunPlan(plan: AgentRunPlan | undefined): AgentRunPlan | undefined {
  if (!plan) {
    return undefined;
  }

  return {
    objective: truncateText(plan.objective, MAX_PERSISTED_PLAN_TEXT_CHARS) || plan.objective,
    successCriteria: plan.successCriteria
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
    stopConditions: plan.stopConditions
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
    workstreams: plan.workstreams.slice(0, MAX_PERSISTED_WORKSTREAMS).map((workstream) => ({
      id: workstream.id,
      title: truncateText(workstream.title, MAX_PERSISTED_PLAN_TEXT_CHARS) || workstream.title,
      ...(workstream.goal
        ? { goal: truncateText(workstream.goal, MAX_PERSISTED_PLAN_TEXT_CHARS) }
        : {}),
      ...(workstream.expectedOutput
        ? {
            expectedOutput:
              truncateText(workstream.expectedOutput, MAX_PERSISTED_PLAN_TEXT_CHARS) ||
              workstream.expectedOutput,
          }
        : {}),
      ...(workstream.successCriteria
        ? {
            successCriteria: workstream.successCriteria
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
      ...(workstream.dependencies
        ? {
            dependencies: workstream.dependencies
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
      ...(workstream.owner ? { owner: workstream.owner } : {}),
      ...(workstream.requirements
        ? {
            requirements: workstream.requirements
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
      ...(workstream.requiredCapabilities
        ? {
            requiredCapabilities: workstream.requiredCapabilities
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
    })),
    ...(plan.rawPlan ? { rawPlan: truncateText(plan.rawPlan, MAX_PERSISTED_PLAN_RAW_CHARS) } : {}),
    updatedAt: plan.updatedAt,
  };
}

export function sanitizeAgentRun(run: AgentRun): AgentRun {
  const {
    routeState: _legacyRouteState,
    awaitingBackgroundWorkers: _legacyAwaitingBackgroundWorkers,
    pendingAsyncOperations: _legacyPendingAsyncOperations,
    ...runWithoutLegacyState
  } = run as AgentRun & {
    routeState?: unknown;
    awaitingBackgroundWorkers?: unknown;
    pendingAsyncOperations?: unknown;
  };

  return {
    ...runWithoutLegacyState,
    goal: truncateText(run.goal, MAX_PERSISTED_PLAN_TEXT_CHARS) || run.goal,
    phases: run.phases.map((phase) => ({
      ...phase,
      ...(phase.detail
        ? { detail: truncateText(phase.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) }
        : {}),
    })),
    checkpoints: (keepAnchoredTail(run.checkpoints, MAX_PERSISTED_AGENT_RUN_CHECKPOINTS) ?? []).map(
      (entry) => sanitizeCheckpoint(entry),
    ),
    ...(run.evidence?.length
      ? {
          evidence: run.evidence
            .slice(-MAX_PERSISTED_AGENT_RUN_EVIDENCE)
            .map((entry) => sanitizeEvidenceEntry(entry)),
        }
      : {}),
    ...(run.plan ? { plan: sanitizeAgentRunPlan(run.plan) } : {}),
    ...(run.controlGraph ? { controlGraph: sanitizeAgentRunControlGraph(run.controlGraph) } : {}),
    ...(run.latestSummary
      ? { latestSummary: truncateText(run.latestSummary, MAX_PERSISTED_PLAN_RAW_CHARS) }
      : {}),
    summary: sanitizeRunSummary(run.summary),
  };
}
