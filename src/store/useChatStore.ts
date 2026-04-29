// ---------------------------------------------------------------------------
// Kavi — Chat Store (Zustand)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { requestChatStorePersistenceCheckpoint } from './chatStorePersistence';
import { createThrottledJSONStorage } from './throttledStorage';
import { partializeChatPersistState, sanitizeConversationForPersistence } from './chatPersistence';
import {
  Attachment,
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunCheckpoint,
  AgentRunCheckpointKind,
  AgentRunEvidenceEntry,
  AgentRunPilotEvaluation,
  AssistantMessageMetadata,
  AgentRunPhase,
  AgentRunPlan,
  AgentRunPhaseKey,
  AgentRunPhaseStatus,
  AgentRunSummary,
  AgentRunStatus,
  AgentRunWorkstream,
  Message,
  Conversation,
  ConversationMode,
  MessageProviderReplay,
  SubAgentSnapshot,
  ToolCall,
  ConversationLogEntry,
  ConversationLogKind,
  ConversationLogLevel,
  ConversationUsageEntry,
  ConversationUsageSource,
  TokenUsage,
} from '../types';
import { STORAGE_KEYS } from '../constants/storage';
import { generateId } from '../utils/id';
import { estimateCost, isZeroCostModel } from '../services/usage/tracker';
import {
  generateConversationTitle,
  getDefaultConversationTitle,
  isPlaceholderTitle,
} from '../utils/conversation';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import {
  getLatestFinalAssistantResponsePreview,
  getAgentRunMessageSlice,
  getSubAgentsForAgentRun,
  hasDeliveredFinalAssistantResponse,
  summarizeBackgroundWorkerRunOutcome,
} from '../services/agents/workflowState';
import { normalizeWorkflowWorkstreams } from '../services/agents/workflowScheduling';
import {
  normalizeAgentRunEvidenceEntries,
  type AgentRunEvidenceDraft,
  upsertAgentRunEvidenceEntries,
} from '../services/agents/evidence';
import { extractToolCallAttachments, mergeAttachmentLists } from '../utils/messageAttachments';
import { normalizeLegacyAssistantMessages } from '../utils/assistantMessageMetadata';

const MAX_CONVERSATION_USAGE_ENTRIES = 200;
const MAX_CONVERSATION_LOG_ENTRIES = 250;
const MAX_AGENT_RUNS = 24;
const MAX_AGENT_RUN_CHECKPOINTS = 64;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const DEFAULT_AGENT_RUN_SUCCESS_CRITERIA = [
  'Produce the requested deliverable.',
  'Verify the result before finalizing.',
];
const DEFAULT_AGENT_RUN_STOP_CONDITIONS = [
  'Stop when the deliverable is complete and the success criteria are satisfied.',
  'Stop early if a concrete blocker, missing permission, or dependency prevents further progress.',
];
const APP_RESTART_INTERRUPTION_MARKER = 'app restarted before completion';
const INTERRUPTED_TOOL_CALL_ERROR =
  'Tool call was interrupted because the app restarted before completion.';
const TERMINAL_AGENT_RUN_ASYNC_OPERATION_STATUSES = new Set<AgentRunAsyncOperation['status']>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

const DEFAULT_AGENT_RUN_SUMMARY: AgentRunSummary = {
  assistantTurns: 0,
  startedTools: 0,
  completedTools: 0,
  failedTools: 0,
  spawnedSubAgents: 0,
};

const AGENT_RUN_PHASE_DEFINITIONS: Array<{ key: AgentRunPhaseKey; title: string }> = [
  { key: 'assess', title: 'Assess' },
  { key: 'plan', title: 'Plan' },
  { key: 'work', title: 'Work' },
  { key: 'review', title: 'Review' },
  { key: 'pilot', title: 'Pilot' },
  { key: 'deliver', title: 'Deliver' },
];

function createInitialAgentRunPhases(timestamp: number): AgentRunPhase[] {
  return AGENT_RUN_PHASE_DEFINITIONS.map((phase, index) => ({
    ...phase,
    status: index === 0 ? 'active' : 'pending',
    updatedAt: timestamp,
  }));
}

function mergeAgentRunSummary(
  existing: AgentRunSummary | undefined,
  patch?: Partial<AgentRunSummary>,
): AgentRunSummary {
  const base = { ...DEFAULT_AGENT_RUN_SUMMARY, ...(existing ?? {}) };

  if (!patch) {
    return base;
  }

  return {
    assistantTurns: patch.assistantTurns ?? base.assistantTurns,
    startedTools: patch.startedTools ?? base.startedTools,
    completedTools: patch.completedTools ?? base.completedTools,
    failedTools: patch.failedTools ?? base.failedTools,
    spawnedSubAgents: patch.spawnedSubAgents ?? base.spawnedSubAgents,
    durationMs: patch.durationMs ?? base.durationMs,
  };
}

function areAgentRunSummariesEqual(
  left: AgentRunSummary | undefined,
  right: AgentRunSummary | undefined,
): boolean {
  const normalizedLeft = mergeAgentRunSummary(left);
  const normalizedRight = mergeAgentRunSummary(right);

  return (
    normalizedLeft.assistantTurns === normalizedRight.assistantTurns &&
    normalizedLeft.startedTools === normalizedRight.startedTools &&
    normalizedLeft.completedTools === normalizedRight.completedTools &&
    normalizedLeft.failedTools === normalizedRight.failedTools &&
    normalizedLeft.spawnedSubAgents === normalizedRight.spawnedSubAgents &&
    normalizedLeft.durationMs === normalizedRight.durationMs
  );
}

function normalizeTextList(items: string[] | undefined, fallback: string[]): string[] {
  const normalized = (items ?? []).map((item) => item.trim()).filter(Boolean);

  return normalized.length ? normalized : [...fallback];
}

function normalizeAgentRunWorkstreams(workstreams?: AgentRunWorkstream[]): AgentRunWorkstream[] {
  return normalizeWorkflowWorkstreams(workstreams);
}

function normalizeAgentRunEvidence(
  evidence: ReadonlyArray<AgentRunEvidenceEntry | AgentRunEvidenceDraft> | undefined,
): AgentRunEvidenceEntry[] | undefined {
  const normalized = normalizeAgentRunEvidenceEntries(evidence);
  return normalized.length > 0 ? normalized : undefined;
}

function areAgentRunEvidenceEntriesEqual(
  left: AgentRunEvidenceEntry[] | undefined,
  right: AgentRunEvidenceEntry[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left?.length && !right?.length) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((leftEntry, index) => {
    const rightEntry = right[index];
    return (
      leftEntry.id === rightEntry.id &&
      leftEntry.kind === rightEntry.kind &&
      leftEntry.status === rightEntry.status &&
      leftEntry.recorder === rightEntry.recorder &&
      leftEntry.title === rightEntry.title &&
      leftEntry.content === rightEntry.content &&
      leftEntry.dedupeKey === rightEntry.dedupeKey &&
      leftEntry.sourceName === rightEntry.sourceName &&
      leftEntry.sourceUri === rightEntry.sourceUri &&
      leftEntry.toolName === rightEntry.toolName &&
      leftEntry.workerSessionId === rightEntry.workerSessionId &&
      leftEntry.artifactWorkspacePath === rightEntry.artifactWorkspacePath &&
      leftEntry.createdAt === rightEntry.createdAt &&
      leftEntry.updatedAt === rightEntry.updatedAt &&
      JSON.stringify(leftEntry.tags ?? []) === JSON.stringify(rightEntry.tags ?? [])
    );
  });
}

function clampPilotScore(score: number | undefined, maxScore: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(maxScore, Math.max(0, Math.round(score as number)));
}

function normalizePilotTextList(items: string[] | undefined, maxItems = 6): string[] {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeAgentRunAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map<[string, string | number | boolean] | null>(([key, entryValue]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return null;
      }

      if (typeof entryValue === 'string') {
        const normalizedValue = entryValue.trim();
        return normalizedValue ? [normalizedKey, normalizedValue] : null;
      }

      if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        return [normalizedKey, entryValue];
      }

      return null;
    })
    .filter((entry): entry is [string, string | number | boolean] => entry !== null);

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

function normalizeAgentRunAsyncOperations(
  operations: AgentRunAsyncOperation[] | undefined,
): AgentRunAsyncOperation[] | undefined {
  const normalizedOperations = (operations ?? [])
    .map<AgentRunAsyncOperation | null>((operation, index) => {
      const normalizedResourceId = operation.resourceId?.trim();
      if (
        !normalizedResourceId ||
        TERMINAL_AGENT_RUN_ASYNC_OPERATION_STATUSES.has(operation.status)
      ) {
        return null;
      }

      const normalizedMonitorToolNames = Array.from(
        new Set(
          (operation.monitorToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
        ),
      );
      if (normalizedMonitorToolNames.length === 0) {
        return null;
      }

      return {
        key: operation.key?.trim() || `${operation.kind}:${normalizedResourceId}:${index}`,
        kind: operation.kind,
        resourceId: normalizedResourceId,
        displayName: operation.displayName?.trim() || normalizedResourceId,
        status: operation.status,
        lastUpdatedByTool: operation.lastUpdatedByTool?.trim() || 'recovered_async_state',
        updatedAt: Number.isFinite(operation.updatedAt) ? operation.updatedAt : Date.now(),
        monitorToolNames: normalizedMonitorToolNames,
        ...(operation.waitToolName?.trim() ? { waitToolName: operation.waitToolName.trim() } : {}),
        ...(operation.statusArgs
          ? { statusArgs: normalizeAgentRunAsyncOperationArgs(operation.statusArgs) }
          : {}),
        ...(operation.waitArgs
          ? { waitArgs: normalizeAgentRunAsyncOperationArgs(operation.waitArgs) }
          : {}),
      };
    })
    .filter((operation): operation is AgentRunAsyncOperation => operation !== null)
    .slice(0, 8);

  return normalizedOperations.length > 0 ? normalizedOperations : undefined;
}

function areAgentRunAsyncOperationsEqual(
  left: AgentRunAsyncOperation[] | undefined,
  right: AgentRunAsyncOperation[] | undefined,
): boolean {
  const normalizedLeft = normalizeAgentRunAsyncOperations(left) ?? [];
  const normalizedRight = normalizeAgentRunAsyncOperations(right) ?? [];

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((leftOperation, index) => {
    const rightOperation = normalizedRight[index];
    return (
      leftOperation.key === rightOperation.key &&
      leftOperation.kind === rightOperation.kind &&
      leftOperation.resourceId === rightOperation.resourceId &&
      leftOperation.displayName === rightOperation.displayName &&
      leftOperation.status === rightOperation.status &&
      leftOperation.lastUpdatedByTool === rightOperation.lastUpdatedByTool &&
      leftOperation.updatedAt === rightOperation.updatedAt &&
      leftOperation.waitToolName === rightOperation.waitToolName &&
      JSON.stringify(leftOperation.monitorToolNames) ===
        JSON.stringify(rightOperation.monitorToolNames) &&
      JSON.stringify(leftOperation.statusArgs ?? {}) ===
        JSON.stringify(rightOperation.statusArgs ?? {}) &&
      JSON.stringify(leftOperation.waitArgs ?? {}) === JSON.stringify(rightOperation.waitArgs ?? {})
    );
  });
}

function normalizeAgentRunPilotEvaluation(
  evaluation: AgentRunPilotEvaluation | undefined,
  fallbackObjective: string,
  fallbackSuccessCriteria: string[],
): AgentRunPilotEvaluation | undefined {
  if (!evaluation) {
    return undefined;
  }

  const normalizedCriteria = (evaluation.criterionEvaluations ?? [])
    .map((criterionEvaluation, index) => {
      const criterion =
        criterionEvaluation.criterion?.trim() ||
        fallbackSuccessCriteria[index] ||
        `Success criterion ${index + 1}`;
      const maxScore = clampPilotScore(criterionEvaluation.maxScore, 10) || 5;
      const score = clampPilotScore(criterionEvaluation.score, maxScore);
      const status: AgentRunPilotEvaluation['criterionEvaluations'][number]['status'] =
        criterionEvaluation.status === 'met' ||
        criterionEvaluation.status === 'partial' ||
        criterionEvaluation.status === 'blocked'
          ? criterionEvaluation.status
          : 'unmet';

      return {
        criterion,
        score,
        maxScore,
        status,
        rationale: criterionEvaluation.rationale?.trim() || 'No pilot rationale recorded.',
      };
    })
    .slice(0, Math.max(1, fallbackSuccessCriteria.length || 1));

  const completionScore = clampPilotScore(evaluation.completionScore, 5);
  const adherenceScore = clampPilotScore(evaluation.adherenceScore, 5);
  const evidenceScore = clampPilotScore(evaluation.evidenceScore, 5);
  const processScore = clampPilotScore(evaluation.processScore, 5);
  const maxOverallScore = clampPilotScore(evaluation.maxOverallScore, 40) || 20;
  const approvalThreshold = Math.min(
    maxOverallScore,
    Math.max(1, clampPilotScore(evaluation.approvalThreshold, maxOverallScore) || 16),
  );
  const overallScore = Math.min(
    maxOverallScore,
    completionScore + adherenceScore + evidenceScore + processScore,
  );
  const recommendedAction =
    evaluation.recommendedAction === 'continue' || evaluation.recommendedAction === 'blocked'
      ? evaluation.recommendedAction
      : 'finalize';
  const controlAction =
    evaluation.controlAction === 'accept' ||
    evaluation.controlAction === 'continue' ||
    evaluation.controlAction === 'block' ||
    evaluation.controlAction === 'cancel'
      ? evaluation.controlAction
      : recommendedAction === 'continue'
        ? 'continue'
        : recommendedAction === 'blocked'
          ? 'block'
          : 'accept';

  return {
    evaluatorVersion: evaluation.evaluatorVersion?.trim() || 'pilot-v2',
    evaluatedAt: Number.isFinite(evaluation.evaluatedAt) ? evaluation.evaluatedAt : Date.now(),
    objective: evaluation.objective?.trim() || fallbackObjective,
    completionScore,
    adherenceScore,
    evidenceScore,
    processScore,
    overallScore,
    maxOverallScore,
    approvalThreshold,
    approved:
      !!evaluation.approved &&
      recommendedAction === 'finalize' &&
      controlAction === 'accept' &&
      overallScore >= approvalThreshold &&
      normalizedCriteria.every((criterion) => criterion.score >= Math.min(criterion.maxScore, 4)),
    recommendedAction,
    controlAction,
    confidence:
      evaluation.confidence === 'low' || evaluation.confidence === 'high'
        ? evaluation.confidence
        : 'medium',
    summary: evaluation.summary?.trim() || fallbackObjective,
    rationale: evaluation.rationale?.trim() || 'No pilot rationale recorded.',
    source:
      evaluation.source === 'heuristic' || evaluation.source === 'unavailable'
        ? evaluation.source
        : 'provider',
    fallbackReason:
      evaluation.fallbackReason === 'no_provider_context' ||
      evaluation.fallbackReason === 'request_failed' ||
      evaluation.fallbackReason === 'response_unparseable'
        ? evaluation.fallbackReason
        : undefined,
    fallbackDetail: evaluation.fallbackDetail?.trim() || undefined,
    stateSignature: evaluation.stateSignature?.trim() || undefined,
    progressSignature: evaluation.progressSignature?.trim() || undefined,
    strengths: normalizePilotTextList(evaluation.strengths),
    gaps: normalizePilotTextList(evaluation.gaps),
    nextActions: normalizePilotTextList(evaluation.nextActions),
    criterionEvaluations: normalizedCriteria,
  };
}

function createDefaultAgentRunPlan(
  goal: string,
  timestamp: number,
  rawPlan?: string,
): AgentRunPlan {
  return {
    objective: goal.trim() || 'Complete the current task.',
    successCriteria: [...DEFAULT_AGENT_RUN_SUCCESS_CRITERIA],
    stopConditions: [...DEFAULT_AGENT_RUN_STOP_CONDITIONS],
    workstreams: [],
    rawPlan: rawPlan?.trim() || undefined,
    updatedAt: timestamp,
  };
}

function mergeAgentRunPlan(
  existing: AgentRunPlan | undefined,
  patch: Partial<AgentRunPlan> | undefined,
  fallbackGoal: string,
  timestamp: number,
): AgentRunPlan {
  const base = existing ?? createDefaultAgentRunPlan(fallbackGoal, timestamp);

  return {
    objective: patch?.objective?.trim() || base.objective || fallbackGoal,
    successCriteria: normalizeTextList(patch?.successCriteria, base.successCriteria),
    stopConditions: normalizeTextList(patch?.stopConditions, base.stopConditions),
    workstreams: normalizeAgentRunWorkstreams(patch?.workstreams ?? base.workstreams),
    rawPlan: patch?.rawPlan?.trim() || base.rawPlan,
    updatedAt: patch?.updatedAt ?? timestamp,
  };
}

function normalizePersistedAgentRun(run: AgentRun): AgentRun {
  const timestamp = run.updatedAt ?? run.createdAt ?? Date.now();
  const goal = run.goal?.trim() || 'Complete the current task.';
  const plan = mergeAgentRunPlan(run.plan, undefined, goal, timestamp);
  const checkpoints =
    run.checkpoints?.length > MAX_AGENT_RUN_CHECKPOINTS
      ? [run.checkpoints[0], ...run.checkpoints.slice(-(MAX_AGENT_RUN_CHECKPOINTS - 1))]
      : run.checkpoints?.length
        ? run.checkpoints
        : [];

  return {
    ...run,
    goal,
    awaitingBackgroundWorkers: run.status === 'running' ? !!run.awaitingBackgroundWorkers : false,
    phases: run.phases?.length ? run.phases : createInitialAgentRunPhases(timestamp),
    checkpoints,
    summary: mergeAgentRunSummary(run.summary),
    plan,
    evidence: normalizeAgentRunEvidence(run.evidence),
    latestPilotEvaluation: normalizeAgentRunPilotEvaluation(
      run.latestPilotEvaluation,
      plan.objective,
      plan.successCriteria,
    ),
    pendingAsyncOperations:
      run.status === 'running'
        ? normalizeAgentRunAsyncOperations(run.pendingAsyncOperations)
        : undefined,
  };
}

function normalizePersistedMessages(messages: Message[] | undefined): Message[] {
  return normalizeLegacyAssistantMessages(messages ?? []);
}

function normalizePersistedConversation(conversation: Conversation): Conversation {
  const normalizedRuns = (conversation.agentRuns ?? []).map((run) =>
    normalizePersistedAgentRun(run as AgentRun),
  );
  const activeAgentRunId = normalizedRuns.some(
    (run) => run.id === conversation.activeAgentRunId && run.status === 'running',
  )
    ? conversation.activeAgentRunId
    : undefined;

  const rawMode = (conversation as { mode?: string }).mode;
  const normalizedMode = rawMode === 'direct' ? 'chitchat' : conversation.mode;

  return sanitizeConversationForPersistence({
    ...conversation,
    messages: capMessages(normalizePersistedMessages(conversation.messages)),
    logs: conversation.logs ?? [],
    agentRuns: normalizedRuns,
    activeAgentRunId,
    ...(normalizedMode !== undefined ? { mode: normalizedMode as ConversationMode } : {}),
  });
}

function normalizePersistedChatState(
  state: Partial<ChatState> | undefined,
): Pick<ChatState, 'conversations' | 'activeConversationId'> {
  const conversations = (state?.conversations ?? []).map((conversation) =>
    normalizePersistedConversation(conversation as Conversation),
  );
  const activeConversationId =
    typeof state?.activeConversationId === 'string' &&
    conversations.some((conversation) => conversation.id === state.activeConversationId)
      ? state.activeConversationId
      : null;

  return {
    conversations,
    activeConversationId,
  };
}

export function collapseConversationsToCanonical(
  conversations: Conversation[],
): Conversation[] {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return conversations ?? [];
  }
  const groups = new Map<string, Conversation[]>();
  for (const conv of conversations) {
    if (conv.isSideThread || conv.archivedFromMigration) {
      continue;
    }
    const key = conv.personaId && conv.personaId.length > 0 ? conv.personaId : '__default__';
    const list = groups.get(key);
    if (list) list.push(conv);
    else groups.set(key, [conv]);
  }
  const canonicalIds = new Set<string>();
  const archivedIds = new Set<string>();
  for (const list of groups.values()) {
    if (list.length === 0) continue;
    const existingCanonical = list.find((c) => c.isCanonical);
    const winner =
      existingCanonical ??
      list.reduce((best, c) => (c.updatedAt > best.updatedAt ? c : best), list[0]);
    canonicalIds.add(winner.id);
    for (const c of list) {
      if (c.id !== winner.id) {
        archivedIds.add(c.id);
      }
    }
  }
  return conversations.map((conv) => {
    if (conv.isSideThread) return conv;
    if (canonicalIds.has(conv.id) && !conv.isCanonical) {
      return { ...conv, isCanonical: true };
    }
    if (archivedIds.has(conv.id) && !conv.archivedFromMigration) {
      return { ...conv, archivedFromMigration: true, isCanonical: false };
    }
    return conv;
  });
}

function isAppRestartInterruptedWorker(
  worker: Pick<SubAgentSnapshot, 'status' | 'output' | 'currentActivity'>,
): boolean {
  if (worker.status !== 'error' && worker.status !== 'timeout' && worker.status !== 'cancelled') {
    return false;
  }

  const detail = `${worker.output ?? ''}\n${worker.currentActivity ?? ''}`.toLowerCase();
  return detail.includes(APP_RESTART_INTERRUPTION_MARKER);
}

function markInterruptedToolCallsInRun(
  messages: Message[],
  userMessageId: string,
  timestamp: number,
): { messages: Message[]; interruptedCount: number } {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);
  if (!runMessages.length) {
    return { messages, interruptedCount: 0 };
  }

  const firstRunMessage = runMessages[0];
  const startIndex = messages.findIndex((message) => message.id === firstRunMessage.id);
  if (startIndex < 0) {
    return { messages, interruptedCount: 0 };
  }

  const endIndex = startIndex + runMessages.length;
  let interruptedCount = 0;

  const nextMessages = messages.map((message, index) => {
    if (
      index < startIndex ||
      index >= endIndex ||
      message.role !== 'assistant' ||
      !message.toolCalls?.length
    ) {
      return message;
    }

    let didChange = false;
    const nextToolCalls = message.toolCalls.map((toolCall) => {
      if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
        return toolCall;
      }

      interruptedCount += 1;
      didChange = true;
      return {
        ...toolCall,
        status: 'failed' as const,
        updatedAt: timestamp,
        startedAt: toolCall.startedAt ?? timestamp,
        completedAt: toolCall.completedAt ?? timestamp,
        result: undefined,
        error: toolCall.error ?? INTERRUPTED_TOOL_CALL_ERROR,
      };
    });

    return didChange
      ? {
          ...message,
          toolCalls: nextToolCalls,
        }
      : message;
  });

  return interruptedCount > 0
    ? { messages: nextMessages, interruptedCount }
    : { messages, interruptedCount: 0 };
}

/**
 * Cap a conversation's message array to MAX_MESSAGES_PER_CONVERSATION.
 * Keeps the first message (system/user greeting) and the most recent tail.
 */
function capMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_PER_CONVERSATION) {
    return messages;
  }

  return [messages[0], ...messages.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1))];
}

function buildRecoveredAgentRunState(
  conversation: Conversation,
  run: AgentRun,
  subAgents: SubAgentSnapshot[],
):
  | {
      status: AgentRunStatus;
      latestSummary: string;
      checkpointTitle: string;
      checkpointDetail: string;
      awaitingBackgroundWorkers?: boolean;
      phase?: AgentRunPhaseKey;
    }
  | undefined {
  if (subAgents.some((agent) => agent.status === 'running')) {
    return undefined;
  }

  if (run.awaitingBackgroundWorkers) {
    if (subAgents.length === 0) {
      const latestSummary =
        'Background work was interrupted because the app restarted before the workers finished.';
      return {
        status: 'failed',
        latestSummary,
        checkpointTitle: 'Run interrupted on app restart',
        checkpointDetail: latestSummary,
      };
    }

    if (subAgents.every((agent) => isAppRestartInterruptedWorker(agent))) {
      const latestSummary =
        'Background workers were interrupted because the app restarted before completion.';
      return {
        status: 'failed',
        latestSummary,
        checkpointTitle: 'Background workers interrupted on app restart',
        checkpointDetail: latestSummary,
      };
    }

    const backgroundOutcome = summarizeBackgroundWorkerRunOutcome(subAgents);
    if (backgroundOutcome.status === 'completed') {
      const preservedFinalResponse = hasDeliveredFinalAssistantResponse(
        conversation.messages,
        run.userMessageId,
      )
        ? getLatestFinalAssistantResponsePreview(conversation.messages, run.userMessageId)
        : undefined;

      if (preservedFinalResponse) {
        return {
          status: 'completed',
          latestSummary: preservedFinalResponse,
          checkpointTitle: 'Recovered background completion',
          checkpointDetail:
            'Background workers finished before the app restarted and the final response was preserved.',
        };
      }

      const latestSummary =
        'Background workers finished before the app restarted. Recovering the final response from verified results.';
      return {
        status: 'completed',
        latestSummary,
        checkpointTitle: 'Recovered background completion',
        checkpointDetail: latestSummary,
      };
    }

    const latestSummary =
      backgroundOutcome.status === 'cancelled'
        ? 'Background workers were cancelled before the app restarted. Reopen the conversation to let the pilot review the outcome and decide whether more work is needed.'
        : 'Background workers failed before the app restarted. Reopen the conversation to let the pilot review the failures and continue with a different approach if possible.';

    return {
      status: 'running',
      latestSummary,
      checkpointTitle:
        backgroundOutcome.status === 'cancelled'
          ? 'Recovered background cancellation for pilot review'
          : 'Recovered background failure for pilot review',
      checkpointDetail: latestSummary,
      awaitingBackgroundWorkers: true,
      phase: 'pilot',
    };
  }

  if ((run.pendingAsyncOperations?.length ?? 0) > 0) {
    const pendingOperationCount = run.pendingAsyncOperations?.length ?? 0;
    const latestSummary =
      pendingOperationCount === 1
        ? 'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.'
        : `Recovered ${pendingOperationCount} pending asynchronous operations after app restart. Resuming monitoring.`;
    return {
      status: 'running',
      latestSummary,
      checkpointTitle: 'Recovered async workflow monitoring',
      checkpointDetail: latestSummary,
      phase: 'review',
    };
  }

  const latestSummary = 'The run was interrupted because the app restarted before completion.';
  return {
    status: 'failed',
    latestSummary,
    checkpointTitle: 'Run interrupted on app restart',
    checkpointDetail: latestSummary,
  };
}

function appendAgentCheckpoint(run: AgentRun, entry: Omit<AgentRunCheckpoint, 'id'>): AgentRun {
  const checkpoint: AgentRunCheckpoint = {
    id: generateId(),
    ...entry,
  };
  const nextCheckpoints = [...run.checkpoints, checkpoint];
  const trimmedCheckpoints =
    nextCheckpoints.length > MAX_AGENT_RUN_CHECKPOINTS
      ? [nextCheckpoints[0], ...nextCheckpoints.slice(-(MAX_AGENT_RUN_CHECKPOINTS - 1))]
      : nextCheckpoints;

  return {
    ...run,
    updatedAt: Math.max(run.updatedAt, checkpoint.timestamp),
    checkpoints: trimmedCheckpoints,
  };
}

function transitionAgentRunPhases(
  phases: AgentRunPhase[],
  targetPhase: AgentRunPhaseKey,
  status: Exclude<AgentRunPhaseStatus, 'pending'>,
  timestamp: number,
  detail?: string,
  options?: { allowRegression?: boolean },
): AgentRunPhase[] {
  const targetIndex = AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === targetPhase);
  if (targetIndex < 0) {
    return phases;
  }

  return phases.map((phase, index) => {
    if (index < targetIndex && (phase.status === 'pending' || phase.status === 'active')) {
      return {
        ...phase,
        status: 'completed',
        updatedAt: timestamp,
      };
    }

    if (phase.key === targetPhase) {
      return {
        ...phase,
        status,
        detail: detail ?? phase.detail,
        updatedAt: timestamp,
      };
    }

    if (options?.allowRegression && index > targetIndex && phase.status === 'active') {
      return {
        ...phase,
        status: 'completed',
        updatedAt: timestamp,
      };
    }

    return phase;
  });
}

function getAgentRunPhaseIndex(phaseKey: AgentRunPhaseKey): number {
  return AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === phaseKey);
}

function areAgentRunPhasesEqual(left: AgentRunPhase[], right: AgentRunPhase[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftPhase = left[index];
    const rightPhase = right[index];

    if (
      leftPhase.key !== rightPhase.key ||
      leftPhase.title !== rightPhase.title ||
      leftPhase.status !== rightPhase.status ||
      leftPhase.detail !== rightPhase.detail
    ) {
      return false;
    }
  }

  return true;
}

function areAssistantMessageMetadataEqual(
  left: AssistantMessageMetadata | undefined,
  right: AssistantMessageMetadata | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.kind === right.kind &&
    left.completionStatus === right.completionStatus &&
    left.finishReason === right.finishReason
  );
}

function areToolCallsEqual(left: ToolCall | undefined, right: ToolCall | undefined): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.id === right.id &&
    left.name === right.name &&
    left.arguments === right.arguments &&
    left.raw === right.raw &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.completedAt === right.completedAt &&
    left.progressText === right.progressText &&
    left.result === right.result &&
    left.error === right.error
  );
}

function areAttachmentsEqual(
  left: Attachment[] | undefined,
  right: Attachment[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left?.length && !right?.length) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftAttachment = left[index];
    const rightAttachment = right[index];
    if (
      leftAttachment.id !== rightAttachment.id ||
      leftAttachment.type !== rightAttachment.type ||
      leftAttachment.uri !== rightAttachment.uri ||
      leftAttachment.name !== rightAttachment.name ||
      leftAttachment.mimeType !== rightAttachment.mimeType ||
      leftAttachment.size !== rightAttachment.size ||
      leftAttachment.base64 !== rightAttachment.base64 ||
      leftAttachment.workspacePath !== rightAttachment.workspacePath ||
      leftAttachment.durationMs !== rightAttachment.durationMs ||
      leftAttachment.transcript !== rightAttachment.transcript ||
      JSON.stringify(leftAttachment.waveformLevels ?? []) !==
        JSON.stringify(rightAttachment.waveformLevels ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function updateConversationById(
  conversations: Conversation[],
  conversationId: string,
  updater: (conversation: Conversation) => Conversation,
): Conversation[] | undefined {
  const conversationIndex = conversations.findIndex(
    (conversation) => conversation.id === conversationId,
  );
  if (conversationIndex < 0) {
    return undefined;
  }

  const conversation = conversations[conversationIndex];
  const nextConversation = updater(conversation);
  if (nextConversation === conversation) {
    return undefined;
  }

  const nextConversations = [...conversations];
  nextConversations[conversationIndex] = nextConversation;
  return nextConversations;
}

function updateConversationMessageById(
  conversations: Conversation[],
  conversationId: string,
  messageId: string,
  updater: (message: Message) => Message,
): Conversation[] | undefined {
  return updateConversationById(conversations, conversationId, (conversation) => {
    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return conversation;
    }

    const message = conversation.messages[messageIndex];
    const nextMessage = updater(message);
    if (nextMessage === message) {
      return conversation;
    }

    const nextMessages = [...conversation.messages];
    nextMessages[messageIndex] = nextMessage;
    return {
      ...conversation,
      messages: nextMessages,
    };
  });
}

function skipRemainingAgentRunPhases(
  phases: AgentRunPhase[],
  targetPhase: AgentRunPhaseKey,
  timestamp: number,
): AgentRunPhase[] {
  const targetIndex = AGENT_RUN_PHASE_DEFINITIONS.findIndex((phase) => phase.key === targetPhase);
  if (targetIndex < 0) {
    return phases;
  }

  return phases.map((phase, index) =>
    index > targetIndex && phase.status === 'pending'
      ? {
          ...phase,
          status: 'skipped',
          updatedAt: timestamp,
        }
      : phase,
  );
}

function resolveTargetAgentRunId(conversation: Conversation, runId?: string): string | undefined {
  return runId ?? conversation.activeAgentRunId;
}

function isTargetAgentRun(
  run: AgentRun,
  targetRunId: string | undefined,
  allowTerminalUpdates = false,
): boolean {
  if (!targetRunId || run.id !== targetRunId) {
    return false;
  }

  return allowTerminalUpdates || run.status === 'running';
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;

  createConversation: (
    providerId: string,
    systemPrompt: string,
    modelOverride?: string,
    options?: { activate?: boolean; personaId?: string; mode?: ConversationMode },
  ) => string;
  /**
   * Single-thread collapse. Returns the id of the
   * canonical conversation for the supplied `personaId` (or `'__default__'`
   * group when omitted). If a canonical conversation does not yet exist for
   * that persona group, one is created with the supplied provider/system
   * prompt/model and marked `isCanonical: true`. Activates the conversation
   * unless `options.activate === false`.
   */
  getOrCreateCanonicalThread: (
    providerId: string,
    systemPrompt: string,
    modelOverride?: string,
    options?: { activate?: boolean; personaId?: string; mode?: ConversationMode },
  ) => string;
  /**
   * Create an ephemeral side thread branched off `parentConversationId`. Side
   * threads inherit provider/model/persona/system-prompt from the parent unless
   * explicitly overridden, are not surfaced in the default sidebar listing, and
   * are intended to be discarded when the user is done exploring the tangent.
   * The active conversation is switched to the side thread by default.
   */
  createSideThread: (
    parentConversationId: string,
    options?: {
      title?: string;
      systemPrompt?: string;
      providerId?: string;
      modelOverride?: string;
      personaId?: string;
      mode?: ConversationMode;
      activate?: boolean;
    },
  ) => string | null;
  /**
   * Discard a side thread permanently. Returns true if the thread was removed.
   * Refuses to delete a non-side-thread; for those, use `deleteConversation`.
   */
  discardSideThread: (id: string) => boolean;
  setActiveConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  clearAllConversations: () => void;
  updateModelInConversation: (conversationId: string, providerId: string, model: string) => void;
  updatePersonaInConversation: (conversationId: string, personaId: string) => void;
  updateModeInConversation: (conversationId: string, mode: ConversationMode) => void;
  addMessage: (
    conversationId: string,
    message: Omit<Message, 'timestamp' | 'id'> & { id?: string },
  ) => void;
  applyConversationCompaction: (conversationId: string, messages: Message[]) => void;
  updateMessage: (conversationId: string, messageId: string, content: string) => void;
  updateMessageEnrichedContent: (
    conversationId: string,
    messageId: string,
    enrichedContent?: string,
  ) => void;
  updateMessageReasoning: (conversationId: string, messageId: string, reasoning: string) => void;
  updateMessageProviderReplay: (
    conversationId: string,
    messageId: string,
    providerReplay?: MessageProviderReplay,
  ) => void;
  updateMessageAssistantMetadata: (
    conversationId: string,
    messageId: string,
    assistantMetadata?: AssistantMessageMetadata,
  ) => void;
  updateMessageEffect: (
    conversationId: string,
    messageId: string,
    effectId?: Message['effectId'],
  ) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  setLoading: (loading: boolean) => void;
  addToolCall: (conversationId: string, messageId: string, toolCall: ToolCall) => void;
  updateToolCallStatus: (
    conversationId: string,
    messageId: string,
    toolCallId: string,
    status: ToolCall['status'],
    payload?: { result?: string; error?: string; completedAt?: number; progressText?: string },
  ) => void;
  recordConversationUsage: (
    conversationId: string,
    usage: TokenUsage & {
      providerId?: string;
      source?: ConversationUsageSource;
      modality?: 'image';
      toolCallId?: string;
      sessionId?: string;
      parentSessionId?: string;
      agentRunId?: string;
      timestamp?: number;
      estimatedCost?: number;
    },
  ) => void;
  addConversationLog: (
    conversationId: string,
    entry: {
      title: string;
      detail?: string;
      level?: ConversationLogLevel;
      kind?: ConversationLogKind;
      timestamp?: number;
    },
  ) => void;
  startAgentRun: (
    conversationId: string,
    params: {
      userMessageId: string;
      goal: string;
      timestamp?: number;
      summary?: Partial<AgentRunSummary>;
    },
  ) => string;
  setAgentRunPhase: (
    conversationId: string,
    phase: AgentRunPhaseKey,
    params?: {
      status?: Exclude<AgentRunPhaseStatus, 'pending'>;
      detail?: string;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      timestamp?: number;
      allowRegression?: boolean;
    },
    runId?: string,
  ) => void;
  appendAgentRunCheckpoint: (
    conversationId: string,
    entry: {
      kind?: AgentRunCheckpointKind;
      title: string;
      detail?: string;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  updateAgentRunSummary: (
    conversationId: string,
    patch: Partial<AgentRunSummary> & { latestSummary?: string; timestamp?: number },
    runId?: string,
  ) => void;
  updateAgentRunPendingAsyncOperations: (
    conversationId: string,
    operations: AgentRunAsyncOperation[],
    params?: { latestSummary?: string; timestamp?: number },
    runId?: string,
  ) => void;
  updateAgentRunPlan: (
    conversationId: string,
    patch: Partial<AgentRunPlan> & { timestamp?: number },
    runId?: string,
  ) => void;
  recordAgentRunEvidence: (
    conversationId: string,
    entries: AgentRunEvidenceDraft | AgentRunEvidenceDraft[],
    params?: { timestamp?: number },
    runId?: string,
  ) => AgentRunEvidenceEntry[] | undefined;
  updateAgentRunPilotEvaluation: (
    conversationId: string,
    evaluation: AgentRunPilotEvaluation | undefined,
    runId?: string,
  ) => void;
  setAgentRunAwaitingBackgroundWorkers: (
    conversationId: string,
    awaiting: boolean,
    params?: {
      latestSummary?: string;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  completeAgentRun: (
    conversationId: string,
    params?: {
      status?: Exclude<AgentRunStatus, 'running'>;
      latestSummary?: string;
      summary?: Partial<AgentRunSummary>;
      checkpointTitle?: string;
      checkpointDetail?: string;
      checkpointKind?: AgentRunCheckpointKind;
      timestamp?: number;
    },
    runId?: string,
  ) => void;
  recoverInterruptedAgentRuns: (
    activeSubAgents: SubAgentSnapshot[],
    params?: { timestamp?: number },
  ) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, _get) => ({
      conversations: [],
      activeConversationId: null,
      isLoading: false,

      createConversation: (providerId, systemPrompt, modelOverride, options) => {
        const now = Date.now();
        const id = generateId();
        const newConversation: Conversation = {
          id,
          title: getDefaultConversationTitle(),
          messages: [],
          providerId,
          modelOverride,
          systemPrompt,
          createdAt: now,
          updatedAt: now,
          personaId: options?.personaId,
          mode: options?.mode,
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [],
        };
        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: options?.activate === false ? state.activeConversationId : id,
        }));
        requestChatStorePersistenceCheckpoint();
        return id;
      },

      getOrCreateCanonicalThread: (providerId, systemPrompt, modelOverride, options) => {
        const groupKey =
          options?.personaId && options.personaId.length > 0
            ? options.personaId
            : '__default__';
        const { conversations } = _get();
        const existing = conversations.find((c) => {
          if (c.isSideThread || c.archivedFromMigration) return false;
          if (!c.isCanonical) return false;
          const ownKey = c.personaId && c.personaId.length > 0 ? c.personaId : '__default__';
          return ownKey === groupKey;
        });
        if (existing) {
          if (options?.activate !== false) {
            set({ activeConversationId: existing.id });
            requestChatStorePersistenceCheckpoint();
          }
          return existing.id;
        }
        const now = Date.now();
        const id = generateId();
        const newConversation: Conversation = {
          id,
          title: getDefaultConversationTitle(),
          messages: [],
          providerId,
          modelOverride,
          systemPrompt,
          createdAt: now,
          updatedAt: now,
          personaId: options?.personaId,
          mode: options?.mode,
          isCanonical: true,
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [],
        };
        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId:
            options?.activate === false ? state.activeConversationId : id,
        }));
        requestChatStorePersistenceCheckpoint();
        return id;
      },

      createSideThread: (parentConversationId, options) => {
        const { conversations } = _get();
        const parent = conversations.find((c) => c.id === parentConversationId);
        if (!parent) return null;
        // Refuse to nest side threads — keep the model flat (parent → many leaves).
        if (parent.isSideThread) return null;

        const now = Date.now();
        const id = generateId();
        const sideThread: Conversation = {
          id,
          title: options?.title ?? `↳ ${parent.title}`,
          messages: [],
          providerId: options?.providerId ?? parent.providerId,
          modelOverride: options?.modelOverride ?? parent.modelOverride,
          systemPrompt: options?.systemPrompt ?? parent.systemPrompt,
          createdAt: now,
          updatedAt: now,
          personaId: options?.personaId ?? parent.personaId,
          mode: options?.mode ?? parent.mode,
          parentConversationId,
          isSideThread: true,
          usage: {
            entries: [],
            totalInput: 0,
            totalOutput: 0,
            totalCacheRead: 0,
            totalCacheWrite: 0,
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
          },
          logs: [],
          agentRuns: [],
        };
        set((state) => ({
          conversations: [sideThread, ...state.conversations],
          activeConversationId:
            options?.activate === false ? state.activeConversationId : id,
        }));
        requestChatStorePersistenceCheckpoint();
        return id;
      },

      discardSideThread: (id) => {
        const { conversations } = _get();
        const target = conversations.find((c) => c.id === id);
        if (!target || !target.isSideThread) return false;
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversationId:
            state.activeConversationId === id
              ? target.parentConversationId ?? null
              : state.activeConversationId,
        }));
        requestChatStorePersistenceCheckpoint();
        return true;
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
        requestChatStorePersistenceCheckpoint();
      },

      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
        }));
        requestChatStorePersistenceCheckpoint();
      },

      clearAllConversations: () => {
        set({ conversations: [], activeConversationId: null });
        requestChatStorePersistenceCheckpoint();
      },

      updateModelInConversation: (conversationId, providerId, model) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, providerId, modelOverride: model } : c,
          ),
        })),

      updatePersonaInConversation: (conversationId, personaId) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const previousPersonaId = c.personaId;
            // Only record an inline event when the persona actually changes
            // and the conversation already has at least one message — empty
            // threads have nothing for the marker to anchor against.
            const shouldRecordEvent =
              previousPersonaId !== personaId && c.messages.length > 0;
            const personaEvents = shouldRecordEvent
              ? [
                  ...(c.personaEvents ?? []),
                  {
                    id: generateId(),
                    at: Date.now(),
                    from: previousPersonaId,
                    to: personaId,
                  },
                ]
              : c.personaEvents;
            return { ...c, personaId, personaEvents };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      updateModeInConversation: (conversationId, mode) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, mode } : c,
          ),
        })),

      addMessage: (conversationId, message) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const newMessage: Message = {
              ...message,
              id: message.id || generateId(),
              timestamp: Date.now(),
            };
            const shouldAutoTitle =
              message.role === 'user' && !!message.content?.trim() && isPlaceholderTitle(c.title);
            return {
              ...c,
              title: shouldAutoTitle ? generateConversationTitle(message.content) : c.title,
              messages: capMessages([...c.messages, newMessage]),
              updatedAt: Date.now(),
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      applyConversationCompaction: (conversationId, messages) => {
        const nextMessages = capMessages(normalizePersistedMessages(messages));

        set((state) => {
          const conversations = updateConversationById(
            state.conversations,
            conversationId,
            (conversation) => {
              if (nextMessages.length === 0) {
                return conversation;
              }

              return {
                ...conversation,
                messages: nextMessages,
                updatedAt: Date.now(),
              };
            },
          );

          return conversations ? { conversations } : state;
        });

        requestChatStorePersistenceCheckpoint();
      },

      updateMessage: (conversationId, messageId, content) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) => (message.content === content ? message : { ...message, content }),
          );
          return conversations ? { conversations } : state;
        }),

      updateMessageEnrichedContent: (conversationId, messageId, enrichedContent) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) =>
              message.enrichedContent === enrichedContent
                ? message
                : { ...message, enrichedContent },
          );
          return conversations ? { conversations } : state;
        }),

      updateMessageReasoning: (conversationId, messageId, reasoning) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) => (message.reasoning === reasoning ? message : { ...message, reasoning }),
          );
          return conversations ? { conversations } : state;
        }),

      updateMessageProviderReplay: (conversationId, messageId, providerReplay) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) =>
              message.providerReplay === providerReplay ? message : { ...message, providerReplay },
          );
          return conversations ? { conversations } : state;
        }),

      updateMessageAssistantMetadata: (conversationId, messageId, assistantMetadata) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) =>
              areAssistantMessageMetadataEqual(message.assistantMetadata, assistantMetadata)
                ? message
                : { ...message, assistantMetadata },
          );
          return conversations ? { conversations } : state;
        }),

      updateMessageEffect: (conversationId, messageId, effectId) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) => (message.effectId === effectId ? message : { ...message, effectId }),
          );
          return conversations ? { conversations } : state;
        }),

      editMessage: (conversationId, messageId, newContent) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const index = c.messages.findIndex((m) => m.id === messageId);
            if (index === -1) return c;
            const rewindTimestamp = c.messages[index]?.timestamp ?? Date.now();
            const editTimestamp = Date.now();
            const newMessages = c.messages.slice(0, index + 1).map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    content: newContent,
                    enrichedContent: undefined,
                    timestamp: editTimestamp,
                  }
                : m,
            );
            const nextLogs = (c.logs ?? []).filter((entry) => entry.timestamp < rewindTimestamp);
            const nextAgentRuns = (c.agentRuns ?? []).filter(
              (run) => run.createdAt < rewindTimestamp,
            );
            const nextActiveAgentRunId =
              c.activeAgentRunId &&
              nextAgentRuns.some((run) => run.id === c.activeAgentRunId && run.status === 'running')
                ? c.activeAgentRunId
                : undefined;

            return {
              ...c,
              messages: newMessages,
              logs: nextLogs,
              agentRuns: nextAgentRuns,
              activeAgentRunId: nextActiveAgentRunId,
              usage: c.usage,
              updatedAt: editTimestamp,
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      setLoading: (loading) =>
        set((state) => (state.isLoading === loading ? state : { isLoading: loading })),

      addToolCall: (conversationId, messageId, toolCall) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) => {
              const existingToolCalls = message.toolCalls || [];
              const existingIndex = findMatchingToolCallIndexWithinMessage(
                existingToolCalls,
                toolCall,
              );
              const existingToolCall =
                existingIndex >= 0 ? existingToolCalls[existingIndex] : undefined;
              const now = Date.now();
              const normalizedToolCall: ToolCall = {
                ...existingToolCall,
                ...toolCall,
                startedAt: toolCall.startedAt ?? existingToolCall?.startedAt ?? now,
                updatedAt: toolCall.updatedAt ?? existingToolCall?.updatedAt ?? now,
                completedAt: toolCall.completedAt ?? existingToolCall?.completedAt,
                progressText: toolCall.progressText ?? existingToolCall?.progressText,
                result: toolCall.result ?? existingToolCall?.result,
                error: toolCall.error ?? existingToolCall?.error,
              };

              const incomingAttachments = extractToolCallAttachments(normalizedToolCall);
              const nextAttachments = incomingAttachments?.length
                ? mergeAttachmentLists(message.attachments, incomingAttachments)
                : message.attachments;
              const hasAttachmentChange = !areAttachmentsEqual(
                message.attachments,
                nextAttachments,
              );
              const hasToolCallChange =
                existingIndex < 0 || !areToolCallsEqual(existingToolCall, normalizedToolCall);

              if (!hasToolCallChange && !hasAttachmentChange) {
                return message;
              }

              const nextToolCalls = hasToolCallChange
                ? existingIndex >= 0
                  ? [
                      ...existingToolCalls.slice(0, existingIndex),
                      normalizedToolCall,
                      ...existingToolCalls.slice(existingIndex + 1),
                    ]
                  : [...existingToolCalls, normalizedToolCall]
                : existingToolCalls;

              return {
                ...message,
                ...(hasAttachmentChange ? { attachments: nextAttachments } : {}),
                ...(hasToolCallChange ? { toolCalls: nextToolCalls } : {}),
              };
            },
          );
          return conversations ? { conversations } : state;
        }),

      updateToolCallStatus: (conversationId, messageId, toolCallId, status, payload) =>
        set((state) => {
          const conversations = updateConversationMessageById(
            state.conversations,
            conversationId,
            messageId,
            (message) => {
              if (!message.toolCalls?.length) {
                return message;
              }

              const toolCallIndex = message.toolCalls.findIndex(
                (toolCall) => toolCall.id === toolCallId,
              );
              if (toolCallIndex < 0) {
                return message;
              }

              const currentToolCall = message.toolCalls[toolCallIndex];
              const now = Date.now();
              const nextStartedAt = currentToolCall.startedAt ?? now;
              const nextCompletedAt =
                status === 'completed' || status === 'failed'
                  ? (payload?.completedAt ?? currentToolCall.completedAt ?? now)
                  : currentToolCall.completedAt;
              const nextProgressText = payload?.progressText ?? currentToolCall.progressText;
              const nextResult =
                payload?.result ?? (status === 'failed' ? undefined : currentToolCall.result);
              const nextError =
                payload?.error ?? (status !== 'failed' ? undefined : currentToolCall.error);
              const hasToolCallChange =
                currentToolCall.status !== status ||
                currentToolCall.startedAt !== nextStartedAt ||
                currentToolCall.completedAt !== nextCompletedAt ||
                currentToolCall.progressText !== nextProgressText ||
                currentToolCall.result !== nextResult ||
                currentToolCall.error !== nextError;

              const nextToolCall = hasToolCallChange
                ? {
                    ...currentToolCall,
                    status,
                    updatedAt: now,
                    startedAt: nextStartedAt,
                    completedAt: nextCompletedAt,
                    progressText: nextProgressText,
                    result: nextResult,
                    error: nextError,
                  }
                : currentToolCall;

              const incomingAttachments = extractToolCallAttachments(nextToolCall);
              const nextAttachments = incomingAttachments?.length
                ? mergeAttachmentLists(message.attachments, incomingAttachments)
                : message.attachments;
              const hasAttachmentChange = !areAttachmentsEqual(
                message.attachments,
                nextAttachments,
              );

              if (!hasToolCallChange && !hasAttachmentChange) {
                return message;
              }

              const nextToolCalls = hasToolCallChange
                ? [
                    ...message.toolCalls.slice(0, toolCallIndex),
                    nextToolCall,
                    ...message.toolCalls.slice(toolCallIndex + 1),
                  ]
                : message.toolCalls;

              return {
                ...message,
                ...(hasAttachmentChange ? { attachments: nextAttachments } : {}),
                ...(hasToolCallChange ? { toolCalls: nextToolCalls } : {}),
              };
            },
          );
          return conversations ? { conversations } : state;
        }),

      recordConversationUsage: (conversationId, usage) =>
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const timestamp = usage.timestamp ?? Date.now();
            const inputTokens = Math.max(0, usage.inputTokens ?? 0);
            const outputTokens = Math.max(0, usage.outputTokens ?? 0);
            const cacheReadTokens = Math.max(0, usage.cacheReadTokens ?? 0);
            const cacheWriteTokens = Math.max(0, usage.cacheWriteTokens ?? 0);
            const totalTokens = Math.max(inputTokens + outputTokens, usage.totalTokens ?? 0);
            const currentUsage = conversation.usage ?? {
              entries: [],
              totalInput: 0,
              totalOutput: 0,
              totalCacheRead: 0,
              totalCacheWrite: 0,
              totalTokens: 0,
              totalCost: 0,
              totalCalls: 0,
            };

            if (
              usage.toolCallId &&
              currentUsage.entries.some((entry) => entry.toolCallId === usage.toolCallId)
            ) {
              return conversation;
            }

            const estimatedCost = isZeroCostModel(usage.model)
              ? 0
              : (usage.estimatedCost ??
                estimateCost(usage.model, inputTokens, outputTokens, {
                  cacheReadTokens,
                  cacheWriteTokens,
                  tokenDetails: usage.tokenDetails,
                }));
            const entry: ConversationUsageEntry = {
              model: usage.model,
              providerId: usage.providerId,
              source: usage.source,
              modality: usage.modality,
              toolCallId: usage.toolCallId,
              sessionId: usage.sessionId,
              parentSessionId: usage.parentSessionId,
              agentRunId: usage.agentRunId,
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              totalTokens,
              estimatedCost,
              ...(usage.tokenDetails ? { tokenDetails: usage.tokenDetails } : {}),
              timestamp,
            };

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              usage: {
                entries: [...currentUsage.entries, entry].slice(-MAX_CONVERSATION_USAGE_ENTRIES),
                totalInput: currentUsage.totalInput + inputTokens,
                totalOutput: currentUsage.totalOutput + outputTokens,
                totalCacheRead: currentUsage.totalCacheRead + cacheReadTokens,
                totalCacheWrite: currentUsage.totalCacheWrite + cacheWriteTokens,
                totalTokens: currentUsage.totalTokens + totalTokens,
                totalCost: currentUsage.totalCost + estimatedCost,
                totalCalls: currentUsage.totalCalls + 1,
                lastModel: usage.model,
                lastProviderId: usage.providerId,
                lastUpdatedAt: timestamp,
              },
            };
          }),
        })),

      addConversationLog: (conversationId, entry) =>
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const timestamp = entry.timestamp ?? Date.now();
            const nextEntry: ConversationLogEntry = {
              id: generateId(),
              timestamp,
              level: entry.level ?? 'info',
              kind: entry.kind ?? 'system',
              title: entry.title,
              detail: entry.detail,
            };

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              logs: [...(conversation.logs ?? []), nextEntry].slice(-MAX_CONVERSATION_LOG_ENTRIES),
            };
          }),
        })),

      startAgentRun: (conversationId, params) => {
        const timestamp = params.timestamp ?? Date.now();
        const runId = generateId();

        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (run.id !== conversation.activeAgentRunId || run.status !== 'running') {
                return run;
              }

              const supersededRun = appendAgentCheckpoint(
                {
                  ...run,
                  status: 'cancelled',
                  awaitingBackgroundWorkers: false,
                  pendingAsyncOperations: undefined,
                  completedAt: timestamp,
                  updatedAt: timestamp,
                  phases: skipRemainingAgentRunPhases(
                    transitionAgentRunPhases(
                      run.phases,
                      run.currentPhase,
                      'skipped',
                      timestamp,
                      'Superseded by a new user turn.',
                    ),
                    run.currentPhase,
                    timestamp,
                  ),
                },
                {
                  timestamp,
                  kind: 'run',
                  title: 'Run superseded',
                  detail: 'A new user turn started before the previous run finished.',
                },
              );

              return supersededRun;
            });

            const newRun: AgentRun = {
              id: runId,
              userMessageId: params.userMessageId,
              goal: params.goal,
              status: 'running',
              awaitingBackgroundWorkers: false,
              pendingAsyncOperations: undefined,
              createdAt: timestamp,
              updatedAt: timestamp,
              currentPhase: 'assess',
              phases: createInitialAgentRunPhases(timestamp),
              checkpoints: [
                {
                  id: generateId(),
                  timestamp,
                  kind: 'run',
                  title: 'Turn started',
                  detail: params.goal,
                },
              ],
              plan: createDefaultAgentRunPlan(params.goal, timestamp),
              evidence: [],
              summary: mergeAgentRunSummary(undefined, params.summary),
            };

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: [...nextRuns, newRun].slice(-MAX_AGENT_RUNS),
              activeAgentRunId: runId,
            };
          }),
        }));

        requestChatStorePersistenceCheckpoint();

        return runId;
      },

      setAgentRunPhase: (conversationId, phase, params, runId) =>
        set((state) => {
          let didUpdateState = false;
          const nextConversations = state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = params?.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId)) {
                return run;
              }

              const nextPhaseIndex = getAgentRunPhaseIndex(phase);
              const currentPhaseIndex = getAgentRunPhaseIndex(run.currentPhase);
              const shouldPreserveCurrentPhase =
                !params?.allowRegression
                && nextPhaseIndex >= 0
                && currentPhaseIndex >= 0
                && nextPhaseIndex < currentPhaseIndex;
              const nextPhases = shouldPreserveCurrentPhase
                ? run.phases
                : transitionAgentRunPhases(
                    run.phases,
                    phase,
                    params?.status ?? 'active',
                    timestamp,
                    params?.detail,
                    { allowRegression: params?.allowRegression },
                  );
              const nextCurrentPhase = shouldPreserveCurrentPhase ? run.currentPhase : phase;
              if (
                !params?.checkpointTitle &&
                run.currentPhase === nextCurrentPhase &&
                areAgentRunPhasesEqual(run.phases, nextPhases)
              ) {
                return run;
              }

              didUpdate = true;
              const nextRunBase: AgentRun = {
                ...run,
                currentPhase: nextCurrentPhase,
                updatedAt: Math.max(run.updatedAt, timestamp),
                phases: nextPhases,
              };

              return params?.checkpointTitle
                ? appendAgentCheckpoint(nextRunBase, {
                    timestamp,
                    kind: params.checkpointKind ?? 'phase',
                    title: params.checkpointTitle,
                    detail: params.checkpointDetail ?? params.detail,
                  })
                : nextRunBase;
            });

            if (!didUpdate) {
              return conversation;
            }

            didUpdateState = true;
            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          });

          return didUpdateState ? { conversations: nextConversations } : state;
        }),

      appendAgentRunCheckpoint: (conversationId, entry, runId) =>
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = entry.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId, !!runId)) {
                return run;
              }

              didUpdate = true;
              return appendAgentCheckpoint(run, {
                timestamp,
                kind: entry.kind ?? 'note',
                title: entry.title,
                detail: entry.detail,
              });
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          }),
        })),

      updateAgentRunSummary: (conversationId, patch, runId) =>
        set((state) => {
          let didUpdateState = false;
          const nextConversations = state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = patch.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId, !!runId)) {
                return run;
              }

              const nextLatestSummary = patch.latestSummary ?? run.latestSummary;
              const nextSummary = mergeAgentRunSummary(run.summary, patch);
              if (
                nextLatestSummary === run.latestSummary &&
                areAgentRunSummariesEqual(run.summary, nextSummary)
              ) {
                return run;
              }

              didUpdate = true;
              return {
                ...run,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestSummary: nextLatestSummary,
                summary: nextSummary,
              };
            });

            if (!didUpdate) {
              return conversation;
            }

            didUpdateState = true;
            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          });

          return didUpdateState ? { conversations: nextConversations } : state;
        }),

      updateAgentRunPendingAsyncOperations: (conversationId, operations, params, runId) => {
        set((state) => {
          let didUpdateState = false;
          const normalizedOperations = normalizeAgentRunAsyncOperations(operations);

          const nextConversations = state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = params?.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId, true)) {
                return run;
              }

              const nextLatestSummary = params?.latestSummary ?? run.latestSummary;
              if (
                nextLatestSummary === run.latestSummary &&
                areAgentRunAsyncOperationsEqual(run.pendingAsyncOperations, normalizedOperations)
              ) {
                return run;
              }

              didUpdate = true;
              return {
                ...run,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestSummary: nextLatestSummary,
                pendingAsyncOperations: normalizedOperations,
              };
            });

            if (!didUpdate) {
              return conversation;
            }

            didUpdateState = true;
            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          });

          return didUpdateState ? { conversations: nextConversations } : state;
        });
        requestChatStorePersistenceCheckpoint();
      },

      updateAgentRunPlan: (conversationId, patch, runId) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = patch.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId)) {
                return run;
              }

              didUpdate = true;
              return {
                ...run,
                updatedAt: Math.max(run.updatedAt, timestamp),
                plan: mergeAgentRunPlan(run.plan, patch, run.goal, timestamp),
              };
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      recordAgentRunEvidence: (conversationId, entries, params, runId) => {
        const draftEntries = Array.isArray(entries) ? entries : [entries];
        const timestamp = params?.timestamp ?? Date.now();
        let recordedEntries: AgentRunEvidenceEntry[] | undefined;

        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId, !!runId)) {
                return run;
              }

              const nextEvidence = normalizeAgentRunEvidence(
                upsertAgentRunEvidenceEntries(run.evidence, draftEntries, timestamp),
              );

              if (areAgentRunEvidenceEntriesEqual(run.evidence, nextEvidence)) {
                recordedEntries = nextEvidence;
                return run;
              }

              didUpdate = true;
              recordedEntries = nextEvidence;
              return {
                ...run,
                updatedAt: Math.max(run.updatedAt, timestamp),
                evidence: nextEvidence,
              };
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          }),
        }));

        if (recordedEntries) {
          requestChatStorePersistenceCheckpoint();
        }

        return recordedEntries;
      },

      updateAgentRunPilotEvaluation: (conversationId, evaluation, runId) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = evaluation?.evaluatedAt ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId, true)) {
                return run;
              }

              didUpdate = true;
              return {
                ...run,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestPilotEvaluation: normalizeAgentRunPilotEvaluation(
                  evaluation,
                  run.plan?.objective ?? run.goal,
                  run.plan?.successCriteria ?? DEFAULT_AGENT_RUN_SUCCESS_CRITERIA,
                ),
              };
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      setAgentRunAwaitingBackgroundWorkers: (conversationId, awaiting, params, runId) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = params?.timestamp ?? Date.now();
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId)) {
                return run;
              }

              didUpdate = true;
              const nextRunBase: AgentRun = {
                ...run,
                awaitingBackgroundWorkers: awaiting,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestSummary: params?.latestSummary ?? run.latestSummary,
              };

              return params?.checkpointTitle
                ? appendAgentCheckpoint(nextRunBase, {
                    timestamp,
                    kind: params.checkpointKind ?? 'run',
                    title: params.checkpointTitle,
                    detail: params.checkpointDetail ?? params.latestSummary,
                  })
                : nextRunBase;
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      completeAgentRun: (conversationId, params, runId) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) {
              return conversation;
            }

            const targetRunId = resolveTargetAgentRunId(conversation, runId);
            if (!targetRunId) {
              return conversation;
            }

            const timestamp = params?.timestamp ?? Date.now();
            const finalStatus = params?.status ?? 'completed';
            let didUpdate = false;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (!isTargetAgentRun(run, targetRunId)) {
                return run;
              }

              didUpdate = true;
              const finalPhase = finalStatus === 'completed' ? 'deliver' : run.currentPhase;
              let nextRun: AgentRun = {
                ...run,
                status: finalStatus,
                awaitingBackgroundWorkers: false,
                pendingAsyncOperations: undefined,
                currentPhase: finalPhase,
                completedAt: timestamp,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestSummary: params?.latestSummary ?? run.latestSummary,
                summary: mergeAgentRunSummary(run.summary, params?.summary),
                phases: transitionAgentRunPhases(
                  run.phases,
                  finalPhase,
                  finalStatus === 'completed'
                    ? 'completed'
                    : finalStatus === 'failed'
                      ? 'failed'
                      : 'skipped',
                  timestamp,
                  params?.latestSummary,
                ),
              };

              if (finalStatus !== 'completed') {
                nextRun = {
                  ...nextRun,
                  phases: skipRemainingAgentRunPhases(nextRun.phases, finalPhase, timestamp),
                };
              }

              return params?.checkpointTitle
                ? appendAgentCheckpoint(nextRun, {
                    timestamp,
                    kind: params.checkpointKind ?? 'run',
                    title: params.checkpointTitle,
                    detail: params.checkpointDetail ?? params.latestSummary,
                  })
                : nextRun;
            });

            if (!didUpdate) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              agentRuns: nextRuns,
              activeAgentRunId:
                conversation.activeAgentRunId === targetRunId
                  ? undefined
                  : conversation.activeAgentRunId,
            };
          }),
        }));
        requestChatStorePersistenceCheckpoint();
      },

      recoverInterruptedAgentRuns: (activeSubAgents, params) =>
        set((state) => {
          const timestamp = params?.timestamp ?? Date.now();
          let didUpdateState = false;

          const nextConversations = state.conversations.map((conversation) => {
            let didUpdateConversation = false;
            let nextMessages = conversation.messages;
            const nextRuns = (conversation.agentRuns ?? []).map((run) => {
              if (run.status !== 'running') {
                return run;
              }

              const recoveredWorkers = getSubAgentsForAgentRun(
                conversation,
                run.id,
                activeSubAgents,
              );
              const recoveredState = buildRecoveredAgentRunState(
                conversation,
                run,
                recoveredWorkers,
              );
              if (!recoveredState) {
                return run;
              }

              didUpdateState = true;
              didUpdateConversation = true;

              let interruptedToolCount = 0;

              if (recoveredState.status === 'running') {
                const reviewPhase = recoveredState.phase ?? 'review';
                const nextRun = appendAgentCheckpoint(
                  {
                    ...run,
                    status: 'running',
                    awaitingBackgroundWorkers:
                      recoveredState.awaitingBackgroundWorkers ?? run.awaitingBackgroundWorkers,
                    currentPhase: reviewPhase,
                    updatedAt: Math.max(run.updatedAt, timestamp),
                    latestSummary: recoveredState.latestSummary,
                    summary: mergeAgentRunSummary(run.summary, {
                      durationMs: Math.max(0, timestamp - run.createdAt),
                    }),
                    phases: transitionAgentRunPhases(
                      run.phases,
                      reviewPhase,
                      'active',
                      timestamp,
                      recoveredState.latestSummary,
                    ),
                  },
                  {
                    timestamp,
                    kind: 'run',
                    title: recoveredState.checkpointTitle,
                    detail: recoveredState.checkpointDetail,
                  },
                );

                return nextRun;
              }

              const interruptedToolUpdate = markInterruptedToolCallsInRun(
                nextMessages,
                run.userMessageId,
                timestamp,
              );
              if (interruptedToolUpdate.interruptedCount > 0) {
                nextMessages = interruptedToolUpdate.messages;
                interruptedToolCount = interruptedToolUpdate.interruptedCount;
              }

              const finalPhase =
                recoveredState.status === 'completed' ? 'deliver' : run.currentPhase;
              let nextRun: AgentRun = {
                ...run,
                status: recoveredState.status,
                awaitingBackgroundWorkers: false,
                pendingAsyncOperations: undefined,
                currentPhase: finalPhase,
                completedAt: timestamp,
                updatedAt: Math.max(run.updatedAt, timestamp),
                latestSummary: recoveredState.latestSummary,
                summary: mergeAgentRunSummary(run.summary, {
                  failedTools:
                    interruptedToolCount > 0
                      ? mergeAgentRunSummary(run.summary).failedTools + interruptedToolCount
                      : undefined,
                  durationMs: Math.max(0, timestamp - run.createdAt),
                }),
                phases: transitionAgentRunPhases(
                  run.phases,
                  finalPhase,
                  recoveredState.status === 'completed'
                    ? 'completed'
                    : recoveredState.status === 'failed'
                      ? 'failed'
                      : 'skipped',
                  timestamp,
                  recoveredState.latestSummary,
                ),
              };

              if (recoveredState.status !== 'completed') {
                nextRun = {
                  ...nextRun,
                  phases: skipRemainingAgentRunPhases(nextRun.phases, finalPhase, timestamp),
                };
              }

              return appendAgentCheckpoint(nextRun, {
                timestamp,
                kind: 'run',
                title: recoveredState.checkpointTitle,
                detail: recoveredState.checkpointDetail,
              });
            });

            const nextActiveAgentRunId =
              conversation.activeAgentRunId &&
              nextRuns.some(
                (run) => run.id === conversation.activeAgentRunId && run.status === 'running',
              )
                ? conversation.activeAgentRunId
                : undefined;

            if (nextActiveAgentRunId !== conversation.activeAgentRunId) {
              didUpdateState = true;
              didUpdateConversation = true;
            }

            if (!didUpdateConversation) {
              return conversation;
            }

            return {
              ...conversation,
              updatedAt: Math.max(conversation.updatedAt, timestamp),
              messages: nextMessages,
              agentRuns: nextRuns,
              activeAgentRunId: nextActiveAgentRunId,
            };
          });

          return didUpdateState ? { conversations: nextConversations } : state;
        }),
    }),
    {
      name: STORAGE_KEYS.CONVERSATIONS,
      storage: createThrottledJSONStorage(),
      version: 7,
      migrate: (persistedState: any, fromVersion: number) => {
        const normalized = normalizePersistedChatState(
          persistedState as Partial<ChatState> | undefined,
        );
        if (typeof fromVersion === 'number' && fromVersion < 7) {
          normalized.conversations = collapseConversationsToCanonical(normalized.conversations);
        }
        return partializeChatPersistState(normalized);
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedChatState(persistedState as Partial<ChatState> | undefined),
      }),
      partialize: (state) => partializeChatPersistState(state),
    },
  ),
);
