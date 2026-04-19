// ---------------------------------------------------------------------------
// Kavi — Chat Screen
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { Menu, AlertTriangle, FolderOpen, Terminal, Cpu } from 'lucide-react-native';
import { requestChatStorePersistenceCheckpoint } from '../store/chatStorePersistence';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { ModelSelector } from '../components/chat/ModelSelector';
import { PersonaSelector } from '../components/chat/PersonaSelector';
import { SubAgentDetailModal } from '../components/agents/SubAgentDetailModal';
import { ApprovalBanner } from '../components/approval/ApprovalBanner';
import { runOrchestrator, OrchestratorCallbacks } from '../engine/orchestrator';
import {
  buildPendingAsyncOperationResumePrompt,
  buildPendingAsyncOperationSummary,
} from '../engine/pendingAsyncOperations';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import {
  AgentRun,
  AgentRunAsyncOperation,
  Attachment,
  Conversation,
  ConversationLogEntry,
  LlmProviderConfig,
  Message,
  SubAgentSnapshot,
  ToolCall,
} from '../types';
import { SUPER_AGENT_PERSONA_ID } from '../services/agents/personas';
import { buildAutomaticSubAgentEvidenceEntries } from '../services/agents/automaticEvidence';
import { generateId } from '../utils/id';
import { exportConversationAsMarkdown } from '../services/session/manager';
import { useTranslation } from '../i18n';
import { cancelSubAgent, listActiveSubAgents, onSubAgentEvent } from '../services/agents/subAgent';
import { getConversationWorkspaceFallbackConversationIds } from '../services/conversationWorkspace/fallbacks';
import { importConversationWorkspaceAttachment } from '../services/conversationWorkspace/files';
import { shareConversationWorkspaceFile, shareTextExport } from '../services/share/localShare';
import { getUsageCacheSummary } from '../services/usage/tracker';
import {
  recordConversationUsageEvent,
  recordImageToolConversationUsage,
} from '../services/usage/conversationUsage';
import { selectChatScreenChatSlice, selectChatScreenSettingsSlice } from './chatScreenSelectors';
import {
  buildAgentRunDisplayItemMap,
  buildStreamingDraftSignature,
  clearChatDisplayStateCache,
  createChatDisplayStateCache,
  getStableDisplayMessages,
  mergeStreamingToolCall,
  mergeStreamingToolCalls,
  normalizeStreamingDraft,
  resolveDisplayMessages,
  type ResolvedDisplayMessageItem,
  type StreamingDraft,
} from './chatScreenDisplayState';
import { stripInternalAssistantTranscriptArtifacts } from '../utils/assistantTextSanitizer';
import { isToolResultErrorLike } from '../utils/toolResultErrors';
import {
  buildSubAgentLifecycleMessage,
  formatCompactElapsed,
} from '../services/agents/subAgentPresentation';
import {
  buildAgentRunToolResultFallback,
  buildAgentRunVisibleDraftRecoveryText,
  buildMissingFinalResponseFallback,
  canRecoverAgentRunFinalResponse,
  collectAgentRunFinalizationEvidence,
  hasCompletedExecutionRecoveryEvidence,
  hasVerifiedFinalizationEvidence,
  synthesizeAgentRunFinalAnswer,
} from '../services/agents/agentRunFinalization';
import {
  cancelAgentRunOperations,
  clearAgentRunCancellation,
  createAgentRunOperationController,
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import {
  evaluateAgentRunWithPilot,
  PILOT_REVIEW_CHECKPOINT_TITLE,
} from '@/services/agents/agentWorkflowPilot';
import { extractStructuredAgentPlan } from '../services/agents/planParser';
import {
  evaluateWorkflowPlanContinuation,
  type WorkflowContinuationWorkstreamState,
  type WorkflowPlanContinuationResult,
} from '../services/agents/workflowScheduling';
import { assessUserRequest } from '../services/agents/requestAssessment';
import {
  buildAssistantMessageMetadata,
  isAssistantFinalResponsePlaceholder,
} from '../utils/assistantMessageMetadata';
import {
  buildSurfacedSubAgentOutputToolResultSummary,
  parseSurfacedSubAgentOutputResult,
} from '../services/agents/surfacedSubAgentOutput';
import {
  providerRequiresApiKey,
  resolveConversationStartSelection,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../services/llm/providerSupport';
import { isNonRetryableProviderRequestError } from '../services/llm/requestErrors';
import {
  getLocalLlmRuntimeStatus,
  isOnDeviceLlmProvider,
  subscribeToLocalLlmRuntimeStatusChanges,
  type LocalLlmRuntimeStatus,
  warmupLocalLlmSession,
} from '../services/localLlm/runtime';
import {
  cloneSubAgentSnapshot,
  collectSubAgentSnapshotsFromMessages,
  getAgentRunMessageSlice,
  getLatestFinalAssistantResponsePreview,
  getSubAgentsForConversation,
  getSubAgentsForAgentRun,
  hasDeliveredFinalAssistantResponse,
  resolveOwningConversationId,
  resolveAgentRunIdForSubAgent,
  resolveDisplayedSubAgentSnapshot,
  summarizeBackgroundWorkerRunOutcome as summarizeBackgroundWorkerSnapshots,
} from '../services/agents/workflowState';
import { hasModelVisibleAttachments } from '../utils/messageAttachments';

const STREAM_STORE_CHECKPOINT_INTERVAL_MS = 240;
const SUB_AGENT_PROGRESS_REFRESH_INTERVAL_MS = 400;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 96;
const USER_SCROLL_RELEASE_DELAY_MS = 64;
const MAX_LOG_PANEL_HEIGHT = 260;
const MAX_LOG_DETAIL_CHARS = 320;
const FINAL_RESPONSE_CHECKPOINT_TITLE = 'Final response delivered';
const FINAL_RESPONSE_SYNTHESIS_TITLE = 'Final response synthesis started';
const FINAL_RESPONSE_SYNTHESIS_DETAIL = 'Synthesizing final response from verified results.';

type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
  conversationId: string;
};

type RunChatOptions = {
  reuseAgentRunId?: string;
  additionalSystemPrompt?: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
};

type PendingAgentRunProgressUpdate = {
  conversationId: string;
  runId: string;
  detail: string;
  timestamp: number;
};

type ComposerDraftState = {
  text: string;
  attachments: Attachment[];
};

type LocalModelInitializationState = {
  modelKey: string | null;
  status: 'idle' | 'initializing' | 'initialized' | 'error';
  errorMessage: string | null;
};

type SurfacedSubAgentOutputLock = {
  toolCallId: string;
  messageId: string;
  content: string;
};

const NEW_CONVERSATION_DRAFT_KEY = '__new_conversation__';
const LOCAL_MODEL_INITIALIZATION_IDLE_STATE: LocalModelInitializationState = {
  modelKey: null,
  status: 'idle',
  errorMessage: null,
};

function buildAgentRunProgressKey(conversationId: string, runId: string): string {
  return `${conversationId}:${runId}`;
}

function getComposerDraftKey(conversationId?: string | null): string {
  return conversationId || NEW_CONVERSATION_DRAFT_KEY;
}

function normalizeComposerDraftState(draft?: Partial<ComposerDraftState>): ComposerDraftState {
  return {
    text: typeof draft?.text === 'string' ? draft.text : '',
    attachments: Array.isArray(draft?.attachments) ? draft.attachments : [],
  };
}

function isComposerDraftStateEmpty(draft: ComposerDraftState): boolean {
  return draft.text.length === 0 && draft.attachments.length === 0;
}

function extractMessageEffect(result?: string): Message['effectId'] | undefined {
  if (!result) return undefined;
  try {
    const parsed = JSON.parse(result);
    if (
      parsed?.effectId === 'confetti' ||
      parsed?.effectId === 'balloons' ||
      parsed?.effectId === 'spotlight'
    ) {
      return parsed.effectId;
    }
  } catch {
    // Ignore malformed tool result payloads.
  }
  return undefined;
}

function truncateLogDetail(value?: string, maxLength = MAX_LOG_DETAIL_CHARS): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatUsdCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  if (value < 0.0001) {
    return '<$0.0001';
  }
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatConversationLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatLogKindLabel(kind: ConversationLogEntry['kind']): string {
  switch (kind) {
    case 'state':
      return 'State';
    case 'tool':
      return 'Tool';
    case 'usage':
      return 'Usage';
    case 'compaction':
      return 'Compact';
    case 'command':
      return 'Command';
    case 'error':
      return 'Error';
    default:
      return 'System';
  }
}

function formatStateLabel(state: string): string {
  switch (state) {
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'idle':
      return 'Idle';
    case 'error':
      return 'Error';
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

function buildTurnSummaryLogDetail(params: {
  durationMs: number;
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
}): string {
  const parts = [
    `duration ${formatCompactElapsed(Math.max(0, params.durationMs))}`,
    `assistant turns ${params.assistantTurns}`,
  ];

  if (params.startedTools > 0) {
    parts.push(`tools ${params.completedTools}/${params.startedTools}`);
  }

  if (params.failedTools > 0) {
    parts.push(`failed ${params.failedTools}`);
  }

  if (params.spawnedSubAgents > 0) {
    parts.push(`sub-agents ${params.spawnedSubAgents}`);
  }

  return parts.join(' · ');
}

function getAgentRunCheckpointKindForToolName(
  toolName: string,
): AgentRun['checkpoints'][number]['kind'] {
  switch (toolName) {
    case 'sessions_spawn':
    case 'sessions_send':
    case 'sessions_cancel':
      return 'sub-agent';
    default:
      return 'tool';
  }
}

function isAgentReviewToolName(toolName: string): boolean {
  return (
    toolName === 'sessions_status' ||
    toolName === 'sessions_list' ||
    toolName === 'sessions_history' ||
    toolName === 'sessions_output' ||
    toolName === 'sessions_surface_output' ||
    toolName === 'sessions_wait' ||
    toolName === 'sessions_yield' ||
    toolName === 'expo_eas_workflow_status' ||
    toolName === 'expo_eas_workflow_wait' ||
    toolName === 'ssh_background_job_status' ||
    toolName === 'ssh_background_job_wait' ||
    toolName === 'wait'
  );
}

function isBackgroundWorkerMonitoringToolName(toolName: string): boolean {
  return (
    toolName === 'sessions_status' ||
    toolName === 'sessions_list' ||
    toolName === 'sessions_history' ||
    toolName === 'sessions_output' ||
    toolName === 'sessions_wait' ||
    toolName === 'sessions_yield'
  );
}

function getAgentRunPhaseForSubAgentEvent(
  event: 'started' | 'completed' | 'error' | 'cancelled' | 'progress' | 'timeout',
): AgentRun['currentPhase'] {
  return 'work';
}

function buildBackgroundWorkerWaitSummary(workerCount: number): string {
  return workerCount === 1
    ? 'Waiting for 1 background worker to finish.'
    : `Waiting for ${workerCount} background workers to finish.`;
}

function buildInterruptedBackgroundWorkerWaitSummary(workerCount: number): string {
  return `${buildBackgroundWorkerWaitSummary(workerCount)} The supervisor response was interrupted before the run could be finalized.`;
}

function buildInterruptedAsyncMonitoringSummary(operations: AgentRunAsyncOperation[]): string {
  const baseSummary =
    buildPendingAsyncOperationSummary(operations) || 'Resuming asynchronous workflow monitoring.';
  return `${baseSummary} The supervisor response was interrupted before monitoring could continue.`;
}

function buildStructuredPlanWorkstreamLabel(
  workstream: Pick<WorkflowContinuationWorkstreamState, 'title' | 'workstreamId'>,
): string {
  return `${workstream.title} [${workstream.workstreamId}]`;
}

function formatStructuredPlanReadyWorkstream(
  workstream: WorkflowContinuationWorkstreamState,
): string {
  const label = buildStructuredPlanWorkstreamLabel(workstream);
  if (workstream.status === 'failed') {
    const failedSessions =
      workstream.failedSessionIds.length > 0
        ? ` Previous failed sessions: ${workstream.failedSessionIds.join(', ')}.`
        : '';
    return `- ${label}: the previous attempt failed.${failedSessions} Repair or continue this same workstream next.`;
  }

  return `- ${label}: ready to continue now.`;
}

function formatStructuredPlanBlockedWorkstream(
  workstream: WorkflowContinuationWorkstreamState,
): string {
  const label = buildStructuredPlanWorkstreamLabel(workstream);
  return `- ${label}: blocked on ${workstream.unmetDependencyIds.join(', ')}.`;
}

function buildStructuredPlanContinuationActionLines(
  continuation: WorkflowPlanContinuationResult,
): string[] {
  const primaryReadyWorkstream = continuation.readyWorkstreams[0];
  if (primaryReadyWorkstream) {
    const label = buildStructuredPlanWorkstreamLabel(primaryReadyWorkstream);
    if (primaryReadyWorkstream.status === 'failed') {
      return [
        `Primary next workstream: ${label}.`,
        `For this response only, advance ${label} before doing any broad workflow review.`,
        primaryReadyWorkstream.failedSessionIds.length > 0
          ? `If you need failure context, inspect one failed session (${primaryReadyWorkstream.failedSessionIds.join(', ')}) with sessions_output and then, in the same response, continue ${label} with sessions_send or sessions_spawn.`
          : `Continue or repair ${label} now with sessions_send when an existing session still has the needed context, otherwise sessions_spawn.`,
        'Do not end the response after inspection alone.',
        'Do not call sessions_status, sessions_wait, sessions_history, or sessions_yield before you have taken that next work action.',
      ];
    }

    return [
      `Primary next workstream: ${label}.`,
      `For this response only, start or continue ${label} before doing any broad workflow review.`,
      `If there is no suitable existing session for ${label}, call sessions_spawn for workstreamId "${primaryReadyWorkstream.workstreamId}" now.`,
      'Do not call sessions_output, sessions_status, sessions_wait, sessions_history, or sessions_yield before you have launched or resumed that workstream.',
    ];
  }

  const primaryRunningWorkstream = continuation.runningWorkstreams[0];
  if (primaryRunningWorkstream) {
    const label = buildStructuredPlanWorkstreamLabel(primaryRunningWorkstream);
    return [
      `Primary running workstream: ${label}.`,
      `For this response only, inspect ${label} rather than re-reviewing the entire workflow.`,
      `Use sessions_status or sessions_wait for ${label} before deciding any next step.`,
      'Do not spawn duplicate work for the same workstream while it is still running.',
    ];
  }

  const primaryBlockedWorkstream = continuation.blockedWorkstreams[0];
  if (primaryBlockedWorkstream) {
    const label = buildStructuredPlanWorkstreamLabel(primaryBlockedWorkstream);
    const blockers = primaryBlockedWorkstream.unmetDependencyIds.join(', ');
    return [
      `Primary blocker: ${label} is blocked on ${blockers}.`,
      'For this response only, resolve the blocking prerequisite instead of re-reviewing the entire workflow.',
      blockers
        ? `Advance one unmet dependency workstream first: ${blockers}.`
        : 'Identify the missing prerequisite work before considering Pilot.',
      'Do not hand the run to Pilot while required workstreams remain blocked or incomplete.',
    ];
  }

  return [
    'For this response only, either advance the next remaining workstream or surface the concrete blocker from tool evidence before considering Pilot.',
  ];
}

function buildStructuredPlanPilotReviewPerspective(
  continuation: WorkflowPlanContinuationResult,
): { summary: string; nextActions: string[] } {
  return {
    summary: continuation.summary,
    nextActions: buildStructuredPlanContinuationActionLines(continuation),
  };
}

function buildStructuredPlanPilotCandidateOutcomeSummary(
  summary: string,
  continuation: WorkflowPlanContinuationResult,
): string {
  return [summary.trim(), `Structured plan review: ${continuation.summary}`]
    .filter((section) => section.length > 0)
    .join(' ');
}

function buildCancelledRunSummary(cancelledWorkerCount: number): string {
  return cancelledWorkerCount === 1
    ? 'The current run was cancelled and 1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `The current run was cancelled and ${cancelledWorkerCount} background workers were stopped.`
      : 'The current run was cancelled.';
}

function formatLocalRuntimeBadgeLabel(status: LocalLlmRuntimeStatus): string {
  if (status.backendSource === 'observed') {
    return status.fellBackFromRequestedBackend
      ? `${status.activeBackend.toUpperCase()} fallback`
      : status.activeBackend.toUpperCase();
  }

  return `Likely ${status.activeBackend.toUpperCase()}`;
}

function buildSupersededRunSummary(cancelledWorkerCount: number): string {
  return cancelledWorkerCount === 1
    ? 'A new user turn started before the previous run finished and 1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `A new user turn started before the previous run finished and ${cancelledWorkerCount} background workers were stopped.`
      : 'A new user turn started before the previous run finished.';
}

function buildStoppedBackgroundWorkerDetail(cancelledWorkerCount: number): string | undefined {
  return cancelledWorkerCount === 1
    ? '1 background worker was stopped.'
    : cancelledWorkerCount > 1
      ? `${cancelledWorkerCount} background workers were stopped.`
      : undefined;
}

function getLiveSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
) {
  return getSubAgentsForAgentRun(conversation, agentRunId, listActiveSubAgents());
}

function getRunningLiveSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
) {
  return getLiveSubAgentsForRun(conversation, agentRunId).filter(
    (agent) => agent.status === 'running',
  );
}

function cancelRunningSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
  reason: string,
) {
  const runningWorkers = getRunningLiveSubAgentsForRun(conversation, agentRunId);

  for (const worker of runningWorkers) {
    cancelSubAgent(worker.sessionId, reason);
  }

  return runningWorkers;
}

function getRunningConversationRunsForCancellation(
  conversation: Pick<Conversation, 'activeAgentRunId' | 'agentRuns'>,
): AgentRun[] {
  const runningRuns = (conversation.agentRuns ?? []).filter((run) => run.status === 'running');
  if (runningRuns.length <= 1) {
    return runningRuns;
  }

  const activeRun = conversation.activeAgentRunId
    ? runningRuns.find((run) => run.id === conversation.activeAgentRunId)
    : undefined;
  const remainingRuns = runningRuns
    .filter((run) => run.id !== activeRun?.id)
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return right.createdAt - left.createdAt;
    });

  return activeRun ? [activeRun, ...remainingRuns] : remainingRuns;
}

function getReviewableSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns' | 'messages'>,
  run: AgentRun,
): {
  liveSnapshots: SubAgentSnapshot[];
  mergedSnapshots: SubAgentSnapshot[];
  hasOrphanedRunningSnapshots: boolean;
} {
  const liveSnapshots = getLiveSubAgentsForRun(conversation, run.id);
  const persistedSnapshots = getSubAgentsForAgentRun(
    conversation,
    run.id,
    collectSubAgentSnapshotsFromMessages(
      getAgentRunMessageSlice(conversation.messages, run.userMessageId),
    ),
  );
  const snapshotsBySessionId = new Map<string, SubAgentSnapshot>();

  for (const snapshot of persistedSnapshots) {
    snapshotsBySessionId.set(snapshot.sessionId, cloneSubAgentSnapshot(snapshot));
  }

  for (const snapshot of liveSnapshots) {
    const persistedSnapshot = snapshotsBySessionId.get(snapshot.sessionId);
    snapshotsBySessionId.set(
      snapshot.sessionId,
      persistedSnapshot
        ? resolveDisplayedSubAgentSnapshot(persistedSnapshot, snapshot)
        : cloneSubAgentSnapshot(snapshot),
    );
  }

  const mergedSnapshots = Array.from(snapshotsBySessionId.values());
  const hasLiveRunningSnapshots = liveSnapshots.some((snapshot) => snapshot.status === 'running');

  return {
    liveSnapshots,
    mergedSnapshots,
    hasOrphanedRunningSnapshots:
      !hasLiveRunningSnapshots && mergedSnapshots.some((snapshot) => snapshot.status === 'running'),
  };
}

function isPlainAgentRunAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' && !message.subAgentEvent && (message.toolCalls?.length ?? 0) === 0
  );
}

function isReusableAgentRunAssistantMessage(message: Message): boolean {
  return message.role === 'assistant' && !message.subAgentEvent;
}

function shouldSkipAgentRunAssistantLookupMessage(message: Message): boolean {
  return message.role === 'tool' || (message.role === 'assistant' && !!message.subAgentEvent);
}

function hasVisibleAssistantOutput(
  message: Pick<Message, 'content' | 'reasoning' | 'attachments' | 'effectId'>,
): boolean {
  return (
    message.content.trim().length > 0 ||
    !!message.reasoning?.trim().length ||
    (message.attachments?.length ?? 0) > 0 ||
    !!message.effectId
  );
}

function findLatestAgentRunAssistantMessageId(
  messages: Message[],
  userMessageId: string,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      if (!hasVisibleAssistantOutput(message)) {
        return undefined;
      }

      return message.id;
    }

    return undefined;
  }

  return undefined;
}

function findLatestPreferredAgentRunAssistantMessageId(
  messages: Message[],
  userMessageId: string,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      if (!hasVisibleAssistantOutput(message)) {
        return undefined;
      }

      if (isAssistantFinalResponsePlaceholder(message)) {
        continue;
      }

      return message.id;
    }

    return undefined;
  }

  return undefined;
}

function findAgentRunReplaceableAssistantMessageId(
  messages: Message[],
  userMessageId: string,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      const visibleOutput = hasVisibleAssistantOutput(message);
      return visibleOutput && !isAssistantFinalResponsePlaceholder(message)
        ? undefined
        : message.id;
    }

    return undefined;
  }

  return undefined;
}

function findLatestIncompleteAgentRunAssistantMessage(
  messages: Message[],
  userMessageId: string,
): Message | undefined {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (shouldSkipAgentRunAssistantLookupMessage(message)) {
      continue;
    }

    if (isReusableAgentRunAssistantMessage(message)) {
      const visibleOutput = hasVisibleAssistantOutput(message);

      if (message.assistantMetadata?.completionStatus === 'incomplete' && visibleOutput) {
        return message;
      }

      return undefined;
    }

    return undefined;
  }

  return undefined;
}

function findAssistantContinuationOverlap(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

function extractAssistantContinuationLead(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  const paragraphBreakIndex = normalized.indexOf('\n\n');
  const listBreakIndex = normalized.search(/\n(?:[-*]|\d+\.)\s/);
  const boundaryCandidates = [paragraphBreakIndex, listBreakIndex].filter((value) => value >= 0);
  const endIndex =
    boundaryCandidates.length > 0
      ? Math.min(...boundaryCandidates, 160)
      : Math.min(normalized.length, 160);

  return normalized.slice(0, endIndex).replace(/\s+/g, ' ').trim();
}

function shouldReplaceRestartedAssistantContinuation(
  existingText: string,
  incomingText: string,
): boolean {
  const existingLead = extractAssistantContinuationLead(existingText);
  const incomingLead = extractAssistantContinuationLead(incomingText);
  if (!existingLead || !incomingLead) {
    return false;
  }

  const leadMatches =
    existingLead === incomingLead ||
    existingLead.startsWith(incomingLead) ||
    incomingLead.startsWith(existingLead);
  if (!leadMatches || Math.min(existingLead.length, incomingLead.length) < 32) {
    return false;
  }

  const existingStructured = existingText.includes('\n') || existingText.length >= 80;
  const incomingStructured =
    incomingText.includes('\n') || incomingText.length >= Math.min(160, existingText.length);
  return existingStructured && incomingStructured;
}

function normalizeAssistantContinuationLine(line: string): string {
  return line
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructuredAssistantContinuationLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => normalizeAssistantContinuationLine(line))
        .filter((line) => line.length >= 24),
    ),
  ];
}

function countStructuredAssistantContinuationLineMatches(
  sourceLines: ReadonlyArray<string>,
  candidateLines: ReadonlyArray<string>,
): number {
  return sourceLines.filter((sourceLine) =>
    candidateLines.some(
      (candidateLine) =>
        candidateLine === sourceLine ||
        candidateLine.includes(sourceLine) ||
        sourceLine.includes(candidateLine),
    ),
  ).length;
}

function shouldReplaceOverlappingStructuredAssistantContinuation(
  existingText: string,
  incomingText: string,
): boolean {
  const existingLines = extractStructuredAssistantContinuationLines(existingText);
  const incomingLines = extractStructuredAssistantContinuationLines(incomingText);
  if (existingLines.length < 2 || incomingLines.length < 2) {
    return false;
  }

  const overlapCount = countStructuredAssistantContinuationLineMatches(
    existingLines,
    incomingLines,
  );
  if (overlapCount < 2) {
    return false;
  }

  const existingCoverage = overlapCount / existingLines.length;
  const incomingCoverage = overlapCount / incomingLines.length;
  const incomingSupersedesExisting =
    incomingText.trim().length >= Math.floor(existingText.trim().length * 0.75) ||
    incomingLines.length >= existingLines.length;
  return existingCoverage >= 0.5 && incomingCoverage >= 0.25 && incomingSupersedesExisting;
}

function mergeAssistantContinuationText(
  existingText: string,
  incomingText: string,
  options?: { preserveExistingPrefix?: boolean },
): string {
  if (!existingText) {
    return incomingText;
  }

  if (!incomingText) {
    return existingText;
  }

  if (incomingText.startsWith(existingText)) {
    return incomingText;
  }

  if (existingText.startsWith(incomingText)) {
    return existingText;
  }

  if (shouldReplaceRestartedAssistantContinuation(existingText, incomingText)) {
    return incomingText;
  }

  if (shouldReplaceOverlappingStructuredAssistantContinuation(existingText, incomingText)) {
    return incomingText;
  }

  const normalizedExisting = existingText.trim();
  const normalizedIncoming = incomingText.trim();
  if (!options?.preserveExistingPrefix && normalizedExisting && normalizedIncoming) {
    const anchorLength = Math.min(96, Math.max(24, Math.floor(normalizedExisting.length / 3)));
    const existingAnchor = normalizedExisting.slice(0, anchorLength);
    if (normalizedIncoming.startsWith(existingAnchor)) {
      return incomingText;
    }
  }

  const overlapLength = findAssistantContinuationOverlap(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  if (
    existingText.endsWith('\n') ||
    incomingText.startsWith('\n') ||
    /[ \t]$/.test(existingText) ||
    /^[ \t,.;:!?)]/.test(incomingText)
  ) {
    return `${existingText}${incomingText}`;
  }

  return incomingText.includes('\n')
    ? `${existingText}\n\n${incomingText}`
    : `${existingText} ${incomingText}`;
}

function summarizeToolArguments(argumentsText: string): string | undefined {
  try {
    return truncateLogDetail(JSON.stringify(JSON.parse(argumentsText)));
  } catch {
    return truncateLogDetail(argumentsText);
  }
}

function summarizeToolResult(toolCall: ToolCall): string | undefined {
  if (toolCall.error) {
    return truncateLogDetail(toolCall.error);
  }

  const surfacedOutput = parseSurfacedSubAgentOutputResult(toolCall.result);
  if (surfacedOutput) {
    return truncateLogDetail(
      surfacedOutput.usedFullOutput
        ? `Surfaced worker output from ${surfacedOutput.sessionId}`
        : `Surfaced bounded worker output from ${surfacedOutput.sessionId}`,
    );
  }

  return truncateLogDetail(toolCall.result);
}

function hasStructuredPlanMarkers(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('objective') &&
    (normalized.includes('success criteria') ||
      normalized.includes('stop conditions') ||
      normalized.includes('workstreams'))
  );
}

export const ChatScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const isFocused = useIsFocused();
  const flatListRef = useRef<FlatList>(null);
  const abortRef = useRef<AbortController | null>(null);
  const foregroundRequestRef = useRef<
    { requestId: string; conversationId: string; abort: AbortController } | null
  >(null);
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const chatSlice = useChatStore(useShallow(selectChatScreenChatSlice));
  const {
    conversations,
    activeConversation,
    activeConversationId,
    isLoading,
    createConversation,
    addMessage,
    updateMessage,
    updateMessageEnrichedContent,
    updateMessageReasoning,
    updateMessageProviderReplay,
    updateMessageAssistantMetadata,
    updateMessageEffect,
    editMessage,
    setLoading,
    addToolCall,
    updateToolCallStatus,
    addConversationLog,
    startAgentRun,
    setAgentRunPhase,
    appendAgentRunCheckpoint,
    updateAgentRunSummary,
    updateAgentRunPendingAsyncOperations,
    updateAgentRunPlan,
    updateAgentRunPilotEvaluation,
    setAgentRunAwaitingBackgroundWorkers,
    completeAgentRun,
    updateModelInConversation,
    updatePersonaInConversation,
    updateModeInConversation,
  } = chatSlice;

  const settingsSlice = useSettingsStore(useShallow(selectChatScreenSettingsSlice));
  const {
    providers,
    activeProviderId,
    activeModel,
    thinkingLevel,
    systemPrompt,
    setActiveProviderAndModel,
    setLastUsedModel,
    linkUnderstandingEnabled,
    mediaUnderstandingEnabled,
    maxLinks,
    defaultConversationMode,
  } = settingsSlice;

  const [chatError, setChatError] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string | undefined>(undefined);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraftState>>({});
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedSubAgentSnapshot, setSelectedSubAgentSnapshot] = useState<
    NonNullable<Message['subAgentEvent']>['snapshot'] | null
  >(null);
  const [activeLocalRuntimeStatus, setActiveLocalRuntimeStatus] =
    useState<LocalLlmRuntimeStatus | null>(null);
  const [localModelInitialization, setLocalModelInitialization] =
    useState<LocalModelInitializationState>(LOCAL_MODEL_INITIALIZATION_IDLE_STATE);
  const [foregroundRequestConversationId, setForegroundRequestConversationId] = useState<
    string | null
  >(null);
  const [streamingDraftVersion, setStreamingDraftVersion] = useState(0);
  const [subAgentActivityVersion, setSubAgentActivityVersion] = useState(0);
  const streamingDraftsRef = useRef<Record<string, StreamingDraft>>({});
  const streamingDraftSignaturesRef = useRef<Record<string, string>>({});
  const pendingSubAgentProgressRef = useRef(
    new Map<string, NonNullable<Message['subAgentEvent']>['snapshot']>(),
  );
  const pendingAgentRunProgressRef = useRef(new Map<string, PendingAgentRunProgressUpdate>());
  const selectedSubAgentSessionIdRef = useRef<string | null>(null);
  const listMetricsRef = useRef({ contentHeight: 0, layoutHeight: 0, offsetY: 0 });
  const shouldAutoFollowRef = useRef(true);
  const forceNextScrollRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const interactionReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subAgentProgressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollFollowUpFrameRef = useRef<number | null>(null);
  const previousVisibleCountRef = useRef(0);
  const displayStateCacheRef = useRef(createChatDisplayStateCache());
  const lastLoggedStateRef = useRef<string | null>(null);
  const initializedLocalModelKeysRef = useRef(new Set<string>());
  const initializingLocalModelKeyRef = useRef<string | null>(null);
  const pendingAgentRunFinalizationsRef = useRef(new Map<string, Promise<string | undefined>>());
  const pendingAgentRunPilotResumesRef = useRef(new Map<string, Promise<void>>());
  const pendingAgentRunAsyncResumesRef = useRef(new Map<string, Promise<void>>());
  const ensureAgentRunFinalResponseRef = useRef<
    | ((params: {
        conversationId: string;
        runId: string;
        status: Exclude<AgentRun['status'], 'running'>;
        providerContext?: ResolvedFinalizationProviderContext;
        timestamp?: number;
        preferredAssistantMessageId?: string;
        signal?: AbortSignal;
      }) => Promise<string | undefined>)
    | null
  >(null);
  const resumeAgentRunRef = useRef<
    | ((params: {
        conversationId: string;
        runId: string;
        additionalSystemPrompt: string;
        additionalUserPrompt?: string;
        disableTools?: boolean;
        initialPendingAsyncOperations?: AgentRunAsyncOperation[];
      }) => Promise<void>)
    | null
  >(null);
  const resolveConversationFinalizationContextRef = useRef<
    | ((conversation: Conversation) => Promise<ResolvedFinalizationProviderContext | undefined>)
    | null
  >(null);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === (activeConversation?.providerId || activeProviderId)),
    [providers, activeConversation?.providerId, activeProviderId],
  );

  const currentModel = resolveConversationModel(activeProvider, {
    conversationModel: activeConversation?.modelOverride,
    activeProviderId,
    activeModel,
  });

  const activeInstalledLocalModel = useMemo(() => {
    if (!activeProvider || !currentModel || !isOnDeviceLlmProvider(activeProvider)) {
      return null;
    }

    return (
      activeProvider.local?.installedModels?.find((entry) => entry.modelId === currentModel) || null
    );
  }, [activeProvider, currentModel]);

  const activeLocalModelKey = useMemo(() => {
    if (
      !activeProvider ||
      !currentModel ||
      !isOnDeviceLlmProvider(activeProvider) ||
      !activeInstalledLocalModel
    ) {
      return null;
    }

    return `${activeInstalledLocalModel.localPath || currentModel}::${currentModel}::${activeProvider.local?.backend || 'default'}`;
  }, [activeInstalledLocalModel, activeProvider, currentModel]);

  const isLocalModelInitializing =
    activeLocalModelKey != null &&
    localModelInitialization.modelKey === activeLocalModelKey &&
    localModelInitialization.status === 'initializing';

  const activeErrorMessage =
    activeLocalModelKey != null &&
    localModelInitialization.modelKey === activeLocalModelKey &&
    localModelInitialization.status === 'error' &&
    localModelInitialization.errorMessage
      ? localModelInitialization.errorMessage
      : chatError;

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      if (
        !isFocused ||
        !activeProvider ||
        !currentModel ||
        !isOnDeviceLlmProvider(activeProvider)
      ) {
        if (!cancelled) {
          setActiveLocalRuntimeStatus(null);
        }
        return;
      }

      try {
        const status = await getLocalLlmRuntimeStatus(activeProvider, currentModel);
        if (!cancelled) {
          setActiveLocalRuntimeStatus(status);
        }
      } catch {
        if (!cancelled) {
          setActiveLocalRuntimeStatus(null);
        }
      }
    };

    if (!isFocused || !activeProvider || !currentModel || !isOnDeviceLlmProvider(activeProvider)) {
      setActiveLocalRuntimeStatus(null);
      return () => {
        cancelled = true;
      };
    }

    void loadStatus();
    const unsubscribe = subscribeToLocalLlmRuntimeStatusChanges(() => {
      void loadStatus();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isFocused, activeProvider, currentModel]);

  useEffect(() => {
    if (!activeLocalModelKey || !activeLocalRuntimeStatus?.observedBackend) {
      return;
    }

    initializedLocalModelKeysRef.current.add(activeLocalModelKey);
    if (initializingLocalModelKeyRef.current === activeLocalModelKey) {
      initializingLocalModelKeyRef.current = null;
    }

    setLocalModelInitialization((current) => {
      if (
        current.modelKey === activeLocalModelKey &&
        current.status === 'initialized' &&
        current.errorMessage == null
      ) {
        return current;
      }

      return {
        modelKey: activeLocalModelKey,
        status: 'initialized',
        errorMessage: null,
      };
    });
  }, [activeLocalModelKey, activeLocalRuntimeStatus?.observedBackend]);

  useEffect(() => {
    let cancelled = false;

    if (
      !isFocused ||
      !activeProvider ||
      !currentModel ||
      !isOnDeviceLlmProvider(activeProvider) ||
      !activeLocalModelKey
    ) {
      setLocalModelInitialization(LOCAL_MODEL_INITIALIZATION_IDLE_STATE);
      return () => {
        cancelled = true;
      };
    }

    if (initializedLocalModelKeysRef.current.has(activeLocalModelKey)) {
      setLocalModelInitialization((current) => {
        if (
          current.modelKey === activeLocalModelKey &&
          current.status === 'initialized' &&
          current.errorMessage == null
        ) {
          return current;
        }

        return {
          modelKey: activeLocalModelKey,
          status: 'initialized',
          errorMessage: null,
        };
      });

      return () => {
        cancelled = true;
      };
    }

    if (initializingLocalModelKeyRef.current === activeLocalModelKey) {
      setLocalModelInitialization((current) => {
        if (current.modelKey === activeLocalModelKey && current.status === 'initializing') {
          return current;
        }

        return {
          modelKey: activeLocalModelKey,
          status: 'initializing',
          errorMessage: null,
        };
      });

      return () => {
        cancelled = true;
      };
    }

    initializingLocalModelKeyRef.current = activeLocalModelKey;
    setLocalModelInitialization({
      modelKey: activeLocalModelKey,
      status: 'initializing',
      errorMessage: null,
    });

    void warmupLocalLlmSession(activeProvider, currentModel)
      .then(async () => {
        initializedLocalModelKeysRef.current.add(activeLocalModelKey);
        if (initializingLocalModelKeyRef.current === activeLocalModelKey) {
          initializingLocalModelKeyRef.current = null;
        }

        const status = await getLocalLlmRuntimeStatus(activeProvider, currentModel).catch(
          () => null,
        );
        if (cancelled) {
          return;
        }

        if (status) {
          setActiveLocalRuntimeStatus(status);
        }

        setLocalModelInitialization({
          modelKey: activeLocalModelKey,
          status: 'initialized',
          errorMessage: null,
        });
      })
      .catch((error) => {
        if (initializingLocalModelKeyRef.current === activeLocalModelKey) {
          initializingLocalModelKeyRef.current = null;
        }
        if (cancelled) {
          return;
        }

        setLocalModelInitialization({
          modelKey: activeLocalModelKey,
          status: 'error',
          errorMessage:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : t('chat.localModelInitializeFailed'),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isFocused, activeProvider, currentModel, activeLocalModelKey, t]);

  // ── Conversation mode ──────────────────────────────────────────────
  const effectiveMode = activeConversation?.mode ?? defaultConversationMode ?? 'agentic';
  const isAgenticMode = effectiveMode === 'agentic';
  const activeConversationHasRunningRun = (activeConversation?.agentRuns ?? []).some(
    (run) => run.status === 'running',
  );
  const isConversationBusy =
    (activeConversationId != null && foregroundRequestConversationId === activeConversationId) ||
    activeConversationHasRunningRun;
  // In agentic mode, always route through super-agent persona
  const effectivePersonaId = isAgenticMode
    ? SUPER_AGENT_PERSONA_ID
    : activeConversation?.personaId || 'default';

  const appendConversationLog = useCallback(
    (
      conversationId: string,
      entry: {
        title: string;
        detail?: string;
        level?: ConversationLogEntry['level'];
        kind?: ConversationLogEntry['kind'];
        timestamp?: number;
      },
    ) => {
      addConversationLog(conversationId, {
        ...entry,
        detail: truncateLogDetail(entry.detail),
      });
    },
    [addConversationLog],
  );

  const registerForegroundRequest = useCallback(
    (requestId: string, conversationId: string, abortController: AbortController) => {
      foregroundRequestRef.current = {
        requestId,
        conversationId,
        abort: abortController,
      };
      abortRef.current = abortController;
      setForegroundRequestConversationId(conversationId);
      setLoading(true);
    },
    [setLoading],
  );

  const isCurrentForegroundRequest = useCallback(
    (requestId: string, abortController: AbortController) => {
      const currentRequest = foregroundRequestRef.current;
      return (
        !!currentRequest &&
        currentRequest.requestId === requestId &&
        currentRequest.abort === abortController
      );
    },
    [],
  );

  const clearForegroundRequest = useCallback(
    (requestId: string, abortController: AbortController) => {
      if (!isCurrentForegroundRequest(requestId, abortController)) {
        return false;
      }

      foregroundRequestRef.current = null;
      abortRef.current = null;
      setForegroundRequestConversationId(null);
      setStreamingMessageId(null);
      setLoading(false);
      return true;
    },
    [isCurrentForegroundRequest, setLoading],
  );

  const abortForegroundRequestForConversation = useCallback(
    (conversationId: string, reason?: string) => {
      const currentRequest = foregroundRequestRef.current;
      if (!currentRequest || currentRequest.conversationId !== conversationId) {
        return false;
      }

      if (!currentRequest.abort.signal.aborted) {
        currentRequest.abort.abort(reason);
      }

      return true;
    },
    [],
  );

  const clearForegroundRequestForConversation = useCallback(
    (conversationId: string) => {
      const currentRequest = foregroundRequestRef.current;
      if (!currentRequest || currentRequest.conversationId !== conversationId) {
        return false;
      }

      return clearForegroundRequest(currentRequest.requestId, currentRequest.abort);
    },
    [clearForegroundRequest],
  );

  const cancelConversationRunForRewind = useCallback(
    (conversationId: string, reason: string) => {
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId);
      const activeAgentRunId = conversation?.activeAgentRunId;

      abortForegroundRequestForConversation(conversationId, reason);

      if (!conversation || !activeAgentRunId) {
        return;
      }

      cancelAgentRunOperations(conversationId, activeAgentRunId, reason);
      cancelRunningSubAgentsForRun(conversation, activeAgentRunId, reason);
      pendingAgentRunFinalizationsRef.current.delete(activeAgentRunId);
      pendingAgentRunPilotResumesRef.current.delete(activeAgentRunId);
      pendingAgentRunAsyncResumesRef.current.delete(activeAgentRunId);
    },
    [abortForegroundRequestForConversation],
  );

  const queueTerminalBackgroundReview = useCallback(
    (params: { conversationId: string; runId: string; timestamp?: number }): Promise<void> => {
      const inFlight = pendingAgentRunPilotResumesRef.current.get(params.runId);
      if (inFlight) {
        return inFlight;
      }

      const reviewPromise = (async () => {
        const operation = createAgentRunOperationController({
          conversationId: params.conversationId,
          runId: params.runId,
          operationId: 'pilot-review',
        });

        try {
          throwIfAbortSignalTriggered(operation.signal);

          const reviewTimestamp = params.timestamp ?? Date.now();
          const latestConversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId);
          const targetRun = latestConversation?.agentRuns?.find(
            (candidate) => candidate.id === params.runId,
          );
          if (
            !latestConversation ||
            !targetRun ||
            targetRun.status !== 'running' ||
            !targetRun.awaitingBackgroundWorkers
          ) {
            return;
          }

          const {
            liveSnapshots: liveSubAgents,
            mergedSnapshots: reviewableSubAgents,
            hasOrphanedRunningSnapshots,
          } = getReviewableSubAgentsForRun(latestConversation, targetRun);
          if (liveSubAgents.some((snapshot) => snapshot.status === 'running')) {
            return;
          }

          const effectiveSubAgents = hasOrphanedRunningSnapshots
            ? reviewableSubAgents.filter((snapshot) => snapshot.status !== 'running')
            : reviewableSubAgents;
          const planContinuation = evaluateWorkflowPlanContinuation({
            plan: targetRun.plan,
            workers: effectiveSubAgents,
          });
          const candidateOutcome =
            reviewableSubAgents.length === 0
              ? {
                  status: 'failed' as const,
                  summary: 'Background worker state was lost before the run could be finalized.',
                }
              : hasOrphanedRunningSnapshots
                ? {
                    status: 'failed' as const,
                    summary:
                      'Background worker state became orphaned before completion could be confirmed.',
                  }
                : summarizeBackgroundWorkerSnapshots([...effectiveSubAgents]);
            const reviewPerspective =
              planContinuation.status === 'continue'
                ? buildStructuredPlanPilotReviewPerspective(planContinuation)
                : undefined;

          const evidence = collectAgentRunFinalizationEvidence(
            latestConversation.messages,
            targetRun.userMessageId,
            targetRun.summary.startedTools,
            { liveSubAgentSnapshots: effectiveSubAgents },
          );
          const providerContext = resolveConversationFinalizationContextRef.current
            ? await resolveConversationFinalizationContextRef.current(latestConversation)
            : undefined;
          throwIfAbortSignalTriggered(operation.signal);

          const pilotDecision = await evaluateAgentRunWithPilot({
            run: targetRun,
            workers: effectiveSubAgents,
            evidence,
            candidateOutcome: reviewPerspective
              ? {
                  ...candidateOutcome,
                  summary: buildStructuredPlanPilotCandidateOutcomeSummary(
                    candidateOutcome.summary,
                    planContinuation,
                  ),
                }
              : candidateOutcome,
            reviewPerspective,
            providerContext,
            signal: operation.signal,
            onUsage: providerContext
              ? (usage) => {
                  recordConversationUsageEvent({
                    conversationId: params.conversationId,
                    usage,
                    providerId: providerContext.provider.id,
                    source: 'pilot',
                    agentRunId: params.runId,
                    recordSessionUsage: true,
                    emitLog: true,
                  });
                }
              : undefined,
          });
          throwIfAbortSignalTriggered(operation.signal);

          updateAgentRunPilotEvaluation(
            params.conversationId,
            pilotDecision.evaluation,
            params.runId,
          );

          if (pilotDecision.action === 'resume' && pilotDecision.reviewPrompt) {
            const resumeAgentRun = resumeAgentRunRef.current;
            if (resumeAgentRun) {
              const resumableDraftMessageId = findLatestAgentRunAssistantMessageId(
                latestConversation.messages,
                targetRun.userMessageId,
              );
              const resumableDraftMessage = resumableDraftMessageId
                ? latestConversation.messages.find(
                    (candidate) => candidate.id === resumableDraftMessageId,
                  )
                : undefined;

              if (
                resumableDraftMessageId &&
                resumableDraftMessage &&
                isReusableAgentRunAssistantMessage(resumableDraftMessage) &&
                hasVisibleAssistantOutput(resumableDraftMessage) &&
                resumableDraftMessage.assistantMetadata?.completionStatus !== 'incomplete'
              ) {
                updateMessageAssistantMetadata(
                  params.conversationId,
                  resumableDraftMessageId,
                  buildAssistantMessageMetadata('final', {
                    completionStatus: 'incomplete',
                    finishReason: 'pilot_review_pending',
                  }),
                );
              }

              setAgentRunAwaitingBackgroundWorkers(
                params.conversationId,
                false,
                {
                  latestSummary: pilotDecision.checkpointDetail,
                  checkpointTitle: pilotDecision.checkpointTitle,
                  checkpointDetail: pilotDecision.checkpointDetail,
                  timestamp: reviewTimestamp,
                },
                params.runId,
              );
              setAgentRunPhase(
                params.conversationId,
                'pilot',
                {
                  status: 'active',
                  detail: pilotDecision.checkpointDetail,
                  checkpointTitle: PILOT_REVIEW_CHECKPOINT_TITLE,
                  checkpointDetail: pilotDecision.checkpointDetail,
                  timestamp: reviewTimestamp,
                },
                params.runId,
              );
              updateAgentRunSummary(
                params.conversationId,
                {
                  latestSummary: pilotDecision.checkpointDetail,
                  timestamp: reviewTimestamp,
                },
                params.runId,
              );
              appendConversationLog(params.conversationId, {
                kind: 'state',
                level: 'warning',
                title: pilotDecision.checkpointTitle,
                detail: pilotDecision.checkpointDetail,
                timestamp: reviewTimestamp,
              });

              throwIfAbortSignalTriggered(operation.signal);

              await resumeAgentRun({
                conversationId: params.conversationId,
                runId: params.runId,
                additionalSystemPrompt: pilotDecision.reviewPrompt,
                additionalUserPrompt: pilotDecision.reviewUserPrompt,
                disableTools: pilotDecision.disableToolsOnResume,
              });

              throwIfAbortSignalTriggered(operation.signal);
              return;
            }
          }

          const resolvedCheckpointTitle =
            pilotDecision.action === 'resume'
              ? 'Pilot recovery unavailable'
              : pilotDecision.checkpointTitle;
          const resolvedCheckpointDetail =
            pilotDecision.action === 'resume'
              ? `${pilotDecision.checkpointDetail} Supervisor recovery was unavailable, so the run was closed instead of resumed.`
              : pilotDecision.checkpointDetail;
          const latestOutcome =
            pilotDecision.action === 'resume'
              ? {
                  status: 'failed' as const,
                  summary: resolvedCheckpointDetail,
                }
              : pilotDecision.outcome;
          let latestSummary = latestOutcome.summary;

          if (
            !hasDeliveredFinalAssistantResponse(
              latestConversation.messages,
              targetRun.userMessageId,
            )
          ) {
            const preferredAssistantMessageId =
              latestOutcome.status === 'completed' && pilotDecision.evaluation.approved
                ? findLatestPreferredAgentRunAssistantMessageId(
                    latestConversation.messages,
                    targetRun.userMessageId,
                  )
                : undefined;
            const finalResponsePreview = await ensureAgentRunFinalResponseRef.current?.({
              conversationId: params.conversationId,
              runId: params.runId,
              status: latestOutcome.status,
              preferredAssistantMessageId,
              timestamp: reviewTimestamp,
              signal: operation.signal,
            });

            throwIfAbortSignalTriggered(operation.signal);

            if (finalResponsePreview) {
              latestSummary = finalResponsePreview;
            }
          }

          const latestRunState = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId)
            ?.agentRuns?.find((candidate) => candidate.id === params.runId);
          if (
            !latestRunState ||
            latestRunState.status !== 'running' ||
            !latestRunState.awaitingBackgroundWorkers
          ) {
            return;
          }

          completeAgentRun(
            params.conversationId,
            {
              status: latestOutcome.status,
              latestSummary,
              checkpointTitle: resolvedCheckpointTitle,
              checkpointDetail: resolvedCheckpointDetail,
              summary: {
                durationMs: Math.max(0, reviewTimestamp - targetRun.createdAt),
              },
              timestamp: reviewTimestamp,
            },
            params.runId,
          );
          appendConversationLog(params.conversationId, {
            kind: 'state',
            level:
              latestOutcome.status === 'completed'
                ? 'success'
                : latestOutcome.status === 'cancelled'
                  ? 'warning'
                  : 'error',
            title: resolvedCheckpointTitle,
            detail: resolvedCheckpointDetail,
            timestamp: reviewTimestamp,
          });
        } catch (error) {
          if (isAbortErrorLike(error, operation.signal)) {
            return;
          }

          throw error;
        } finally {
          operation.dispose();
          pendingAgentRunPilotResumesRef.current.delete(params.runId);
        }
      })();

      pendingAgentRunPilotResumesRef.current.set(params.runId, reviewPromise);
      return reviewPromise;
    },
    [
      appendConversationLog,
      completeAgentRun,
      setAgentRunAwaitingBackgroundWorkers,
      setAgentRunPhase,
      updateAgentRunSummary,
      updateAgentRunPilotEvaluation,
      updateMessageAssistantMetadata,
    ],
  );

  const queueRecoveredAsyncRunResume = useCallback(
    (params: {
      conversationId: string;
      runId: string;
      pendingOperations: AgentRunAsyncOperation[];
      timestamp?: number;
    }): Promise<void> => {
      const inFlight = pendingAgentRunAsyncResumesRef.current.get(params.runId);
      if (inFlight) {
        return inFlight;
      }

      const resumePromise = (async () => {
        const operation = createAgentRunOperationController({
          conversationId: params.conversationId,
          runId: params.runId,
          operationId: 'async-resume',
        });

        try {
          throwIfAbortSignalTriggered(operation.signal);

          const latestConversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId);
          const targetRun = latestConversation?.agentRuns?.find(
            (candidate) => candidate.id === params.runId,
          );
          const effectivePendingOperations = targetRun?.pendingAsyncOperations?.length
            ? targetRun.pendingAsyncOperations
            : params.pendingOperations;
          if (
            !latestConversation ||
            !targetRun ||
            targetRun.status !== 'running' ||
            targetRun.awaitingBackgroundWorkers ||
            effectivePendingOperations.length === 0
          ) {
            return;
          }

          const resumeAgentRun = resumeAgentRunRef.current;
          if (!resumeAgentRun) {
            return;
          }

          const resumeTimestamp = params.timestamp ?? Date.now();
          const summary =
            buildPendingAsyncOperationSummary(effectivePendingOperations) ||
            'Resuming asynchronous workflow monitoring.';
          setAgentRunPhase(
            params.conversationId,
            'review',
            {
              status: 'active',
              detail: summary,
              checkpointTitle: 'Recovered async workflow monitoring',
              checkpointDetail: summary,
              timestamp: resumeTimestamp,
            },
            params.runId,
          );
          updateAgentRunSummary(
            params.conversationId,
            {
              latestSummary: summary,
              timestamp: resumeTimestamp,
            },
            params.runId,
          );
          appendConversationLog(params.conversationId, {
            kind: 'state',
            level: 'warning',
            title: 'Recovered async workflow monitoring',
            detail: summary,
            timestamp: resumeTimestamp,
          });

          throwIfAbortSignalTriggered(operation.signal);

          await resumeAgentRun({
            conversationId: params.conversationId,
            runId: params.runId,
            additionalSystemPrompt: buildPendingAsyncOperationResumePrompt(
              effectivePendingOperations,
            ),
            initialPendingAsyncOperations: effectivePendingOperations,
          });
        } catch (error) {
          if (isAbortErrorLike(error, operation.signal)) {
            return;
          }

          throw error;
        } finally {
          operation.dispose();
          pendingAgentRunAsyncResumesRef.current.delete(params.runId);
        }
      })();

      pendingAgentRunAsyncResumesRef.current.set(params.runId, resumePromise);
      return resumePromise;
    },
    [appendConversationLog, setAgentRunPhase, updateAgentRunSummary],
  );

  const supportsVision = useMemo(
    () => activeProvider?.modelCapabilities?.[currentModel]?.vision ?? false,
    [activeProvider, currentModel],
  );

  const activeComposerDraftKey = useMemo(
    () => getComposerDraftKey(activeConversationId),
    [activeConversationId],
  );

  const activeComposerDraft = useMemo(
    () => normalizeComposerDraftState(composerDrafts[activeComposerDraftKey]),
    [activeComposerDraftKey, composerDrafts],
  );

  const updateComposerDraft = useCallback((draftKey: string, nextDraft: ComposerDraftState) => {
    setComposerDrafts((currentDrafts) => {
      const normalizedDraft = normalizeComposerDraftState(nextDraft);
      if (isComposerDraftStateEmpty(normalizedDraft)) {
        if (!(draftKey in currentDrafts)) {
          return currentDrafts;
        }

        const remainingDrafts = { ...currentDrafts };
        delete remainingDrafts[draftKey];
        return remainingDrafts;
      }

      return {
        ...currentDrafts,
        [draftKey]: normalizedDraft,
      };
    });
  }, []);

  const clearComposerDraft = useCallback((draftKey: string) => {
    setComposerDrafts((currentDrafts) => {
      if (!(draftKey in currentDrafts)) {
        return currentDrafts;
      }

      const remainingDrafts = { ...currentDrafts };
      delete remainingDrafts[draftKey];
      return remainingDrafts;
    });
  }, []);

  const handleComposerTextChange = useCallback(
    (value: string) => {
      if (editingMessageId) {
        setEditingContent(value);
        return;
      }

      updateComposerDraft(activeComposerDraftKey, {
        text: value,
        attachments: activeComposerDraft.attachments,
      });
    },
    [
      activeComposerDraft.attachments,
      activeComposerDraftKey,
      editingMessageId,
      updateComposerDraft,
    ],
  );

  const handleComposerAttachmentsChange = useCallback(
    (attachments: Attachment[]) => {
      if (editingMessageId) {
        return;
      }

      updateComposerDraft(activeComposerDraftKey, {
        text: activeComposerDraft.text,
        attachments,
      });
    },
    [activeComposerDraft.text, activeComposerDraftKey, editingMessageId, updateComposerDraft],
  );

  const composerText = editingMessageId ? (editingContent ?? '') : activeComposerDraft.text;
  const composerAttachments = editingMessageId ? [] : activeComposerDraft.attachments;

  const updateAutoFollowState = useCallback(() => {
    const { contentHeight, layoutHeight, offsetY } = listMetricsRef.current;
    if (layoutHeight <= 0) {
      shouldAutoFollowRef.current = true;
      return;
    }

    const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
    shouldAutoFollowRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const clearPendingScrollFrames = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }

    if (scrollFollowUpFrameRef.current !== null) {
      cancelAnimationFrame(scrollFollowUpFrameRef.current);
      scrollFollowUpFrameRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      clearPendingScrollFrames();

      // Use requestAnimationFrame to ensure layout is committed before scrolling.
      // Double-rAF provides more reliable results during rapid content changes.
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        scrollFollowUpFrameRef.current = requestAnimationFrame(() => {
          scrollFollowUpFrameRef.current = null;
          flatListRef.current?.scrollToEnd({ animated });
        });
      });
    },
    [clearPendingScrollFrames],
  );

  const clearInteractionReleaseTimer = useCallback(() => {
    if (!interactionReleaseTimerRef.current) {
      return;
    }

    clearTimeout(interactionReleaseTimerRef.current);
    interactionReleaseTimerRef.current = null;
  }, []);

  const clearSubAgentProgressFlushTimer = useCallback(() => {
    if (!subAgentProgressFlushTimerRef.current) {
      return;
    }

    clearTimeout(subAgentProgressFlushTimerRef.current);
    subAgentProgressFlushTimerRef.current = null;
  }, []);

  const flushPendingSubAgentProgress = useCallback(() => {
    clearSubAgentProgressFlushTimer();

    const pendingSnapshots = pendingSubAgentProgressRef.current;
    const pendingRunProgress = pendingAgentRunProgressRef.current;
    const hadSnapshotUpdates = pendingSnapshots.size > 0;
    if (pendingSnapshots.size === 0 && pendingRunProgress.size === 0) {
      return;
    }

    const selectedSnapshot =
      hadSnapshotUpdates && selectedSubAgentSessionIdRef.current
        ? pendingSnapshots.get(selectedSubAgentSessionIdRef.current)
        : undefined;
    const runProgressUpdates = Array.from(pendingRunProgress.values());
    pendingSnapshots.clear();
    pendingRunProgress.clear();

    for (const update of runProgressUpdates) {
      setAgentRunPhase(
        update.conversationId,
        'work',
        {
          status: 'active',
          detail: update.detail,
          timestamp: update.timestamp,
          allowRegression: true,
        },
        update.runId,
      );
      updateAgentRunSummary(
        update.conversationId,
        {
          latestSummary: update.detail,
          timestamp: update.timestamp,
        },
        update.runId,
      );
    }

    if (selectedSnapshot) {
      setSubAgentActivityVersion((value) => value + 1);
      setSelectedSubAgentSnapshot({ ...selectedSnapshot });
    } else if (hadSnapshotUpdates) {
      setSubAgentActivityVersion((value) => value + 1);
    }
  }, [clearSubAgentProgressFlushTimer, setAgentRunPhase, updateAgentRunSummary]);

  const scheduleSubAgentProgressFlush = useCallback(() => {
    if (subAgentProgressFlushTimerRef.current) {
      return;
    }

    subAgentProgressFlushTimerRef.current = setTimeout(() => {
      flushPendingSubAgentProgress();
    }, SUB_AGENT_PROGRESS_REFRESH_INTERVAL_MS);
    (subAgentProgressFlushTimerRef.current as any)?.unref?.();
  }, [flushPendingSubAgentProgress]);

  const queueAgentRunProgressUpdate = useCallback(
    (update: PendingAgentRunProgressUpdate) => {
      const key = buildAgentRunProgressKey(update.conversationId, update.runId);
      const existing = pendingAgentRunProgressRef.current.get(key);
      if (existing && existing.detail === update.detail) {
        return;
      }

      pendingAgentRunProgressRef.current.set(key, update);
      scheduleSubAgentProgressFlush();
    },
    [scheduleSubAgentProgressFlush],
  );

  const discardPendingAgentRunProgress = useCallback((conversationId: string, runId?: string) => {
    if (!runId) {
      return;
    }

    pendingAgentRunProgressRef.current.delete(buildAgentRunProgressKey(conversationId, runId));
  }, []);

  const scheduleSubAgentProgressRefresh = useCallback(
    (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => {
      pendingSubAgentProgressRef.current.set(snapshot.sessionId, { ...snapshot });
      scheduleSubAgentProgressFlush();
    },
    [scheduleSubAgentProgressFlush],
  );

  const maybeScrollToBottom = useCallback(
    (animated: boolean) => {
      if (isUserInteractingRef.current) {
        return;
      }

      if (!forceNextScrollRef.current && !shouldAutoFollowRef.current) {
        return;
      }

      scrollToBottom(animated);
      forceNextScrollRef.current = false;
    },
    [scrollToBottom],
  );

  const handleUserScrollStart = useCallback(() => {
    clearInteractionReleaseTimer();
    isUserInteractingRef.current = true;
    forceNextScrollRef.current = false;
    // Don't reset shouldAutoFollowRef here — let the scroll position
    // at onScrollEndDrag/onMomentumScrollEnd determine auto-follow.
  }, [clearInteractionReleaseTimer]);

  const handleUserScrollEnd = useCallback(() => {
    clearInteractionReleaseTimer();
    isUserInteractingRef.current = false;
    updateAutoFollowState();

    if (shouldAutoFollowRef.current) {
      maybeScrollToBottom(false);
    }
  }, [clearInteractionReleaseTimer, maybeScrollToBottom, updateAutoFollowState]);

  useEffect(() => {
    selectedSubAgentSessionIdRef.current = selectedSubAgentSnapshot?.sessionId ?? null;
  }, [selectedSubAgentSnapshot]);

  // Clear error when switching conversations
  useEffect(() => {
    setChatError(null);
    setShowLogs(false);
    setSelectedSubAgentSnapshot(null);
    previousVisibleCountRef.current = 0;
    listMetricsRef.current = { contentHeight: 0, layoutHeight: 0, offsetY: 0 };
    shouldAutoFollowRef.current = true;
    forceNextScrollRef.current = true;
    isUserInteractingRef.current = false;
    lastLoggedStateRef.current = null;
    clearChatDisplayStateCache(displayStateCacheRef.current);
    clearInteractionReleaseTimer();
    clearPendingScrollFrames();
    pendingSubAgentProgressRef.current.clear();
    selectedSubAgentSessionIdRef.current = null;
    setEditingMessageId(null);
    setEditingContent(undefined);
    setStreamingDraftVersion(0);
    setSubAgentActivityVersion(0);
  }, [activeConversationId, clearInteractionReleaseTimer, clearPendingScrollFrames]);

  useEffect(
    () => () => {
      streamingDraftsRef.current = {};
      streamingDraftSignaturesRef.current = {};
      clearChatDisplayStateCache(displayStateCacheRef.current);
      clearInteractionReleaseTimer();
      clearSubAgentProgressFlushTimer();
      clearPendingScrollFrames();
      pendingSubAgentProgressRef.current.clear();
      pendingAgentRunProgressRef.current.clear();
      pendingAgentRunFinalizationsRef.current.clear();
      pendingAgentRunPilotResumesRef.current.clear();
      pendingAgentRunAsyncResumesRef.current.clear();
    },
    [clearInteractionReleaseTimer, clearPendingScrollFrames, clearSubAgentProgressFlushTimer],
  );

  useEffect(() => {
    return onSubAgentEvent((agent, event) => {
      const registrySnapshots = listActiveSubAgents();
      const resolvedOwnerConversationId = resolveOwningConversationId(
        agent.sessionId,
        registrySnapshots,
      );
      const ownerConversationId =
        resolvedOwnerConversationId && resolvedOwnerConversationId !== agent.sessionId
          ? resolvedOwnerConversationId
          : agent.parentConversationId;
      const state = useChatStore.getState();
      const conversation = state.conversations.find(
        (candidate) => candidate.id === ownerConversationId,
      );
      if (!conversation) {
        return;
      }

      const targetAgentRunId = resolveAgentRunIdForSubAgent(conversation, agent);

      const shouldRefreshLiveSnapshots =
        ownerConversationId === activeConversationId ||
        selectedSubAgentSessionIdRef.current === agent.sessionId;

      if (event === 'progress') {
        const progressDetail = truncateLogDetail(
          agent.currentActivity || agent.activeToolName || 'Worker still running',
        );
        if (progressDetail && targetAgentRunId) {
          queueAgentRunProgressUpdate({
            conversationId: ownerConversationId,
            runId: targetAgentRunId,
            detail: progressDetail,
            timestamp: agent.updatedAt,
          });
        }

        if (shouldRefreshLiveSnapshots) {
          scheduleSubAgentProgressRefresh(agent);
        }
        return;
      }

      discardPendingAgentRunProgress(ownerConversationId, targetAgentRunId);
      const lifecycleMessage = buildSubAgentLifecycleMessage(agent, event);
      const lifecycleSummary = truncateLogDetail(lifecycleMessage);
      const lifecyclePhase = getAgentRunPhaseForSubAgentEvent(event);

      if (targetAgentRunId) {
        const automaticEvidenceEntries = buildAutomaticSubAgentEvidenceEntries(agent, event);
        if (automaticEvidenceEntries.length > 0) {
          state.recordAgentRunEvidence(
            ownerConversationId,
            automaticEvidenceEntries,
            { timestamp: event === 'started' ? agent.startedAt : agent.updatedAt },
            targetAgentRunId,
          );
        }

        setAgentRunPhase(
          ownerConversationId,
          lifecyclePhase,
          {
            status: 'active',
            detail: lifecycleSummary,
            checkpointTitle:
              event === 'started'
                ? `Worker started: ${agent.name || agent.sessionId}`
                : event === 'completed'
                  ? `Worker completed: ${agent.name || agent.sessionId}`
                  : event === 'timeout'
                    ? `Worker timed out: ${agent.name || agent.sessionId}`
                    : event === 'cancelled'
                      ? `Worker cancelled: ${agent.name || agent.sessionId}`
                      : `Worker failed: ${agent.name || agent.sessionId}`,
            checkpointDetail: lifecycleSummary,
            checkpointKind: 'sub-agent',
            timestamp: event === 'started' ? agent.startedAt : agent.updatedAt,
            allowRegression: lifecyclePhase === 'work',
          },
          targetAgentRunId,
        );
        updateAgentRunSummary(
          ownerConversationId,
          {
            latestSummary: lifecycleSummary,
            timestamp: event === 'started' ? agent.startedAt : agent.updatedAt,
          },
          targetAgentRunId,
        );
      }

      pendingSubAgentProgressRef.current.delete(agent.sessionId);
      if (
        pendingSubAgentProgressRef.current.size === 0 &&
        pendingAgentRunProgressRef.current.size === 0
      ) {
        clearSubAgentProgressFlushTimer();
      }

      if (shouldRefreshLiveSnapshots) {
        if (ownerConversationId === activeConversationId) {
          forceNextScrollRef.current = shouldAutoFollowRef.current;
        }
        setSubAgentActivityVersion((value) => value + 1);
        setSelectedSubAgentSnapshot((current) =>
          current?.sessionId === agent.sessionId ? { ...agent } : current,
        );
      }

      if (event === 'started') {
        addMessage(ownerConversationId, {
          id: generateId(),
          role: 'assistant',
          content: lifecycleMessage,
          attachments: agent.artifacts?.length
            ? agent.artifacts.map((attachment) => ({ ...attachment }))
            : undefined,
          subAgentEvent: {
            type: 'sub-agent',
            event,
            snapshot: { ...agent },
          },
        });
        appendConversationLog(ownerConversationId, {
          kind: 'system',
          level: 'info',
          title: `Sub-agent ${agent.name || agent.sessionId} spawned`,
          detail: `Depth ${agent.depth}, sandbox: ${agent.sandboxPolicy}`,
          timestamp: agent.startedAt,
        });
        return;
      }

      addMessage(ownerConversationId, {
        id: generateId(),
        role: 'assistant',
        content: lifecycleMessage,
        attachments: agent.artifacts?.length
          ? agent.artifacts.map((attachment) => ({ ...attachment }))
          : undefined,
        isError: event === 'error' || event === 'cancelled',
        subAgentEvent: {
          type: 'sub-agent',
          event,
          snapshot: { ...agent },
        },
      });
      appendConversationLog(ownerConversationId, {
        kind: 'system',
        level:
          event === 'completed'
            ? 'success'
            : event === 'cancelled' || event === 'timeout'
              ? 'warning'
              : 'error',
        title:
          event === 'completed'
            ? `Sub-agent ${agent.name || agent.sessionId} completed`
            : event === 'timeout'
              ? `Sub-agent ${agent.name || agent.sessionId} timed out`
              : event === 'cancelled'
                ? `Sub-agent ${agent.name || agent.sessionId} cancelled`
                : `Sub-agent ${agent.name || agent.sessionId} failed`,
        detail: lifecycleMessage,
        timestamp: agent.updatedAt,
      });

      if (!targetAgentRunId) {
        return;
      }

      const latestConversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === ownerConversationId);
      if (!latestConversation) {
        return;
      }

      const targetRun = latestConversation?.agentRuns?.find((run) => run.id === targetAgentRunId);
      if (!targetRun?.awaitingBackgroundWorkers || targetRun.status !== 'running') {
        return;
      }

      const liveSubAgents = getLiveSubAgentsForRun(latestConversation, targetAgentRunId);
      if (liveSubAgents.some((snapshot) => snapshot.status === 'running')) {
        return;
      }

      void queueTerminalBackgroundReview({
        conversationId: ownerConversationId,
        runId: targetAgentRunId,
        timestamp: agent.updatedAt,
      });
    });
  }, [
    activeConversationId,
    addMessage,
    appendConversationLog,
    clearSubAgentProgressFlushTimer,
    discardPendingAgentRunProgress,
    queueAgentRunProgressUpdate,
    queueTerminalBackgroundReview,
    scheduleSubAgentProgressRefresh,
    setAgentRunPhase,
    updateAgentRunSummary,
  ]);

  const liveSubAgentSnapshotState = useMemo(() => {
    const snapshots: NonNullable<Message['subAgentEvent']>['snapshot'][] = activeConversationId
      ? getSubAgentsForConversation(activeConversationId, listActiveSubAgents())
      : [];

    return {
      activityVersion: subAgentActivityVersion,
      snapshots,
    };
  }, [activeConversationId, subAgentActivityVersion]);

  const liveSubAgentSnapshotsById = useMemo(() => {
    return new Map(
      liveSubAgentSnapshotState.snapshots.map((snapshot) => [snapshot.sessionId, snapshot]),
    );
  }, [liveSubAgentSnapshotState]);

  const updateStreamingDraft = useCallback(
    (
      messageId: string,
      updater: (currentDraft: StreamingDraft | undefined) => StreamingDraft | undefined,
    ) => {
      const currentDraft = streamingDraftsRef.current[messageId];
      const nextDraft = normalizeStreamingDraft(updater(currentDraft));
      const currentSignature =
        streamingDraftSignaturesRef.current[messageId] ??
        buildStreamingDraftSignature(currentDraft);
      const nextSignature = buildStreamingDraftSignature(nextDraft);
      if (currentSignature === nextSignature) {
        return;
      }

      const nextDrafts = { ...streamingDraftsRef.current };
      const nextSignatures = { ...streamingDraftSignaturesRef.current };
      if (nextDraft) {
        nextDrafts[messageId] = nextDraft;
        nextSignatures[messageId] = nextSignature;
      } else {
        delete nextDrafts[messageId];
        delete nextSignatures[messageId];
      }

      streamingDraftsRef.current = nextDrafts;
      streamingDraftSignaturesRef.current = nextSignatures;
      setStreamingDraftVersion((value) => value + 1);
    },
    [],
  );

  const mergeStreamingDraft = useCallback(
    (messageId: string, patch: Partial<StreamingDraft>) => {
      updateStreamingDraft(messageId, (currentDraft) => ({
        ...(currentDraft ?? {}),
        ...patch,
      }));
    },
    [updateStreamingDraft],
  );

  const clearStreamingDraft = useCallback(
    (messageId: string) => {
      if (!streamingDraftsRef.current[messageId]) return;
      updateStreamingDraft(messageId, () => undefined);
    },
    [updateStreamingDraft],
  );

  const resolveConversationStartDefaults = useCallback(
    () => resolveConversationStartSelection(providers, activeProviderId, activeModel),
    [activeModel, activeProviderId, providers],
  );

  const resolveConversationFinalizationContext = useCallback(
    async (
      conversation: Conversation,
    ): Promise<ResolvedFinalizationProviderContext | undefined> => {
      const providerTemplate = resolveEnabledProvider(
        providers,
        conversation.providerId || activeProviderId,
      );
      const providerId = providerTemplate?.id || '';
      const model = resolveConversationModel(providerTemplate, {
        conversationModel: conversation.modelOverride,
        activeProviderId,
        activeModel,
      });

      if (!providerId || !providerTemplate || !model) {
        return undefined;
      }

      const apiKey = await resolveProviderApiKey(providerTemplate);
      if (providerRequiresApiKey(providerTemplate) && !apiKey) {
        return undefined;
      }

      return {
        provider: {
          ...providerTemplate,
          apiKey,
        },
        model,
        systemPromptText: conversation.systemPrompt || systemPrompt,
        conversationId: conversation.id,
      };
    },
    [activeModel, activeProviderId, providers, systemPrompt],
  );
  resolveConversationFinalizationContextRef.current = resolveConversationFinalizationContext;

  useEffect(() => {
    resolveConversationFinalizationContextRef.current = resolveConversationFinalizationContext;

    return () => {
      resolveConversationFinalizationContextRef.current = null;
    };
  }, [resolveConversationFinalizationContext]);

  const synthesizeAgentRunCompletion = useCallback(
    async (params: {
      conversationId: string;
      run: AgentRun;
      status: Exclude<AgentRun['status'], 'running'>;
      providerContext?: ResolvedFinalizationProviderContext;
      signal?: AbortSignal;
    }): Promise<{
      output?: string;
      providerReplay?: Message['providerReplay'];
      source: 'synthesized' | 'fallback' | 'none';
    }> => {
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === params.conversationId);

      if (!conversation) {
        return {
          output: buildMissingFinalResponseFallback(params.status),
          source: 'fallback',
        };
      }

      throwIfAbortSignalTriggered(params.signal);

      const liveSubAgentSnapshots = getLiveSubAgentsForRun(conversation, params.run.id);
      const evidence = collectAgentRunFinalizationEvidence(
        conversation.messages,
        params.run.userMessageId,
        params.run.summary.startedTools,
        { liveSubAgentSnapshots },
      );
      const fallbackOutput =
        buildAgentRunToolResultFallback({
          status: params.status,
          evidence,
        }) || buildMissingFinalResponseFallback(params.status);

      if (params.status !== 'completed') {
        return {
          output: fallbackOutput,
          source: 'fallback',
        };
      }

      const providerContext =
        params.providerContext ?? (await resolveConversationFinalizationContext(conversation));
      const canSynthesize =
        !evidence.hasIncompleteToolCalls &&
        (hasVerifiedFinalizationEvidence(evidence) ||
          evidence.lastNonEmptyAssistantContent.trim().length > 0);
      if (!providerContext || !canSynthesize) {
        return {
          output: fallbackOutput,
          source: fallbackOutput ? 'fallback' : 'none',
        };
      }

      throwIfAbortSignalTriggered(params.signal);

      const synthesized = await synthesizeAgentRunFinalAnswer({
        provider: providerContext.provider,
        model: providerContext.model,
        systemPrompt: providerContext.systemPromptText,
        evidence,
        signal: params.signal,
      });

      throwIfAbortSignalTriggered(params.signal);

      const synthesizedOutput = synthesized.output?.trim();
      if (synthesizedOutput) {
        return {
          output: synthesizedOutput,
          providerReplay: synthesized.providerReplay,
          source: 'synthesized',
        };
      }

      return {
        output: fallbackOutput,
        source: fallbackOutput ? 'fallback' : 'none',
      };
    },
    [resolveConversationFinalizationContext],
  );

  const ensureAgentRunFinalResponse = useCallback(
    async (params: {
      conversationId: string;
      runId: string;
      status: Exclude<AgentRun['status'], 'running'>;
      providerContext?: ResolvedFinalizationProviderContext;
      timestamp?: number;
      preferredAssistantMessageId?: string;
      signal?: AbortSignal;
    }): Promise<string | undefined> => {
      const inFlightFinalization = pendingAgentRunFinalizationsRef.current.get(params.runId);
      if (inFlightFinalization) {
        return inFlightFinalization;
      }

      const finalizationPromise = (async () => {
        const operation = createAgentRunOperationController({
          conversationId: params.conversationId,
          runId: params.runId,
          operationId: 'final-response',
          parentSignal: params.signal,
        });

        try {
          throwIfAbortSignalTriggered(operation.signal);

          const conversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId);
          const run = conversation?.agentRuns?.find((candidate) => candidate.id === params.runId);
          if (!conversation || !run) {
            return undefined;
          }

          const existingPreview = getLatestFinalAssistantResponsePreview(
            conversation.messages,
            run.userMessageId,
          );
          if (hasDeliveredFinalAssistantResponse(conversation.messages, run.userMessageId)) {
            return existingPreview;
          }

          const preferredAssistantMessageId = params.preferredAssistantMessageId?.trim();
          if (preferredAssistantMessageId) {
            const preferredAssistantMessage = conversation.messages.find(
              (message) => message.id === preferredAssistantMessageId,
            );
            const preferredContent =
              preferredAssistantMessage?.role === 'assistant' &&
              !preferredAssistantMessage.subAgentEvent &&
              (preferredAssistantMessage.toolCalls?.length ?? 0) === 0 &&
              !isAssistantFinalResponsePlaceholder(preferredAssistantMessage)
                ? preferredAssistantMessage.content.trim()
                : '';

            if (preferredContent) {
              throwIfAbortSignalTriggered(operation.signal);

              updateMessageAssistantMetadata(
                params.conversationId,
                preferredAssistantMessageId,
                buildAssistantMessageMetadata('final', {
                  completionStatus: 'complete',
                  finishReason: 'pilot_approved',
                }),
              );

              const preview = truncateLogDetail(preferredContent) || preferredContent;
              const deliveredTimestamp = Date.now();
              appendAgentRunCheckpoint(
                params.conversationId,
                {
                  kind: 'run',
                  title: FINAL_RESPONSE_CHECKPOINT_TITLE,
                  detail: preview,
                  timestamp: deliveredTimestamp,
                },
                params.runId,
              );
              updateAgentRunSummary(
                params.conversationId,
                {
                  latestSummary: preview,
                  timestamp: deliveredTimestamp,
                },
                params.runId,
              );
              appendConversationLog(params.conversationId, {
                kind: 'state',
                level:
                  params.status === 'completed'
                    ? 'success'
                    : params.status === 'cancelled'
                      ? 'warning'
                      : 'error',
                title: FINAL_RESPONSE_CHECKPOINT_TITLE,
                detail: preview,
                timestamp: deliveredTimestamp,
              });

              return preview;
            }
          }

          const synthesisTimestamp = params.timestamp ?? Date.now();
          const shouldTrackSynthesisProgress = run.status === 'running';
          if (shouldTrackSynthesisProgress) {
            throwIfAbortSignalTriggered(operation.signal);

            setAgentRunPhase(
              params.conversationId,
              'deliver',
              {
                status: 'active',
                detail: FINAL_RESPONSE_SYNTHESIS_DETAIL,
                checkpointTitle: FINAL_RESPONSE_SYNTHESIS_TITLE,
                checkpointDetail: FINAL_RESPONSE_SYNTHESIS_DETAIL,
                timestamp: synthesisTimestamp,
              },
              params.runId,
            );
            updateAgentRunSummary(
              params.conversationId,
              {
                latestSummary: FINAL_RESPONSE_SYNTHESIS_DETAIL,
                timestamp: synthesisTimestamp,
              },
              params.runId,
            );
            appendConversationLog(params.conversationId, {
              kind: 'state',
              level: 'info',
              title: FINAL_RESPONSE_SYNTHESIS_TITLE,
              detail: FINAL_RESPONSE_SYNTHESIS_DETAIL,
              timestamp: synthesisTimestamp,
            });
          }

          const synthesized = await synthesizeAgentRunCompletion({
            conversationId: params.conversationId,
            run,
            status: params.status,
            providerContext: params.providerContext,
            signal: operation.signal,
          });

          throwIfAbortSignalTriggered(operation.signal);

          const output = synthesized.output?.trim();
          if (!output) {
            return undefined;
          }

          const latestConversation = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === params.conversationId);
          const targetMessageId = latestConversation
            ? findAgentRunReplaceableAssistantMessageId(
                latestConversation.messages,
                run.userMessageId,
              )
            : undefined;
          const incompleteVisibleDraft = latestConversation
            ? findLatestIncompleteAgentRunAssistantMessage(latestConversation.messages, run.userMessageId)
            : undefined;
          const shouldPreserveIncompleteVisibleDraft =
            synthesized.source === 'fallback' &&
            params.status !== 'completed' &&
            !!incompleteVisibleDraft?.content.trim();
          const finalOutput = shouldPreserveIncompleteVisibleDraft
            ? buildAgentRunVisibleDraftRecoveryText({
                status: params.status,
                visibleDraft: incompleteVisibleDraft?.content ?? '',
                evidence: collectAgentRunFinalizationEvidence(
                  latestConversation?.messages ?? conversation.messages,
                  run.userMessageId,
                  run.summary.startedTools,
                  {
                    liveSubAgentSnapshots: getLiveSubAgentsForRun(
                      latestConversation ?? conversation,
                      run.id,
                    ),
                  },
                ),
              })
            : output;
          const finalAssistantMetadata = buildAssistantMessageMetadata('final', {
            completionStatus: 'complete',
            finishReason:
              synthesized.source === 'synthesized'
                ? 'synthesized_from_evidence'
                : 'fallback_from_evidence',
          });

          throwIfAbortSignalTriggered(operation.signal);

          const writeTargetMessageId = shouldPreserveIncompleteVisibleDraft
            ? incompleteVisibleDraft?.id ?? targetMessageId
            : targetMessageId;

          if (writeTargetMessageId) {
            updateMessage(params.conversationId, writeTargetMessageId, finalOutput);
            updateMessageAssistantMetadata(
              params.conversationId,
              writeTargetMessageId,
              finalAssistantMetadata,
            );
            if (synthesized.source === 'synthesized' && synthesized.providerReplay) {
              updateMessageProviderReplay(
                params.conversationId,
                writeTargetMessageId,
                synthesized.providerReplay,
              );
            } else {
              updateMessageProviderReplay(
                params.conversationId,
                writeTargetMessageId,
                undefined,
              );
            }
          } else {
            addMessage(params.conversationId, {
              id: generateId(),
              role: 'assistant',
              content: finalOutput,
              providerReplay:
                synthesized.source === 'synthesized' ? synthesized.providerReplay : undefined,
              assistantMetadata: finalAssistantMetadata,
            });
          }

          const preview = truncateLogDetail(finalOutput) || finalOutput;
          const deliveredTimestamp = Date.now();
          appendAgentRunCheckpoint(
            params.conversationId,
            {
              kind: 'run',
              title: FINAL_RESPONSE_CHECKPOINT_TITLE,
              detail: preview,
              timestamp: deliveredTimestamp,
            },
            params.runId,
          );
          updateAgentRunSummary(
            params.conversationId,
            {
              latestSummary: preview,
              timestamp: deliveredTimestamp,
            },
            params.runId,
          );
          appendConversationLog(params.conversationId, {
            kind: 'state',
            level:
              params.status === 'completed'
                ? 'success'
                : params.status === 'cancelled'
                  ? 'warning'
                  : 'error',
            title: FINAL_RESPONSE_CHECKPOINT_TITLE,
            detail: preview,
            timestamp: deliveredTimestamp,
          });

          return preview;
        } finally {
          operation.dispose();
          pendingAgentRunFinalizationsRef.current.delete(params.runId);
        }
      })();

      pendingAgentRunFinalizationsRef.current.set(params.runId, finalizationPromise);
      return finalizationPromise;
    },
    [
      addMessage,
      appendAgentRunCheckpoint,
      appendConversationLog,
      setAgentRunPhase,
      synthesizeAgentRunCompletion,
      updateAgentRunSummary,
      updateMessage,
      updateMessageAssistantMetadata,
      updateMessageProviderReplay,
    ],
  );

  ensureAgentRunFinalResponseRef.current = ensureAgentRunFinalResponse;

  useEffect(() => {
    ensureAgentRunFinalResponseRef.current = ensureAgentRunFinalResponse;
  }, [ensureAgentRunFinalResponse]);

  useEffect(() => {
    for (const conversation of conversations) {
      const awaitingRuns = (conversation.agentRuns ?? []).filter(
        (run) => run.status === 'running' && run.awaitingBackgroundWorkers,
      );
      if (!awaitingRuns.length) {
        continue;
      }

      for (const run of awaitingRuns) {
        const { liveSnapshots, mergedSnapshots } = getReviewableSubAgentsForRun(
          conversation,
          run,
        );
        if (liveSnapshots.some((agent) => agent.status === 'running')) {
          continue;
        }

        const reviewTimestamp = mergedSnapshots.reduce(
          (latestTimestamp, agent) => Math.max(latestTimestamp, agent.updatedAt),
          run.updatedAt,
        );
        void queueTerminalBackgroundReview({
          conversationId: conversation.id,
          runId: run.id,
          timestamp: reviewTimestamp,
        });
      }
    }
  }, [conversations, queueTerminalBackgroundReview, subAgentActivityVersion]);

  useEffect(() => {
    if (isLoading || abortRef.current) {
      return;
    }

    for (const conversation of conversations) {
      const resumableRuns = (conversation.agentRuns ?? []).filter(
        (run) =>
          run.status === 'running' &&
          !run.awaitingBackgroundWorkers &&
          (run.pendingAsyncOperations?.length ?? 0) > 0,
      );
      if (!resumableRuns.length) {
        continue;
      }

      for (const run of resumableRuns) {
        void queueRecoveredAsyncRunResume({
          conversationId: conversation.id,
          runId: run.id,
          pendingOperations: run.pendingAsyncOperations ?? [],
          timestamp: run.updatedAt,
        });
        return;
      }
    }
  }, [conversations, isLoading, queueRecoveredAsyncRunResume]);

  useEffect(() => {
    const terminalConversations = conversations
      .map((conversation) => ({
        conversation,
        runs: (conversation.agentRuns ?? []).filter(
          (run): run is AgentRun & { status: Exclude<AgentRun['status'], 'running'> } =>
            run.status !== 'running' &&
            !hasDeliveredFinalAssistantResponse(conversation.messages, run.userMessageId),
        ),
      }))
      .filter((entry) => entry.runs.length > 0);
    if (!terminalConversations.length) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const { conversation, runs } of terminalConversations) {
        const providerContext = await resolveConversationFinalizationContext(conversation);
        if (cancelled) {
          return;
        }

        for (const run of runs) {
          const evidence = collectAgentRunFinalizationEvidence(
            conversation.messages,
            run.userMessageId,
            run.summary.startedTools,
          );
          if (
            !canRecoverAgentRunFinalResponse({
              evidence,
              hasProviderContext: !!providerContext,
              status: run.status,
            })
          ) {
            continue;
          }

          await ensureAgentRunFinalResponse({
            conversationId: conversation.id,
            runId: run.id,
            status: run.status,
            providerContext,
            timestamp: run.updatedAt,
          });

          if (cancelled) {
            return;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversations, ensureAgentRunFinalResponse, resolveConversationFinalizationContext]);

  // ── Shared orchestrator runner ──────────────────────────────────────────
  const runChat = useCallback(
    async (convId: string, options?: RunChatOptions) => {
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      const provider = resolveEnabledProvider(providers, conv?.providerId || activeProviderId);
      if (!provider) {
        setChatError(t('chat.noProvider'));
        return;
      }

      const apiKey = await resolveProviderApiKey(provider);
      if (providerRequiresApiKey(provider) && !apiKey) {
        setChatError(t('chat.noApiKey'));
        return;
      }

      const model = resolveConversationModel(provider, {
        conversationModel: conv?.modelOverride,
        activeProviderId,
        activeModel,
      });
      if (!model) {
        setChatError(t('chat.noModel'));
        return;
      }

      const finalizationProviderContext: ResolvedFinalizationProviderContext = {
        provider: {
          ...provider,
          apiKey,
        },
        model,
        systemPromptText: conv?.systemPrompt || systemPrompt,
        conversationId: convId,
      };

      const latestUserMessage = [...(conv?.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'user');
      const latestUserRequestAssessment = assessUserRequest(latestUserMessage?.content, {
        hasAttachments: hasModelVisibleAttachments(latestUserMessage?.attachments),
        hasPriorContext: (conv?.messages?.length ?? 0) > 1,
      });
      const shouldTrackAgentRun =
        (conv?.mode ?? defaultConversationMode ?? 'agentic') === 'agentic' &&
        (options?.reuseAgentRunId ? true : !latestUserRequestAssessment.shouldSkipWorkflow);
      const existingRun = options?.reuseAgentRunId
        ? conv?.agentRuns?.find(
            (candidate) =>
              candidate.id === options.reuseAgentRunId && candidate.status === 'running',
          )
        : undefined;
      const supersededRun = !existingRun
        ? conv?.agentRuns?.find(
            (candidate) => candidate.id === conv.activeAgentRunId && candidate.status === 'running',
          )
        : undefined;
      const supersededRunWorkers =
        supersededRun && conv
          ? getLiveSubAgentsForRun(conv, supersededRun.id).filter(
              (agent) => agent.status === 'running',
            )
          : [];
      const resumedAssistantDraftMessageId = existingRun
        ? (findLatestIncompleteAgentRunAssistantMessage(
            conv?.messages ?? [],
            existingRun.userMessageId,
          )?.id ??
          findLatestPreferredAgentRunAssistantMessageId(
            conv?.messages ?? [],
            existingRun.userMessageId,
          ))
        : undefined;
      const resumedAssistantDraft = resumedAssistantDraftMessageId
        ? conv?.messages.find((message) => message.id === resumedAssistantDraftMessageId)
        : undefined;

      if (supersededRun && conv) {
        const supersedeOperationReason = 'Superseded by a new user turn.';
        const supersedeWorkerReason =
          'Cancelled because a new user turn superseded the active run.';
        const supersededRunSummary = buildSupersededRunSummary(supersededRunWorkers.length);

        cancelAgentRunOperations(convId, supersededRun.id, supersedeOperationReason);
        completeAgentRun(
          convId,
          {
            status: 'cancelled',
            latestSummary: supersededRunSummary,
            checkpointTitle: 'Run superseded',
            checkpointDetail: supersededRunSummary,
          },
          supersededRun.id,
        );

        cancelRunningSubAgentsForRun(conv, supersededRun.id, supersedeWorkerReason);

        appendConversationLog(convId, {
          kind: 'system',
          level: 'warning',
          title:
            supersededRunWorkers.length > 0
              ? 'Previous run superseded and workers cancelled'
              : 'Previous run superseded',
          detail: supersededRunSummary,
        });
      }

      const abort = new AbortController();
      const foregroundRequestId = generateId();
      registerForegroundRequest(foregroundRequestId, convId, abort);

      const assistantMsgId = resumedAssistantDraft?.id ?? generateId();
      forceNextScrollRef.current = true;
      if (!resumedAssistantDraft) {
        addMessage(convId, { id: assistantMsgId, role: 'assistant', content: '' });
      }
      setStreamingMessageId(assistantMsgId);

      const trackedAgentRunId = shouldTrackAgentRun
        ? (existingRun?.id ??
          startAgentRun(convId, {
            userMessageId: latestUserMessage?.id ?? generateId(),
            goal: latestUserMessage?.content?.trim() || 'Continue the current task.',
            summary: {
              assistantTurns: 1,
            },
          }))
        : undefined;

      if (trackedAgentRunId) {
        clearAgentRunCancellation(convId, trackedAgentRunId);
      }

      const clearForegroundRequestIfCurrent = () => {
        if (!isCurrentForegroundRequest(foregroundRequestId, abort)) {
          return false;
        }

        clearForegroundRequest(foregroundRequestId, abort);
        return true;
      };

      let currentAssistantMsgId = assistantMsgId;
      let accumulatedContent = resumedAssistantDraft?.content ?? '';
      let accumulatedReasoning = resumedAssistantDraft?.reasoning ?? '';
      let lastCommittedContent = resumedAssistantDraft?.content ?? '';
      let lastCommittedReasoning = resumedAssistantDraft?.reasoning ?? '';
      let lastPublishedContent = resumedAssistantDraft?.content
        ? stripInternalAssistantTranscriptArtifacts(resumedAssistantDraft.content)
        : '';
      let lastPublishedReasoning = resumedAssistantDraft?.reasoning ?? '';
      let cachedVisibleContentSource = resumedAssistantDraft?.content ?? '';
      let cachedVisibleContent = resumedAssistantDraft?.content
        ? stripInternalAssistantTranscriptArtifacts(resumedAssistantDraft.content)
        : '';
      let startNextAssistantTurn = false;
      let didEncounterTerminalError = false;
      let hasCapturedPlan = !!existingRun?.plan;
      let lastCapturedPlanSignature = existingRun?.plan
        ? JSON.stringify({
            objective: existingRun.plan.objective,
            successCriteria: existingRun.plan.successCriteria,
            stopConditions: existingRun.plan.stopConditions,
            workstreams: existingRun.plan.workstreams,
          })
        : '';
      let hasEnteredWorkPhase = false;
      let hasEnteredReviewPhase = false;
      let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
      let completionPromise: Promise<void> | null = null;
      const runStartedAt = existingRun?.createdAt ?? Date.now();
      let assistantTurnCount = (existingRun?.summary.assistantTurns ?? 0) + 1;
      let startedToolCount = existingRun?.summary.startedTools ?? 0;
      let completedToolCount = existingRun?.summary.completedTools ?? 0;
      let failedToolCount = existingRun?.summary.failedTools ?? 0;
      let spawnedSubAgentCount = existingRun?.summary.spawnedSubAgents ?? 0;
      const pendingSurfacedSubAgentOutputs = new Map<
        string,
        NonNullable<ReturnType<typeof parseSurfacedSubAgentOutputResult>>
      >();
      let surfacedSubAgentOutputLock: SurfacedSubAgentOutputLock | null = null;

      const getPersistedAssistantToolCalls = (messageId: string): ToolCall[] | undefined => {
        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);

        return latestConversation?.messages.find((message) => message.id === messageId)?.toolCalls;
      };

      const getPersistedAssistantMessage = (messageId: string): Message | undefined => {
        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);

        return latestConversation?.messages.find((message) => message.id === messageId);
      };

      const upsertLiveToolCall = (messageId: string, toolCall: ToolCall) => {
        if (!toolCall.id?.trim() || !toolCall.name?.trim()) {
          return;
        }
        updateStreamingDraft(messageId, (currentDraft) => ({
          ...(currentDraft ?? {}),
          toolCalls: mergeStreamingToolCall(
            currentDraft?.toolCalls ?? getPersistedAssistantToolCalls(messageId),
            toolCall,
          ),
        }));
      };

      const mergeLiveToolCalls = (messageId: string, toolCalls: ToolCall[]) => {
        const validToolCalls = toolCalls.filter(
          (toolCall) => toolCall.id?.trim() && toolCall.name?.trim(),
        );
        if (validToolCalls.length === 0) {
          return;
        }
        updateStreamingDraft(messageId, (currentDraft) => ({
          ...(currentDraft ?? {}),
          toolCalls: mergeStreamingToolCalls(
            currentDraft?.toolCalls ?? getPersistedAssistantToolCalls(messageId),
            validToolCalls,
          ),
        }));
      };

      const getVisibleAssistantContent = () => {
        if (cachedVisibleContentSource === accumulatedContent) {
          return cachedVisibleContent;
        }

        cachedVisibleContentSource = accumulatedContent;
        cachedVisibleContent = stripInternalAssistantTranscriptArtifacts(accumulatedContent);
        return cachedVisibleContent;
      };
      const resolveAssistantTurnContent = (content: string): string => {
        if (!resumedAssistantDraft || currentAssistantMsgId !== resumedAssistantDraft.id) {
          return content;
        }

        const preserveExistingDraft =
          resumedAssistantDraft.assistantMetadata?.finishReason === 'pilot_review_pending';
        const currentVisibleContent = getVisibleAssistantContent();
        const baselineContent =
          currentVisibleContent ||
          stripInternalAssistantTranscriptArtifacts(resumedAssistantDraft.content);
        const sanitizedIncomingContent = stripInternalAssistantTranscriptArtifacts(content);

        return mergeAssistantContinuationText(baselineContent, sanitizedIncomingContent, {
          preserveExistingPrefix: preserveExistingDraft,
        });
      };
      const clearSurfacedSubAgentOutputLock = () => {
        surfacedSubAgentOutputLock = null;
      };
      const getRunningBackgroundWorkerCount = () => {
        if (!trackedAgentRunId) {
          return 0;
        }

        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);
        if (!latestConversation) {
          return 0;
        }

        return getRunningLiveSubAgentsForRun(latestConversation, trackedAgentRunId).length;
      };
      const shouldEnterReviewPhaseForTool = (toolName: string) => {
        if (!isAgentReviewToolName(toolName)) {
          return false;
        }

        if (
          isBackgroundWorkerMonitoringToolName(toolName) &&
          getRunningBackgroundWorkerCount() > 0
        ) {
          return false;
        }

        return true;
      };

      const syncAgentRunSummary = (latestSummary?: string) => {
        if (!trackedAgentRunId) {
          return;
        }

        updateAgentRunSummary(
          convId,
          {
            assistantTurns: assistantTurnCount,
            startedTools: startedToolCount,
            completedTools: completedToolCount,
            failedTools: failedToolCount,
            spawnedSubAgents: spawnedSubAgentCount,
            latestSummary,
          },
          trackedAgentRunId,
        );
      };

      const isTrackedRunStillRunning = () => {
        if (!trackedAgentRunId) {
          return false;
        }

        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);

        return (
          latestConversation?.agentRuns?.some(
            (candidate) => candidate.id === trackedAgentRunId && candidate.status === 'running',
          ) ?? false
        );
      };

      const capturePlanSnapshot = (text?: string) => {
        const normalizedText = text?.trim();
        if (
          !trackedAgentRunId ||
          !normalizedText ||
          startedToolCount > 0 ||
          hasEnteredWorkPhase ||
          !hasStructuredPlanMarkers(normalizedText)
        ) {
          return;
        }

        const structuredPlan = extractStructuredAgentPlan(
          normalizedText,
          latestUserMessage?.content?.trim() || 'Complete the current task.',
        );
        const nextPlanSignature = JSON.stringify({
          objective: structuredPlan.objective,
          successCriteria: structuredPlan.successCriteria,
          stopConditions: structuredPlan.stopConditions,
          workstreams: structuredPlan.workstreams,
        });
        if (nextPlanSignature === lastCapturedPlanSignature) {
          return;
        }

        lastCapturedPlanSignature = nextPlanSignature;
        const detail = truncateLogDetail(structuredPlan.objective) || structuredPlan.objective;

        updateAgentRunPlan(convId, structuredPlan, trackedAgentRunId);
        setAgentRunPhase(
          convId,
          'plan',
          {
            status: 'completed',
            detail,
            checkpointTitle: hasCapturedPlan ? undefined : 'Plan captured',
            checkpointDetail: hasCapturedPlan ? undefined : detail,
          },
          trackedAgentRunId,
        );
        hasCapturedPlan = true;
        syncAgentRunSummary(detail);
      };

      const enterWorkPhase = (detail: string, checkpointTitle?: string) => {
        if (!trackedAgentRunId) {
          return;
        }

        const normalizedDetail = truncateLogDetail(detail) || detail;
        setAgentRunPhase(
          convId,
          'work',
          {
            status: 'active',
            detail: normalizedDetail,
            checkpointTitle: hasEnteredWorkPhase ? undefined : (checkpointTitle ?? 'Work started'),
            checkpointDetail: normalizedDetail,
            allowRegression: true,
          },
          trackedAgentRunId,
        );
        hasEnteredWorkPhase = true;
        syncAgentRunSummary(normalizedDetail);
      };

      const enterReviewPhase = (detail: string, checkpointTitle?: string) => {
        if (!trackedAgentRunId) {
          return;
        }

        const normalizedDetail = truncateLogDetail(detail) || detail;
        setAgentRunPhase(
          convId,
          'review',
          {
            status: 'active',
            detail: normalizedDetail,
            checkpointTitle: hasEnteredReviewPhase
              ? undefined
              : (checkpointTitle ?? 'Review started'),
            checkpointDetail: normalizedDetail,
          },
          trackedAgentRunId,
        );
        hasEnteredReviewPhase = true;
        syncAgentRunSummary(normalizedDetail);
      };

      const finalizeTrackedRun = (
        status: 'completed' | 'failed' | 'cancelled',
        latestSummary: string,
        checkpointTitle: string,
        checkpointDetail?: string,
      ) => {
        if (!trackedAgentRunId || !isTrackedRunStillRunning()) {
          return;
        }

        completeAgentRun(
          convId,
          {
            status,
            latestSummary,
            checkpointTitle,
            checkpointDetail,
            summary: {
              assistantTurns: assistantTurnCount,
              startedTools: startedToolCount,
              completedTools: completedToolCount,
              failedTools: failedToolCount,
              spawnedSubAgents: spawnedSubAgentCount,
              durationMs: Date.now() - runStartedAt,
            },
          },
          trackedAgentRunId,
        );
      };

      const recoverAgentRunFinalPreview = async (
        status: Exclude<AgentRun['status'], 'running'>,
        timestamp?: number,
        preferredAssistantMessageId?: string,
        signal?: AbortSignal,
      ): Promise<{ preview?: string; recovered: boolean }> => {
        if (!trackedAgentRunId) {
          return { recovered: false };
        }

        throwIfAbortSignalTriggered(signal);

        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);
        const targetRun = latestConversation?.agentRuns?.find(
          (candidate) => candidate.id === trackedAgentRunId,
        );
        if (!latestConversation || !targetRun) {
          return { recovered: false };
        }

        const existingPreview = getLatestFinalAssistantResponsePreview(
          latestConversation.messages,
          targetRun.userMessageId,
        );
        if (existingPreview) {
          return {
            preview: truncateLogDetail(existingPreview) || existingPreview,
            recovered: false,
          };
        }

        const evidence = collectAgentRunFinalizationEvidence(
          latestConversation.messages,
          targetRun.userMessageId,
          targetRun.summary.startedTools,
        );
        if (
          !canRecoverAgentRunFinalResponse({
            evidence,
            hasProviderContext: true,
            status,
          })
        ) {
          return { recovered: false };
        }

        const finalResponsePreview = await ensureAgentRunFinalResponse({
          conversationId: convId,
          runId: trackedAgentRunId,
          status,
          providerContext: finalizationProviderContext,
          timestamp,
          preferredAssistantMessageId,
          signal,
        });

        throwIfAbortSignalTriggered(signal);

        return {
          preview: finalResponsePreview,
          recovered: !!finalResponsePreview,
        };
      };

      const resolveInterruptedResponseOutcome = async (
        error: Error,
      ): Promise<{
        status: Exclude<AgentRun['status'], 'running'>;
        checkpointTitle: string;
        checkpointDetail: string;
        resumePrompt?: string;
        resumeUserPrompt?: string;
        resumePhase?: AgentRun['currentPhase'];
        keepRunOpen?: 'background-workers' | 'async-operations';
      }> => {
        if (isNonRetryableProviderRequestError(error)) {
          return {
            status: 'failed',
            checkpointTitle: 'Provider request rejected',
            checkpointDetail: error.message,
          };
        }

        if (!trackedAgentRunId) {
          return {
            status: 'failed',
            checkpointTitle: 'Turn failed',
            checkpointDetail: error.message,
          };
        }

        const latestConversation = useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === convId);
        const targetRun = latestConversation?.agentRuns?.find(
          (candidate) => candidate.id === trackedAgentRunId,
        );
        if (!latestConversation || !targetRun) {
          return {
            status: 'failed',
            checkpointTitle: 'Turn failed',
            checkpointDetail: error.message,
          };
        }

        const {
          liveSnapshots: liveSubAgents,
          mergedSnapshots: reviewableSubAgents,
          hasOrphanedRunningSnapshots,
        } = getReviewableSubAgentsForRun(latestConversation, targetRun);
        const effectiveSubAgents = hasOrphanedRunningSnapshots
          ? reviewableSubAgents.filter((snapshot) => snapshot.status !== 'running')
          : reviewableSubAgents;
        const runningBackgroundWorkerCount = liveSubAgents.filter(
          (snapshot) => snapshot.status === 'running',
        ).length;
        const pendingAsyncOperations = targetRun.pendingAsyncOperations ?? [];
        const planContinuation = evaluateWorkflowPlanContinuation({
          plan: targetRun.plan,
          workers: effectiveSubAgents,
        });
        const evidence = collectAgentRunFinalizationEvidence(
          latestConversation.messages,
          targetRun.userMessageId,
          targetRun.summary.startedTools,
          { liveSubAgentSnapshots: effectiveSubAgents },
        );

        if (
          !hasCompletedExecutionRecoveryEvidence({
            evidence,
            liveSubAgentSnapshots: liveSubAgents,
            pendingAsyncOperationCount: targetRun.pendingAsyncOperations?.length ?? 0,
          })
        ) {
          if (runningBackgroundWorkerCount > 0) {
            return {
              status: 'failed',
              checkpointTitle: 'Waiting for background workers',
              checkpointDetail: buildInterruptedBackgroundWorkerWaitSummary(
                runningBackgroundWorkerCount,
              ),
              keepRunOpen: 'background-workers',
            };
          }

          if (pendingAsyncOperations.length > 0) {
            return {
              status: 'failed',
              checkpointTitle: 'Async monitoring active',
              checkpointDetail: buildInterruptedAsyncMonitoringSummary(pendingAsyncOperations),
              keepRunOpen: 'async-operations',
            };
          }

          return {
            status: 'failed',
            checkpointTitle: 'Turn failed',
            checkpointDetail: error.message,
          };
        }

        const reviewPerspective =
          planContinuation.status === 'continue'
            ? buildStructuredPlanPilotReviewPerspective(planContinuation)
            : undefined;

        const pilotDecision = await evaluateAgentRunWithPilot({
          run: targetRun,
          evidence,
          workers: effectiveSubAgents,
          candidateOutcome: {
            status: 'completed',
            summary: reviewPerspective
              ? buildStructuredPlanPilotCandidateOutcomeSummary(
                  'The supervisor response stream was interrupted after the workflow gathered verified results. Decide whether the task is already complete from the current evidence or whether more work is still required.',
                  planContinuation,
                )
              : 'The supervisor response stream was interrupted after the workflow gathered verified results. Decide whether the task is already complete from the current evidence or whether more work is still required.',
          },
          reviewPerspective,
          providerContext: finalizationProviderContext,
          signal: abort.signal,
          onUsage: (usage) => {
            recordConversationUsageEvent({
              conversationId: convId,
              usage,
              providerId: finalizationProviderContext.provider.id,
              source: 'pilot',
              agentRunId: trackedAgentRunId,
              recordSessionUsage: true,
              emitLog: true,
            });
          },
        });

        throwIfAbortSignalTriggered(abort.signal);

        updateAgentRunPilotEvaluation(convId, pilotDecision.evaluation, trackedAgentRunId);

        if (pilotDecision.action === 'resume' && pilotDecision.reviewPrompt) {
          return {
            status: 'failed',
            checkpointTitle: pilotDecision.checkpointTitle,
            checkpointDetail: pilotDecision.checkpointDetail,
            resumePrompt: pilotDecision.reviewPrompt,
            resumeUserPrompt: pilotDecision.reviewUserPrompt,
            resumePhase: 'pilot',
          };
        }

        return {
          status: pilotDecision.outcome.status,
          checkpointTitle: pilotDecision.checkpointTitle,
          checkpointDetail: pilotDecision.checkpointDetail,
        };
      };

      const publishAssistantBuffers = (visibleContentOverride?: string) => {
        const visibleContent = visibleContentOverride ?? getVisibleAssistantContent();
        if (visibleContent) {
          capturePlanSnapshot(visibleContent);
        }

        if (
          visibleContent === lastPublishedContent &&
          accumulatedReasoning === lastPublishedReasoning
        ) {
          return;
        }

        mergeStreamingDraft(currentAssistantMsgId, {
          content: visibleContent,
          reasoning: accumulatedReasoning || undefined,
        });
        lastPublishedContent = visibleContent;
        lastPublishedReasoning = accumulatedReasoning;
      };

      const commitAssistantBuffers = (finalize = false) => {
        if (checkpointTimer) {
          clearTimeout(checkpointTimer);
          checkpointTimer = null;
        }

        publishAssistantBuffers();

        const visibleContent = getVisibleAssistantContent();

        if (visibleContent !== lastCommittedContent) {
          updateMessage(convId, currentAssistantMsgId, visibleContent);
          lastCommittedContent = visibleContent;
        }

        if (accumulatedReasoning !== lastCommittedReasoning) {
          updateMessageReasoning(convId, currentAssistantMsgId, accumulatedReasoning);
          lastCommittedReasoning = accumulatedReasoning;
        }

        if (finalize) {
          clearStreamingDraft(currentAssistantMsgId);
        }
      };

      const markCurrentAssistantDraftIncomplete = (
        visibleContent: string,
        finishReason: 'response_failed' | 'pilot_review_pending',
      ) => {
        if (!visibleContent.trim()) {
          return;
        }

        updateMessageAssistantMetadata(
          convId,
          currentAssistantMsgId,
          buildAssistantMessageMetadata('final', {
            completionStatus: 'incomplete',
            finishReason,
          }),
        );
      };

      const scheduleAssistantCheckpoint = () => {
        if (checkpointTimer) return;
        checkpointTimer = setTimeout(() => {
          commitAssistantBuffers(false);
        }, STREAM_STORE_CHECKPOINT_INTERVAL_MS);
      };

      const ensureAssistantTurn = () => {
        if (!startNextAssistantTurn) return;
        commitAssistantBuffers(true);
        currentAssistantMsgId = generateId();
        forceNextScrollRef.current = shouldAutoFollowRef.current;
        addMessage(convId, { id: currentAssistantMsgId, role: 'assistant', content: '' });
        setStreamingMessageId(currentAssistantMsgId);
        assistantTurnCount += 1;
        syncAgentRunSummary();
        accumulatedContent = '';
        accumulatedReasoning = '';
        lastCommittedContent = '';
        lastCommittedReasoning = '';
        lastPublishedContent = '';
        lastPublishedReasoning = '';
        cachedVisibleContentSource = '';
        cachedVisibleContent = '';
        startNextAssistantTurn = false;
      };

      const queueSurfacedSubAgentOutput = (toolCall: ToolCall) => {
        const surfacedOutput = parseSurfacedSubAgentOutputResult(toolCall.result);
        if (!surfacedOutput) {
          pendingSurfacedSubAgentOutputs.delete(toolCall.id);
          return undefined;
        }

        pendingSurfacedSubAgentOutputs.set(toolCall.id, surfacedOutput);
        return surfacedOutput;
      };

      const flushSurfacedSubAgentOutput = (toolCallId: string) => {
        const surfacedOutput = pendingSurfacedSubAgentOutputs.get(toolCallId);
        if (!surfacedOutput) {
          return false;
        }

        pendingSurfacedSubAgentOutputs.delete(toolCallId);
        commitAssistantBuffers(true);

        const surfacedMessageId = generateId();
        forceNextScrollRef.current = shouldAutoFollowRef.current;
        addMessage(convId, {
          id: surfacedMessageId,
          role: 'assistant',
          content: surfacedOutput.output,
          assistantMetadata: buildAssistantMessageMetadata('final', {
            completionStatus: 'incomplete',
            finishReason: 'surfaced_worker_output_pending',
          }),
        });
        setStreamingMessageId(surfacedMessageId);
        surfacedSubAgentOutputLock = {
          toolCallId,
          messageId: surfacedMessageId,
          content: surfacedOutput.output,
        };

        const surfacedSummary = truncateLogDetail(surfacedOutput.output) || surfacedOutput.output;
        syncAgentRunSummary(surfacedSummary);
        return true;
      };

      const flushPendingSurfacedSubAgentOutputs = () => {
        for (const toolCallId of Array.from(pendingSurfacedSubAgentOutputs.keys())) {
          flushSurfacedSubAgentOutput(toolCallId);
        }
      };

      const logStateChange = (state: string) => {
        if (state === 'error' || state === lastLoggedStateRef.current) {
          return;
        }

        if (trackedAgentRunId && state === 'thinking') {
          setAgentRunPhase(
            convId,
            'assess',
            {
              status: 'active',
              detail: 'Analyzing the task',
            },
            trackedAgentRunId,
          );
          syncAgentRunSummary('Analyzing the task');
        }

        lastLoggedStateRef.current = state;
        appendConversationLog(convId, {
          kind: 'state',
          title: `State: ${formatStateLabel(state)}`,
          detail: state === 'responding' ? `Streaming response from ${model}` : undefined,
        });
      };

      const callbacks: OrchestratorCallbacks = {
        onStateChange: (state) => {
          logStateChange(String(state));
        },
        onToken: (token) => {
          if (surfacedSubAgentOutputLock) {
            return;
          }
          ensureAssistantTurn();
          accumulatedContent += token;
          publishAssistantBuffers();
          scheduleAssistantCheckpoint();
        },
        onReasoning: (token) => {
          if (surfacedSubAgentOutputLock) {
            return;
          }
          ensureAssistantTurn();
          accumulatedReasoning += token;
          publishAssistantBuffers();
          scheduleAssistantCheckpoint();
        },
        onAssistantStreamReset: () => {
          if (checkpointTimer) {
            clearTimeout(checkpointTimer);
            checkpointTimer = null;
          }

          const baselineContent =
            resumedAssistantDraft && currentAssistantMsgId === resumedAssistantDraft.id
              ? (resumedAssistantDraft.content ?? '')
              : '';
          const baselineReasoning =
            resumedAssistantDraft && currentAssistantMsgId === resumedAssistantDraft.id
              ? (resumedAssistantDraft.reasoning ?? '')
              : '';
          const baselineVisibleContent = baselineContent
            ? stripInternalAssistantTranscriptArtifacts(baselineContent)
            : '';
          const shouldResetPersistedContent = lastCommittedContent !== baselineVisibleContent;
          const shouldResetPersistedReasoning = lastCommittedReasoning !== baselineReasoning;

          accumulatedContent = baselineContent;
          accumulatedReasoning = baselineReasoning;
          lastCommittedContent = baselineVisibleContent;
          lastCommittedReasoning = baselineReasoning;
          lastPublishedContent = baselineVisibleContent;
          lastPublishedReasoning = baselineReasoning;
          cachedVisibleContentSource = baselineContent;
          cachedVisibleContent = baselineVisibleContent;

          clearStreamingDraft(currentAssistantMsgId);

          if (shouldResetPersistedContent) {
            updateMessage(convId, currentAssistantMsgId, baselineVisibleContent);
          }
          if (shouldResetPersistedReasoning) {
            updateMessageReasoning(convId, currentAssistantMsgId, baselineReasoning);
          }
        },
        onUserMessageEnriched: (messageId, enrichedContent) => {
          updateMessageEnrichedContent(convId, messageId, enrichedContent);
        },
        onToolCallQueued: (toolCall) => {
          const queuedToolCall: ToolCall = {
            ...toolCall,
            status: toolCall.status ?? 'pending',
          };

          if (!queuedToolCall.id?.trim() || !queuedToolCall.name?.trim()) {
            return;
          }

          upsertLiveToolCall(currentAssistantMsgId, queuedToolCall);
        },
        onToolCallStart: (toolCall) => {
          if (!toolCall.id?.trim() || !toolCall.name?.trim()) {
            return;
          }
          clearSurfacedSubAgentOutputLock();
          startedToolCount += 1;
          appendAgentRunCheckpoint(
            convId,
            {
              kind: getAgentRunCheckpointKindForToolName(toolCall.name),
              title: `Tool started: ${toolCall.name}`,
              detail: summarizeToolArguments(toolCall.arguments),
              timestamp: toolCall.startedAt,
            },
            trackedAgentRunId,
          );
          if (shouldEnterReviewPhaseForTool(toolCall.name)) {
            enterReviewPhase(`Monitoring progress with ${toolCall.name}`, 'Review started');
          } else {
            enterWorkPhase(
              toolCall.name === 'sessions_spawn'
                ? 'Launching sub-agent work'
                : `Using ${toolCall.name}`,
              toolCall.name === 'sessions_spawn' ? 'Worker launch started' : 'Work started',
            );
          }
          upsertLiveToolCall(currentAssistantMsgId, toolCall);
          addToolCall(convId, currentAssistantMsgId, toolCall);

          appendConversationLog(convId, {
            kind: 'tool',
            title: `Tool started: ${toolCall.name}`,
            detail: summarizeToolArguments(toolCall.arguments),
            timestamp: toolCall.startedAt,
          });
        },
        onToolCallComplete: (toolCall) => {
          if (!toolCall.id?.trim() || !toolCall.name?.trim()) {
            return;
          }
          recordImageToolConversationUsage({
            conversationId: convId,
            toolCall,
            providerId: provider.id,
            source: 'primary',
            agentRunId: trackedAgentRunId,
            emitLog: true,
          });
          const surfacedOutput =
            toolCall.name === 'sessions_surface_output' && toolCall.status === 'completed'
              ? queueSurfacedSubAgentOutput(toolCall)
              : undefined;

          upsertLiveToolCall(currentAssistantMsgId, toolCall);
          updateToolCallStatus(convId, currentAssistantMsgId, toolCall.id, toolCall.status, {
            result: surfacedOutput
              ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
              : toolCall.result,
            error: toolCall.error,
            completedAt: toolCall.completedAt,
          });
          if (toolCall.name === 'message_effect') {
            const effectId = extractMessageEffect(toolCall.result);
            if (effectId) {
              mergeStreamingDraft(currentAssistantMsgId, { effectId });
              updateMessageEffect(convId, currentAssistantMsgId, effectId);
            }
          } else if (toolCall.name === 'sessions_surface_output') {
            if (!surfacedOutput) {
              pendingSurfacedSubAgentOutputs.delete(toolCall.id);
            }
          }
          const elapsed =
            toolCall.completedAt && toolCall.startedAt
              ? formatCompactElapsed(Math.max(0, toolCall.completedAt - toolCall.startedAt))
              : undefined;
          if (toolCall.status === 'failed') {
            failedToolCount += 1;
          } else {
            completedToolCount += 1;
            if (toolCall.name === 'sessions_spawn') {
              spawnedSubAgentCount += 1;
            }
          }
          const toolCheckpointDetail =
            summarizeToolResult(toolCall) ||
            (toolCall.status === 'failed'
              ? `Tool ${toolCall.name} failed`
              : `Completed ${toolCall.name}`);
          appendAgentRunCheckpoint(
            convId,
            {
              kind: getAgentRunCheckpointKindForToolName(toolCall.name),
              title:
                toolCall.status === 'failed'
                  ? `Tool failed: ${toolCall.name}`
                  : `Tool completed: ${toolCall.name}`,
              detail: toolCheckpointDetail,
              timestamp: toolCall.completedAt ?? toolCall.updatedAt,
            },
            trackedAgentRunId,
          );
          if (shouldEnterReviewPhaseForTool(toolCall.name)) {
            enterReviewPhase(toolCheckpointDetail);
          } else {
            enterWorkPhase(toolCheckpointDetail);
          }
          appendConversationLog(convId, {
            kind: 'tool',
            level: toolCall.status === 'failed' ? 'error' : 'success',
            title: `${toolCall.status === 'failed' ? 'Tool failed' : 'Tool completed'}: ${toolCall.name}${elapsed ? ` (${elapsed})` : ''}`,
            detail: summarizeToolResult(toolCall),
            timestamp: toolCall.completedAt ?? toolCall.updatedAt,
          });
        },
        onPendingAsyncOperationsChange: (operations) => {
          if (!trackedAgentRunId) {
            return;
          }

          const timestamp = Date.now();
          const pendingSummary =
            operations.length > 0 ? buildPendingAsyncOperationSummary(operations) : undefined;
          updateAgentRunPendingAsyncOperations(
            convId,
            operations,
            {
              latestSummary: pendingSummary,
              timestamp,
            },
            trackedAgentRunId,
          );

          if (pendingSummary) {
            enterReviewPhase(pendingSummary, 'Async monitoring active');
          }
        },
        onAssistantMessage: (content, toolCalls, providerReplay, assistantMetadata) => {
          const incomingToolCalls =
            toolCalls?.filter((toolCall) => toolCall.id?.trim() && toolCall.name?.trim()) ?? [];
          if (surfacedSubAgentOutputLock && incomingToolCalls.length === 0) {
            if (providerReplay) {
              updateMessageProviderReplay(convId, currentAssistantMsgId, providerReplay);
            }
            if (assistantMetadata) {
              updateMessageAssistantMetadata(convId, currentAssistantMsgId, assistantMetadata);
            }
            return;
          }
          if (surfacedSubAgentOutputLock && incomingToolCalls.length > 0) {
            clearSurfacedSubAgentOutputLock();
          }
          const persistedAssistantMessage = getPersistedAssistantMessage(currentAssistantMsgId);
          const persistedToolCalls = persistedAssistantMessage?.toolCalls ?? [];
          const persistedContent = persistedAssistantMessage?.content?.trim() ?? '';
          const persistedReasoning = persistedAssistantMessage?.reasoning?.trim() ?? '';
          const currentDraft = streamingDraftsRef.current[currentAssistantMsgId];
          const currentDraftContent = currentDraft?.content?.trim() ?? '';
          const currentDraftReasoning = currentDraft?.reasoning?.trim() ?? '';
          const shouldStartNewToolOnlyTurn =
            !startNextAssistantTurn &&
            incomingToolCalls.length > 0 &&
            persistedToolCalls.length > 0 &&
            !persistedContent &&
            !persistedReasoning &&
            !currentDraftContent &&
            !currentDraftReasoning;

          if (shouldStartNewToolOnlyTurn) {
            startNextAssistantTurn = true;
          }

          if (
            startNextAssistantTurn &&
            !toolCalls?.length &&
            (content || providerReplay || assistantMetadata?.kind === 'final')
          ) {
            ensureAssistantTurn();
          }
          if (startNextAssistantTurn && incomingToolCalls.length > 0) {
            ensureAssistantTurn();
          }
          if (providerReplay) {
            updateMessageProviderReplay(convId, currentAssistantMsgId, providerReplay);
          }
          if (assistantMetadata) {
            updateMessageAssistantMetadata(convId, currentAssistantMsgId, assistantMetadata);
          }
          const resolvedContent = content ? resolveAssistantTurnContent(content) : content;
          if (resolvedContent) {
            capturePlanSnapshot(resolvedContent);
          }
          if (incomingToolCalls.length) {
            mergeLiveToolCalls(
              currentAssistantMsgId,
              incomingToolCalls.map((toolCall) => ({
                ...toolCall,
                status: toolCall.status ?? 'pending',
              })),
            );
            for (const toolCall of incomingToolCalls) {
              addToolCall(convId, currentAssistantMsgId, {
                ...toolCall,
                status: toolCall.status ?? 'pending',
              });
            }
          }
          if (incomingToolCalls.length) {
            const nextToolName = incomingToolCalls[0]?.name;
            if (nextToolName && shouldEnterReviewPhaseForTool(nextToolName)) {
              enterReviewPhase(`Monitoring progress with ${nextToolName}`, 'Review started');
            } else if (nextToolName) {
              enterWorkPhase(
                nextToolName === 'sessions_spawn'
                  ? 'Launching sub-agent work'
                  : `Using ${nextToolName}`,
                nextToolName === 'sessions_spawn' ? 'Worker launch started' : 'Work started',
              );
            }
          } else if (resolvedContent) {
            syncAgentRunSummary(truncateLogDetail(resolvedContent) || resolvedContent);
          }
          if (resolvedContent) {
            accumulatedContent = resolvedContent;
            commitAssistantBuffers(incomingToolCalls.length ? false : true);
            accumulatedContent = '';
            lastCommittedContent = '';
          }
          if (incomingToolCalls.length) {
            startNextAssistantTurn = true;
          }
        },
        onToolMessage: (toolCallId, result) => {
          const surfacedOutput = pendingSurfacedSubAgentOutputs.get(toolCallId);
          addMessage(convId, {
            id: `${currentAssistantMsgId}_tool_${toolCallId}`,
            role: 'tool',
            content: surfacedOutput
              ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
              : result,
            toolCallId,
            isError: isToolResultErrorLike(result),
          });
          flushSurfacedSubAgentOutput(toolCallId);
        },
        onError: (error) => {
          didEncounterTerminalError = true;
          completionPromise = (async () => {
            flushPendingSurfacedSubAgentOutputs();
            ensureAssistantTurn();
            commitAssistantBuffers(true);
            throwIfAbortSignalTriggered(abort.signal);

            const visibleContent = getVisibleAssistantContent();
            markCurrentAssistantDraftIncomplete(visibleContent, 'response_failed');
            const interruptedOutcome = await resolveInterruptedResponseOutcome(error);
            throwIfAbortSignalTriggered(abort.signal);

            if (interruptedOutcome.resumePrompt) {
              const resumeAgentRun = resumeAgentRunRef.current;
              if (trackedAgentRunId && resumeAgentRun) {
                markCurrentAssistantDraftIncomplete(visibleContent, 'pilot_review_pending');
                const resumePhase = interruptedOutcome.resumePhase ?? 'pilot';
                setAgentRunPhase(
                  convId,
                  resumePhase,
                  {
                    status: 'active',
                    detail: interruptedOutcome.checkpointDetail,
                    checkpointTitle:
                      resumePhase === 'pilot'
                        ? PILOT_REVIEW_CHECKPOINT_TITLE
                        : interruptedOutcome.checkpointTitle,
                    checkpointDetail: interruptedOutcome.checkpointDetail,
                  },
                  trackedAgentRunId,
                );
                updateAgentRunSummary(
                  convId,
                  {
                    latestSummary: interruptedOutcome.checkpointDetail,
                  },
                  trackedAgentRunId,
                );
                appendConversationLog(convId, {
                  kind: 'state',
                  level: 'warning',
                  title: interruptedOutcome.checkpointTitle,
                  detail: interruptedOutcome.checkpointDetail,
                });

                clearForegroundRequestIfCurrent();

                throwIfAbortSignalTriggered(abort.signal);

                await resumeAgentRun({
                  conversationId: convId,
                  runId: trackedAgentRunId,
                  additionalSystemPrompt: interruptedOutcome.resumePrompt,
                  additionalUserPrompt: interruptedOutcome.resumeUserPrompt,
                });

                throwIfAbortSignalTriggered(abort.signal);
                requestChatStorePersistenceCheckpoint();
                return;
              }
            }

            if (trackedAgentRunId && interruptedOutcome.keepRunOpen === 'background-workers') {
              const waitTimestamp = Date.now();
              setAgentRunAwaitingBackgroundWorkers(
                convId,
                true,
                {
                  latestSummary: interruptedOutcome.checkpointDetail,
                  checkpointTitle: interruptedOutcome.checkpointTitle,
                  checkpointDetail: interruptedOutcome.checkpointDetail,
                  timestamp: waitTimestamp,
                },
                trackedAgentRunId,
              );
              appendConversationLog(convId, {
                kind: 'state',
                level: 'warning',
                title: interruptedOutcome.checkpointTitle,
                detail: interruptedOutcome.checkpointDetail,
                timestamp: waitTimestamp,
              });
              requestChatStorePersistenceCheckpoint();
              return;
            }

            if (trackedAgentRunId && interruptedOutcome.keepRunOpen === 'async-operations') {
              const reviewTimestamp = Date.now();
              setAgentRunPhase(
                convId,
                'review',
                {
                  status: 'active',
                  detail: interruptedOutcome.checkpointDetail,
                  checkpointTitle: interruptedOutcome.checkpointTitle,
                  checkpointDetail: interruptedOutcome.checkpointDetail,
                  timestamp: reviewTimestamp,
                },
                trackedAgentRunId,
              );
              updateAgentRunSummary(
                convId,
                {
                  latestSummary: interruptedOutcome.checkpointDetail,
                  timestamp: reviewTimestamp,
                },
                trackedAgentRunId,
              );
              appendConversationLog(convId, {
                kind: 'state',
                level: 'warning',
                title: interruptedOutcome.checkpointTitle,
                detail: interruptedOutcome.checkpointDetail,
                timestamp: reviewTimestamp,
              });
              requestChatStorePersistenceCheckpoint();
              return;
            }

            const recoveredFinal = await recoverAgentRunFinalPreview(
              interruptedOutcome.status,
              undefined,
              undefined,
              abort.signal,
            );
            throwIfAbortSignalTriggered(abort.signal);
            const latestSummary =
              recoveredFinal.preview || visibleContent || `Error: ${error.message}`;

            finalizeTrackedRun(
              interruptedOutcome.status,
              latestSummary,
              interruptedOutcome.checkpointTitle,
              interruptedOutcome.checkpointDetail,
            );
            if (!recoveredFinal.recovered && interruptedOutcome.status !== 'completed') {
              setChatError(error.message);
            }
            appendConversationLog(convId, {
              kind: 'error',
              level:
                interruptedOutcome.status === 'completed' || recoveredFinal.recovered
                  ? 'warning'
                  : 'error',
              title:
                interruptedOutcome.status === 'completed'
                  ? 'Response interrupted; recovered final answer'
                  : recoveredFinal.recovered
                    ? interruptedOutcome.checkpointTitle
                    : 'Response failed',
              detail:
                interruptedOutcome.status === 'completed'
                  ? error.message
                  : interruptedOutcome.checkpointDetail,
            });

            if (!recoveredFinal.recovered && interruptedOutcome.status !== 'completed') {
              updateMessage(
                convId,
                currentAssistantMsgId,
                visibleContent || `Error: ${error.message}`,
              );
              updateMessageAssistantMetadata(
                convId,
                currentAssistantMsgId,
                buildAssistantMessageMetadata('final', {
                  completionStatus: 'incomplete',
                  finishReason: 'response_failed',
                }),
              );
            }

            requestChatStorePersistenceCheckpoint();
          })();
        },
        onUsage: (usage) => {
          recordConversationUsageEvent({
            conversationId: convId,
            usage: {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              totalTokens: usage.totalTokens,
              model: usage.model || model,
            },
            providerId: provider.id,
            source: 'primary',
            agentRunId: trackedAgentRunId,
            emitLog: true,
          });
        },
        onDone: () => {
          if (didEncounterTerminalError) {
            const terminalRecovery = completionPromise ?? Promise.resolve();
            completionPromise = terminalRecovery.finally(() => {
              clearForegroundRequestIfCurrent();
              requestChatStorePersistenceCheckpoint();
            });
            return;
          }

          completionPromise = (async () => {
            flushPendingSurfacedSubAgentOutputs();
            commitAssistantBuffers(true);
            if (!abort.signal.aborted) {
              const turnSummary = buildTurnSummaryLogDetail({
                durationMs: Date.now() - runStartedAt,
                assistantTurns: assistantTurnCount,
                startedTools: startedToolCount,
                completedTools: completedToolCount,
                failedTools: failedToolCount,
                spawnedSubAgents: spawnedSubAgentCount,
              });
              const runningBackgroundWorkerCount = getRunningBackgroundWorkerCount();

              if (trackedAgentRunId && runningBackgroundWorkerCount > 0) {
                const latestConversation = useChatStore
                  .getState()
                  .conversations.find((candidate) => candidate.id === convId);
                const currentAssistantMessage = latestConversation?.messages.find(
                  (candidate) => candidate.id === currentAssistantMsgId,
                );

                if (
                  currentAssistantMessage?.role === 'assistant' &&
                  !currentAssistantMessage.subAgentEvent &&
                  (currentAssistantMessage.toolCalls?.length ?? 0) === 0 &&
                  currentAssistantMessage.content.trim().length > 0
                ) {
                  updateMessageAssistantMetadata(
                    convId,
                    currentAssistantMsgId,
                    buildAssistantMessageMetadata('intermediate', {
                      completionStatus: 'complete',
                      finishReason: 'background_workers_running',
                    }),
                  );
                }

                const waitSummary = buildBackgroundWorkerWaitSummary(runningBackgroundWorkerCount);
                setAgentRunAwaitingBackgroundWorkers(
                  convId,
                  true,
                  {
                    latestSummary: waitSummary,
                    checkpointTitle: 'Waiting for background workers',
                    checkpointDetail: waitSummary,
                  },
                  trackedAgentRunId,
                );
                appendConversationLog(convId, {
                  kind: 'state',
                  level: 'warning',
                  title: 'Background workers still running',
                  detail: `${turnSummary} · ${waitSummary}`,
                });
              } else {
                let completionStatus: Exclude<AgentRun['status'], 'running'> = 'completed';
                let latestSummary = turnSummary;
                let checkpointTitle = 'Turn completed';
                let checkpointDetail = turnSummary;
                let completionLogLevel: ConversationLogEntry['level'] = 'success';
                let completionLogTitle = 'Turn completed';
                let completionLogDetail = turnSummary;

                if (trackedAgentRunId) {
                  const latestConversation = useChatStore
                    .getState()
                    .conversations.find((candidate) => candidate.id === convId);
                  const targetRun = latestConversation?.agentRuns?.find(
                    (candidate) => candidate.id === trackedAgentRunId,
                  );

                  if (latestConversation && targetRun) {
                    const targetMessageId = findLatestAgentRunAssistantMessageId(
                      latestConversation.messages,
                      targetRun.userMessageId,
                    );
                    const targetMessage = targetMessageId
                      ? latestConversation.messages.find(
                          (message) => message.id === targetMessageId,
                        )
                      : undefined;

                    if (
                      targetMessageId &&
                      targetMessage?.role === 'assistant' &&
                      !targetMessage.subAgentEvent &&
                      (targetMessage.toolCalls?.length ?? 0) === 0 &&
                      targetMessage.assistantMetadata?.kind === 'final' &&
                      targetMessage.assistantMetadata.completionStatus === 'complete'
                    ) {
                      updateMessageAssistantMetadata(
                        convId,
                        targetMessageId,
                        buildAssistantMessageMetadata('final', {
                          completionStatus: 'incomplete',
                          finishReason: 'pilot_review_pending',
                        }),
                      );
                    }

                    const {
                      liveSnapshots: liveSubAgents,
                      mergedSnapshots: reviewableSubAgents,
                      hasOrphanedRunningSnapshots,
                    } = getReviewableSubAgentsForRun(latestConversation, targetRun);
                    const effectiveSubAgents = hasOrphanedRunningSnapshots
                      ? reviewableSubAgents.filter((snapshot) => snapshot.status !== 'running')
                      : reviewableSubAgents;
                    const planContinuation = evaluateWorkflowPlanContinuation({
                      plan: targetRun.plan,
                      workers: effectiveSubAgents,
                    });
                    const reviewPerspective =
                      planContinuation.status === 'continue'
                        ? buildStructuredPlanPilotReviewPerspective(planContinuation)
                        : undefined;

                    const evidence = collectAgentRunFinalizationEvidence(
                      latestConversation.messages,
                      targetRun.userMessageId,
                      targetRun.summary.startedTools,
                      { liveSubAgentSnapshots: effectiveSubAgents },
                    );
                    const pilotDecision = await evaluateAgentRunWithPilot({
                      run: targetRun,
                      evidence,
                      workers: effectiveSubAgents,
                      candidateOutcome: {
                        status: 'completed',
                        summary: reviewPerspective
                          ? buildStructuredPlanPilotCandidateOutcomeSummary(
                              turnSummary,
                              planContinuation,
                            )
                          : turnSummary,
                      },
                      reviewPerspective,
                      providerContext: finalizationProviderContext,
                      signal: abort.signal,
                      onUsage: (usage) => {
                        recordConversationUsageEvent({
                          conversationId: convId,
                          usage,
                          providerId: finalizationProviderContext.provider.id,
                          source: 'pilot',
                          agentRunId: trackedAgentRunId,
                          recordSessionUsage: true,
                          emitLog: true,
                        });
                      },
                    });

                    throwIfAbortSignalTriggered(abort.signal);

                    updateAgentRunPilotEvaluation(
                      convId,
                      pilotDecision.evaluation,
                      trackedAgentRunId,
                    );

                    if (pilotDecision.action === 'resume' && pilotDecision.reviewPrompt) {
                      const resumeAgentRun = resumeAgentRunRef.current;
                      if (resumeAgentRun) {
                        setAgentRunPhase(
                          convId,
                          'pilot',
                          {
                            status: 'active',
                            detail: pilotDecision.checkpointDetail,
                            checkpointTitle: PILOT_REVIEW_CHECKPOINT_TITLE,
                            checkpointDetail: pilotDecision.checkpointDetail,
                          },
                          trackedAgentRunId,
                        );
                        updateAgentRunSummary(
                          convId,
                          {
                            latestSummary: pilotDecision.checkpointDetail,
                          },
                          trackedAgentRunId,
                        );
                        appendConversationLog(convId, {
                          kind: 'state',
                          level: 'warning',
                          title: pilotDecision.checkpointTitle,
                          detail: pilotDecision.checkpointDetail,
                        });

                        clearForegroundRequestIfCurrent();

                        throwIfAbortSignalTriggered(abort.signal);

                        await resumeAgentRun({
                          conversationId: convId,
                          runId: trackedAgentRunId,
                          additionalSystemPrompt: pilotDecision.reviewPrompt,
                          additionalUserPrompt: pilotDecision.reviewUserPrompt,
                          disableTools: pilotDecision.disableToolsOnResume,
                        });

                        throwIfAbortSignalTriggered(abort.signal);
                        return;
                      }

                      completionStatus = 'failed';
                      checkpointTitle = 'Pilot recovery unavailable';
                      checkpointDetail = `${pilotDecision.checkpointDetail} Supervisor recovery was unavailable, so the run was closed instead of resumed.`;
                      completionLogLevel = 'error';
                      completionLogTitle = checkpointTitle;
                      completionLogDetail = checkpointDetail;
                    } else {
                      completionStatus = pilotDecision.outcome.status;
                      checkpointTitle = pilotDecision.checkpointTitle;
                      checkpointDetail = pilotDecision.checkpointDetail;
                      completionLogLevel =
                        completionStatus === 'completed'
                          ? 'success'
                          : completionStatus === 'cancelled'
                            ? 'warning'
                            : 'error';
                      completionLogTitle = pilotDecision.checkpointTitle;
                      completionLogDetail = pilotDecision.checkpointDetail;
                    }

                    const finalPreview = await recoverAgentRunFinalPreview(
                      completionStatus,
                      undefined,
                      completionStatus === 'completed' && pilotDecision.evaluation.approved
                        ? findLatestPreferredAgentRunAssistantMessageId(
                            latestConversation.messages,
                            targetRun.userMessageId,
                          )
                        : undefined,
                      abort.signal,
                    );

                    throwIfAbortSignalTriggered(abort.signal);

                    if (finalPreview.preview) {
                      latestSummary = finalPreview.preview;
                    } else if (completionStatus === 'completed') {
                      const fallbackOutput = buildMissingFinalResponseFallback('completed');
                      const fallbackMetadata = buildAssistantMessageMetadata('final', {
                        completionStatus: 'complete',
                        finishReason: 'fallback_missing_final_response',
                      });

                      if (targetMessageId) {
                        updateMessage(convId, targetMessageId, fallbackOutput);
                        updateMessageAssistantMetadata(convId, targetMessageId, fallbackMetadata);
                      } else {
                        addMessage(convId, {
                          id: generateId(),
                          role: 'assistant',
                          content: fallbackOutput,
                          assistantMetadata: fallbackMetadata,
                        });
                      }
                      latestSummary = fallbackOutput;
                    } else {
                      latestSummary = pilotDecision.outcome.summary;
                    }

                    const pilotTerminalWorkerReason =
                      'Cancelled because the supervising run reached a terminal state after Pilot review.';
                    const latestConversationForTerminalCleanup = useChatStore
                      .getState()
                      .conversations.find((candidate) => candidate.id === convId);
                    const cancelledWorkers =
                      trackedAgentRunId && latestConversationForTerminalCleanup
                        ? cancelRunningSubAgentsForRun(
                            latestConversationForTerminalCleanup,
                            trackedAgentRunId,
                            pilotTerminalWorkerReason,
                          )
                        : [];
                    const cancelledWorkerDetail = buildStoppedBackgroundWorkerDetail(
                      cancelledWorkers.length,
                    );

                    if (cancelledWorkerDetail) {
                      checkpointDetail = `${checkpointDetail} ${cancelledWorkerDetail}`;
                      completionLogDetail = `${completionLogDetail} ${cancelledWorkerDetail}`;
                    }

                    if (trackedAgentRunId) {
                      cancelAgentRunOperations(
                        convId,
                        trackedAgentRunId,
                        pilotTerminalWorkerReason,
                      );
                    }
                  }
                }

                finalizeTrackedRun(
                  completionStatus,
                  latestSummary,
                  checkpointTitle,
                  checkpointDetail,
                );
                appendConversationLog(convId, {
                  kind: 'state',
                  level: completionLogLevel,
                  title: completionLogTitle,
                  detail: completionLogDetail,
                });
              }
            }
            clearForegroundRequestIfCurrent();
          })();
        },
        onCommandResult: (result) => {
          if (result.response) updateMessage(convId, currentAssistantMsgId, result.response);
          appendConversationLog(convId, {
            kind: 'command',
            level: 'success',
            title: result.action ? `Command result: ${result.action}` : 'Command result',
            detail: result.response,
          });
          if (result.action === 'new_conversation') {
            const selection = resolveConversationStartDefaults();
            if (!selection) {
              setChatError(t('chat.noProvider'));
              return;
            }
            createConversation(selection.providerId, systemPrompt, selection.model || undefined);
          }
          if (result.action === 'export') {
            const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
            if (conv) {
              const markdown = exportConversationAsMarkdown(conv);
              const fileName = `${conv.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.md`;
              void (async () => {
                try {
                  await shareTextExport({
                    content: markdown,
                    fileName,
                    dialogTitle: t('chat.exportConversation'),
                    mimeType: 'text/markdown',
                  });
                } catch {
                  // Export is best-effort
                }
              })();
            }
          }
        },
        onCompaction: (event) => {
          useChatStore.getState().applyConversationCompaction(convId, event.messages);
          appendConversationLog(convId, {
            kind: 'compaction',
            level: 'warning',
            title: 'Context compacted',
            detail: event.notice,
          });
        },
      };

      const orchestratorMessages = options?.additionalUserPrompt?.trim()
        ? [
            ...(conv?.messages ?? []),
            {
              id: generateId(),
              role: 'user' as const,
              content: options.additionalUserPrompt.trim(),
              timestamp: Date.now(),
            },
          ]
        : (conv?.messages ?? []);

      try {
        await runOrchestrator(
          {
            provider: { ...provider, apiKey },
            model,
            conversationId: convId,
            systemPrompt: options?.additionalSystemPrompt
              ? [conv?.systemPrompt || systemPrompt, options.additionalSystemPrompt]
                  .filter(Boolean)
                  .join('\n\n')
              : conv?.systemPrompt || systemPrompt,
            messages: orchestratorMessages,
            signal: abort,
            personaId: effectivePersonaId,
            allProviders: providers.map((p) => ({ ...p })),
            enableCompaction: true,
            enableFailover: true,
            thinkingLevel,
            linkUnderstandingEnabled,
            mediaUnderstandingEnabled,
            maxLinks,
            toolFilter: options?.disableTools ? () => false : undefined,
            internalUserMessageCount: options?.additionalUserPrompt?.trim() ? 1 : 0,
            initialPendingAsyncOperations: options?.initialPendingAsyncOperations,
          },
          callbacks,
        );
        if (completionPromise) {
          await completionPromise;
        }
      } catch (err: unknown) {
        commitAssistantBuffers(true);
        clearStreamingDraft(currentAssistantMsgId);
        const errMsg = err instanceof Error ? err.message : String(err);
        const visibleContent = getVisibleAssistantContent();
        if (!isAbortErrorLike(err, abort.signal)) {
          markCurrentAssistantDraftIncomplete(visibleContent, 'response_failed');
          didEncounterTerminalError = true;
          finalizeTrackedRun('failed', errMsg, 'Turn failed', errMsg);
          setChatError(errMsg);
          appendConversationLog(convId, {
            kind: 'error',
            level: 'error',
            title: 'Request failed',
            detail: errMsg,
          });
        } else {
          finalizeTrackedRun(
            'cancelled',
            'The current run was cancelled.',
            'Turn cancelled',
            'The current run was cancelled.',
          );
        }
        clearForegroundRequestIfCurrent();
      }
    },
    [
      activeModel,
      activeProviderId,
      providers,
      systemPrompt,
      t,
      createConversation,
      addMessage,
      updateMessage,
      updateMessageEnrichedContent,
      updateMessageReasoning,
      updateMessageProviderReplay,
      updateMessageAssistantMetadata,
      updateMessageEffect,
      addToolCall,
      updateToolCallStatus,
      appendConversationLog,
      linkUnderstandingEnabled,
      mediaUnderstandingEnabled,
      maxLinks,
      defaultConversationMode,
      effectivePersonaId,
      thinkingLevel,
      startAgentRun,
      setAgentRunPhase,
      appendAgentRunCheckpoint,
      updateAgentRunSummary,
      updateAgentRunPilotEvaluation,
      updateAgentRunPendingAsyncOperations,
      updateAgentRunPlan,
      setAgentRunAwaitingBackgroundWorkers,
      completeAgentRun,
      ensureAgentRunFinalResponse,
      clearStreamingDraft,
      mergeStreamingDraft,
      registerForegroundRequest,
      isCurrentForegroundRequest,
      clearForegroundRequest,
      resolveConversationStartDefaults,
      updateStreamingDraft,
    ],
  );

  resumeAgentRunRef.current = async ({
    conversationId,
    runId,
    additionalSystemPrompt,
    additionalUserPrompt,
    disableTools,
    initialPendingAsyncOperations,
  }) => {
    await runChat(conversationId, {
      reuseAgentRunId: runId,
      additionalSystemPrompt,
      additionalUserPrompt,
      disableTools,
      initialPendingAsyncOperations,
    });
  };

  useEffect(() => {
    resumeAgentRunRef.current = async ({
      conversationId,
      runId,
      additionalSystemPrompt,
      additionalUserPrompt,
      disableTools,
      initialPendingAsyncOperations,
    }) => {
      await runChat(conversationId, {
        reuseAgentRunId: runId,
        additionalSystemPrompt,
        additionalUserPrompt,
        disableTools,
        initialPendingAsyncOperations,
      });
    };

    return () => {
      resumeAgentRunRef.current = null;
    };
  }, [runChat]);

  const handleSend = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      setChatError(null);
      const draftKey = getComposerDraftKey(activeConversationId);

      let convId = activeConversationId;
      if (!convId) {
        const selection = resolveConversationStartDefaults();
        if (!selection) {
          setChatError(t('chat.noProvider'));
          return;
        }
        convId = createConversation(
          selection.providerId,
          systemPrompt,
          selection.model || undefined,
          {
            personaId: isAgenticMode ? SUPER_AGENT_PERSONA_ID : undefined,
            mode: defaultConversationMode,
          },
        );
      }

      let preparedAttachments = attachments;
      if (attachments?.length) {
        try {
          preparedAttachments = await Promise.all(
            attachments.map(
              async (attachment) =>
                (await importConversationWorkspaceAttachment(convId, attachment)).attachment,
            ),
          );
        } catch (error) {
          console.warn('Failed to import chat attachments into the conversation workspace.', error);
          setChatError(t('chat.attachmentWorkspaceImportFailed'));
          return;
        }
      }

      forceNextScrollRef.current = true;
      addMessage(convId, {
        id: generateId(),
        role: 'user',
        content: text,
        attachments: preparedAttachments,
      });

      clearComposerDraft(draftKey);

      await runChat(convId);
    },
    [
      activeConversationId,
      systemPrompt,
      isAgenticMode,
      defaultConversationMode,
      createConversation,
      addMessage,
      clearComposerDraft,
      resolveConversationStartDefaults,
      runChat,
      t,
    ],
  );

  const handleStop = useCallback(() => {
    if (activeConversationId) {
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === activeConversationId);
      const stopReason = 'Cancelled because the supervising turn was stopped by the user.';
      const runsToCancel = conversation
        ? getRunningConversationRunsForCancellation(conversation)
        : [];
      const cancelledWorkerCount = runsToCancel.reduce((count, run) => {
        const runWorkers = conversation ? getRunningLiveSubAgentsForRun(conversation, run.id) : [];
        const cancellationSummary = buildCancelledRunSummary(runWorkers.length);

        cancelAgentRunOperations(activeConversationId, run.id, stopReason);
        pendingAgentRunFinalizationsRef.current.delete(run.id);
        pendingAgentRunPilotResumesRef.current.delete(run.id);
        pendingAgentRunAsyncResumesRef.current.delete(run.id);
        completeAgentRun(
          activeConversationId,
          {
            status: 'cancelled',
            latestSummary: cancellationSummary,
            checkpointTitle: 'Turn cancelled',
            checkpointDetail: cancellationSummary,
          },
          run.id,
        );

        if (conversation) {
          cancelRunningSubAgentsForRun(conversation, run.id, stopReason);
        }

        return count + runWorkers.length;
      }, 0);
      const cancellationSummary = buildCancelledRunSummary(cancelledWorkerCount);

      appendConversationLog(activeConversationId, {
        kind: 'system',
        level: 'warning',
        title:
          cancelledWorkerCount > 0
            ? 'Generation stopped and workers cancelled'
            : 'Generation stopped',
        detail:
          runsToCancel.length > 0
            ? cancellationSummary
            : 'The current response was cancelled by the user.',
      });

      abortForegroundRequestForConversation(activeConversationId, stopReason);
      clearForegroundRequestForConversation(activeConversationId);
    }
    requestChatStorePersistenceCheckpoint();
  }, [
    abortForegroundRequestForConversation,
    activeConversationId,
    appendConversationLog,
    clearForegroundRequestForConversation,
    completeAgentRun,
  ]);

  const handleEdit = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  }, []);

  const handleResend = useCallback(async () => {
    setChatError(null);
    const convId = activeConversationId;
    if (!convId) return;
    await runChat(convId);
  }, [activeConversationId, runChat]);

  const handleEditSend = useCallback(
    (text: string, _attachments?: Attachment[]) => {
      if (editingMessageId && activeConversationId) {
        cancelConversationRunForRewind(
          activeConversationId,
          'Cancelled because the active run was rewound for an edited resend.',
        );
        editMessage(activeConversationId, editingMessageId, text);
        setEditingMessageId(null);
        setEditingContent(undefined);
        // Re-trigger the orchestrator: editMessage already updated the user
        // message in place and truncated subsequent messages, so we just need
        // to stream a new assistant reply without adding another user message.
        handleResend();
      }
    },
    [
      cancelConversationRunForRewind,
      editingMessageId,
      activeConversationId,
      editMessage,
      handleResend,
    ],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!activeConversation || !activeConversationId) return;
      const msgIndex = activeConversation.messages.findIndex((m) => m.id === messageId);
      if (msgIndex <= 0) return;
      const previousUserMessage = [...activeConversation.messages.slice(0, msgIndex)]
        .reverse()
        .find((message) => message.role === 'user');
      if (!previousUserMessage) return;
      // Trim the conversation back to the user turn that produced this response, then re-run.
      cancelConversationRunForRewind(
        activeConversationId,
        'Cancelled because the active run was rewound for a retry.',
      );
      editMessage(activeConversationId, previousUserMessage.id, previousUserMessage.content);
      handleResend();
    },
    [
      activeConversation,
      activeConversationId,
      cancelConversationRunForRewind,
      editMessage,
      handleResend,
    ],
  );

  const handleModelSelect = useCallback(
    (providerId: string, model: string) => {
      setActiveProviderAndModel(providerId, model);
      if (activeConversationId) {
        updateModelInConversation(activeConversationId, providerId, model);
      }
      setLastUsedModel(providerId, model);
    },
    [activeConversationId, updateModelInConversation, setActiveProviderAndModel, setLastUsedModel],
  );

  const handlePersonaSelect = useCallback(
    (personaId: string) => {
      let convId = activeConversationId;
      if (!convId) {
        const selection = resolveConversationStartDefaults();
        if (!selection) {
          setChatError(t('chat.noProvider'));
          return;
        }
        convId = createConversation(
          selection.providerId,
          systemPrompt,
          selection.model || undefined,
          {
            personaId,
            mode: personaId === SUPER_AGENT_PERSONA_ID ? 'agentic' : 'direct',
          },
        );
      }

      if (convId) {
        updatePersonaInConversation(convId, personaId);
        // Manually selecting a persona implies direct mode (unless it's super-agent)
        updateModeInConversation(
          convId,
          personaId === SUPER_AGENT_PERSONA_ID ? 'agentic' : 'direct',
        );
      }
    },
    [
      activeConversationId,
      createConversation,
      resolveConversationStartDefaults,
      systemPrompt,
      updatePersonaInConversation,
      updateModeInConversation,
      t,
    ],
  );

  const handleToggleMode = useCallback(() => {
    const nextMode = isAgenticMode ? 'direct' : 'agentic';
    let convId = activeConversationId;
    if (!convId) {
      const selection = resolveConversationStartDefaults();
      if (!selection) {
        setChatError(t('chat.noProvider'));
        return;
      }
      convId = createConversation(
        selection.providerId,
        systemPrompt,
        selection.model || undefined,
        {
          personaId: nextMode === 'agentic' ? SUPER_AGENT_PERSONA_ID : 'default',
          mode: nextMode,
        },
      );
    }
    if (convId) {
      // Atomic update: mode + persona together to prevent partial state
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      const nextPersonaId =
        nextMode === 'agentic'
          ? SUPER_AGENT_PERSONA_ID
          : conv?.personaId && conv.personaId !== SUPER_AGENT_PERSONA_ID
            ? conv.personaId
            : 'default';
      useChatStore.setState((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === convId ? { ...c, mode: nextMode, personaId: nextPersonaId } : c,
        ),
      }));
    }
  }, [
    isAgenticMode,
    activeConversationId,
    createConversation,
    resolveConversationStartDefaults,
    systemPrompt,
    t,
  ]);

  const messages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation?.messages],
  );
  const availableSubAgentSnapshotsById = useMemo(() => {
    const snapshotsById = new Map<string, NonNullable<Message['subAgentEvent']>['snapshot']>();

    for (const snapshot of collectSubAgentSnapshotsFromMessages(messages)) {
      snapshotsById.set(snapshot.sessionId, snapshot);
    }

    for (const liveSnapshot of liveSubAgentSnapshotsById.values()) {
      const existingSnapshot = snapshotsById.get(liveSnapshot.sessionId);
      snapshotsById.set(
        liveSnapshot.sessionId,
        existingSnapshot
          ? resolveDisplayedSubAgentSnapshot(existingSnapshot, liveSnapshot)
          : cloneSubAgentSnapshot(liveSnapshot),
      );
    }

    return snapshotsById;
  }, [liveSubAgentSnapshotsById, messages]);
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const displayMessages = useMemo(() => {
    return getStableDisplayMessages(messages, displayStateCacheRef.current);
  }, [messages]);
  const agentRunByDisplayItemId = useMemo(
    () =>
      buildAgentRunDisplayItemMap(messages, displayMessages, activeConversation?.agentRuns ?? []),
    [activeConversation?.agentRuns, displayMessages, messages],
  );
  const streamingDraftState = useMemo(
    () => ({ version: streamingDraftVersion, drafts: streamingDraftsRef.current }),
    [streamingDraftVersion],
  );
  const resolvedDisplayMessages = useMemo(() => {
    return resolveDisplayMessages({
      displayMessages,
      messageById,
      cache: displayStateCacheRef.current,
      streamingDrafts: streamingDraftState.drafts,
      streamingMessageId,
      liveSubAgentSnapshotsById,
      agentRunByDisplayItemId,
    });
  }, [
    agentRunByDisplayItemId,
    displayMessages,
    liveSubAgentSnapshotsById,
    messageById,
    streamingDraftState,
    streamingMessageId,
  ]);

  const usageSummary = activeConversation?.usage;
  const usageTotals = {
    totalTokens: usageSummary?.totalTokens ?? 0,
    totalInput: usageSummary?.totalInput ?? 0,
    totalOutput: usageSummary?.totalOutput ?? 0,
    totalCacheRead: usageSummary?.totalCacheRead ?? 0,
    totalCacheWrite: usageSummary?.totalCacheWrite ?? 0,
    totalCost: usageSummary?.totalCost ?? 0,
    totalCalls: usageSummary?.totalCalls ?? 0,
  };
  const usageCacheSummary = getUsageCacheSummary({
    inputTokens: usageTotals.totalInput,
    cacheReadTokens: usageTotals.totalCacheRead,
    cacheWriteTokens: usageTotals.totalCacheWrite,
  });
  const conversationLogs = activeConversation?.logs;
  const visibleConversationLogs = useMemo(
    () => [...(conversationLogs ?? [])].reverse(),
    [conversationLogs],
  );
  const usageDetailText =
    usageTotals.totalCalls > 0
      ? `In ${formatTokenCount(usageTotals.totalInput)} · Out ${formatTokenCount(usageTotals.totalOutput)} · ${t('chat.usageCache')} ${formatTokenCount(usageCacheSummary.cacheReadTokens)} / ${formatTokenCount(usageCacheSummary.cacheDenominatorTokens)}${usageCacheSummary.cacheWriteTokens > 0 ? ` · write ${formatTokenCount(usageCacheSummary.cacheWriteTokens)}` : ''}`
      : t('chat.noUsageYet');

  useEffect(() => {
    if (resolvedDisplayMessages.length > previousVisibleCountRef.current) {
      maybeScrollToBottom(!streamingMessageId);
    }

    previousVisibleCountRef.current = resolvedDisplayMessages.length;
  }, [maybeScrollToBottom, resolvedDisplayMessages.length, streamingMessageId]);

  const workspaceFallbackConversationIds = useMemo(
    () =>
      getConversationWorkspaceFallbackConversationIds({
        conversationId: activeConversationId,
        messages: activeConversation?.messages,
        usageEntries: activeConversation?.usage?.entries,
        agentRuns: activeConversation?.agentRuns,
      }),
    [
      activeConversation?.agentRuns,
      activeConversation?.messages,
      activeConversation?.usage?.entries,
      activeConversationId,
    ],
  );

  const handleViewFiles = useCallback(
    (path?: string) => {
      if (!activeConversationId) {
        return;
      }

      navigation.navigate('ConversationFiles' as any, {
        conversationId: activeConversationId,
        initialFilePath: path ?? undefined,
      });
    },
    [activeConversationId, navigation],
  );
  const handleShareWorkspaceFile = useCallback(
    async (attachment: Attachment) => {
      if (!activeConversationId || !attachment.workspacePath) {
        return;
      }

      try {
        await shareConversationWorkspaceFile({
          conversationId: activeConversationId,
          path: attachment.workspacePath,
          fallbackConversationIds: workspaceFallbackConversationIds,
          dialogTitle: attachment.name || t('common.share'),
          mimeType: attachment.mimeType,
        });
        setChatError(null);
      } catch (error) {
        setChatError(error instanceof Error ? error.message : t('chat.shareFileFailed'));
      }
    },
    [activeConversationId, t, workspaceFallbackConversationIds],
  );
  const handleOpenSubAgentDetails = useCallback(
    (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => {
      setSelectedSubAgentSnapshot(snapshot);
    },
    [],
  );
  const renderMessageItem = useCallback(
    ({ item }: { item: ResolvedDisplayMessageItem }) => {
      return (
        <MessageBubble
          message={item.resolvedMessage}
          agentRun={item.agentRun}
          isStreaming={item.isStreaming}
          responseSegments={item.resolvedResponseSegments}
          onEdit={handleEdit}
          onRetry={handleRetry}
          onViewFile={handleViewFiles}
          onShareWorkspaceFile={handleShareWorkspaceFile}
          onOpenSubAgentDetails={handleOpenSubAgentDetails}
          retryMessageId={item.retryMessageId}
        />
      );
    },
    [handleEdit, handleOpenSubAgentDetails, handleRetry, handleShareWorkspaceFile, handleViewFiles],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SubAgentDetailModal
        visible={!!selectedSubAgentSnapshot}
        selectedSnapshot={selectedSubAgentSnapshot}
        availableSnapshots={Array.from(availableSubAgentSnapshotsById.values())}
        onClose={() => setSelectedSubAgentSnapshot(null)}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerMenuButton}
          onPress={() => navigation.openDrawer()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('chat.openMenu')}
        >
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerControls}>
            <TouchableOpacity
              onPress={handleToggleMode}
              disabled={isConversationBusy}
              style={[
                styles.modeBadge,
                isAgenticMode ? styles.modeBadgeAgentic : styles.modeBadgeDirect,
                isConversationBusy && { opacity: 0.5 },
              ]}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: isAgenticMode }}
              accessibilityLabel={t('chat.conversationModeAccessibility', {
                current: isAgenticMode ? t('chat.agenticModeLabel') : t('chat.directModeLabel'),
                next: isAgenticMode ? t('chat.directModeLabel') : t('chat.agenticModeLabel'),
              })}
              accessibilityHint={t('chat.conversationModeSwitchHint')}
            >
              <Text
                style={[
                  styles.modeBadgeText,
                  isAgenticMode ? styles.modeBadgeTextAgentic : styles.modeBadgeTextDirect,
                ]}
                numberOfLines={1}
              >
                {isAgenticMode ? t('chat.agenticModeChip') : t('chat.directModeChip')}
              </Text>
            </TouchableOpacity>
            {!isAgenticMode && (
              <View style={styles.headerPersonaSelector}>
                <PersonaSelector
                  selectedPersonaId={activeConversation?.personaId || 'default'}
                  onSelect={handlePersonaSelect}
                />
              </View>
            )}
            <View style={styles.headerModelSelector}>
              <ModelSelector
                selectedProviderId={activeConversation?.providerId || activeProviderId}
                selectedModel={currentModel}
                onSelect={handleModelSelect}
              />
              {activeLocalRuntimeStatus ? (
                <View
                  style={[
                    styles.headerRuntimeBadge,
                    activeLocalRuntimeStatus.activeBackend === 'gpu'
                      ? styles.headerRuntimeBadgeGpu
                      : styles.headerRuntimeBadgeCpu,
                  ]}
                >
                  <Cpu
                    size={11}
                    color={
                      activeLocalRuntimeStatus.activeBackend === 'gpu'
                        ? colors.primary
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.headerRuntimeBadgeText,
                      activeLocalRuntimeStatus.activeBackend === 'gpu'
                        ? styles.headerRuntimeBadgeTextGpu
                        : styles.headerRuntimeBadgeTextCpu,
                    ]}
                    numberOfLines={1}
                  >
                    {formatLocalRuntimeBadgeLabel(activeLocalRuntimeStatus)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => handleViewFiles()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('nav.files')}
          >
            <FolderOpen size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Terminal' as any)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('nav.terminal')}
          >
            <Terminal size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {activeErrorMessage && (
        <View style={styles.errorBanner}>
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={styles.errorText} numberOfLines={2}>
            {activeErrorMessage}
          </Text>
        </View>
      )}

      <ApprovalBanner />

      {activeConversation && (
        <View style={styles.telemetryCard} testID="chat-usage-strip">
          <View style={styles.telemetryRow}>
            <View style={styles.telemetryMetric}>
              <Text style={styles.telemetryLabel}>{t('chat.usageTokens')}</Text>
              <Text style={styles.telemetryValue}>{formatTokenCount(usageTotals.totalTokens)}</Text>
            </View>
            <View style={styles.telemetryMetric}>
              <Text style={styles.telemetryLabel}>{t('chat.usageCost')}</Text>
              <Text style={styles.telemetryValue}>{formatUsdCost(usageTotals.totalCost)}</Text>
            </View>
            <View style={styles.telemetryMetric}>
              <Text style={styles.telemetryLabel}>{t('chat.usageCalls')}</Text>
              <Text style={styles.telemetryValue}>{String(usageTotals.totalCalls)}</Text>
            </View>
          </View>

          <View style={styles.telemetryFooter}>
            <Text style={styles.telemetryMeta} numberOfLines={2}>
              {usageDetailText}
            </Text>
            <TouchableOpacity
              testID="chat-logs-toggle"
              style={styles.logsToggle}
              onPress={() => setShowLogs((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={showLogs ? t('chat.hideLogs') : t('chat.showLogs')}
            >
              <Text style={styles.logsToggleText}>
                {showLogs ? t('chat.hideLogs') : t('chat.showLogs')}
              </Text>
              <View style={styles.logsToggleBadge}>
                <Text style={styles.logsToggleBadgeText}>
                  {String((conversationLogs ?? []).length)}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {activeConversation && showLogs && (
        <View style={styles.logsPanel} testID="chat-logs-panel">
          <View style={styles.logsHeader}>
            <Text style={styles.logsTitle}>{t('chat.latestLogs')}</Text>
            <Text
              style={styles.logsCount}
            >{`${visibleConversationLogs.length}/${(conversationLogs ?? []).length}`}</Text>
          </View>

          {visibleConversationLogs.length > 0 ? (
            <ScrollView
              testID="chat-logs-scroll"
              style={styles.logsScroll}
              contentContainerStyle={styles.logsScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {visibleConversationLogs.map((entry) => {
                const accentColor =
                  entry.level === 'error'
                    ? colors.danger
                    : entry.level === 'success'
                      ? colors.primary
                      : colors.textSecondary;

                return (
                  <View key={entry.id} style={styles.logEntry}>
                    <View style={styles.logMetaRow}>
                      <View style={[styles.logKindBadge, { borderColor: accentColor }]}>
                        <Text style={[styles.logKindText, { color: accentColor }]}>
                          {formatLogKindLabel(entry.kind)}
                        </Text>
                      </View>
                      <Text style={styles.logTimestamp}>
                        {formatConversationLogTime(entry.timestamp)}
                      </Text>
                    </View>
                    <Text style={styles.logTitle}>{entry.title}</Text>
                    {entry.detail ? <Text style={styles.logDetail}>{entry.detail}</Text> : null}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.logsEmpty}>{t('chat.logsEmpty')}</Text>
          )}
        </View>
      )}

      {/* Messages */}
      <View style={styles.body}>
        <FlatList
          ref={flatListRef}
          data={resolvedDisplayMessages}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          contentContainerStyle={[
            styles.messageList,
            resolvedDisplayMessages.length === 0 ? styles.messageListEmpty : null,
          ]}
          maxToRenderPerBatch={15}
          updateCellsBatchingPeriod={50}
          initialNumToRender={20}
          windowSize={10}
          removeClippedSubviews={false}
          onLayout={(event) => {
            listMetricsRef.current.layoutHeight = event.nativeEvent.layout.height;
            updateAutoFollowState();
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            listMetricsRef.current = {
              contentHeight: contentSize.height,
              layoutHeight: layoutMeasurement.height,
              offsetY: contentOffset.y,
            };
            updateAutoFollowState();
          }}
          onScrollBeginDrag={handleUserScrollStart}
          onScrollEndDrag={() => {
            clearInteractionReleaseTimer();
            interactionReleaseTimerRef.current = setTimeout(() => {
              handleUserScrollEnd();
            }, USER_SCROLL_RELEASE_DELAY_MS);
          }}
          onMomentumScrollBegin={handleUserScrollStart}
          onMomentumScrollEnd={handleUserScrollEnd}
          onContentSizeChange={(_width, height) => {
            listMetricsRef.current.contentHeight = height;
            if (streamingMessageId) {
              // During streaming, always try to scroll if user hasn't
              // deliberately scrolled away (force-scroll or auto-follow).
              // Skip the isUserInteracting guard since momentum scroll
              // during streaming should not permanently block auto-follow.
              if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
                scrollToBottom(false);
                forceNextScrollRef.current = false;
              }
            } else if (forceNextScrollRef.current || shouldAutoFollowRef.current) {
              maybeScrollToBottom(false);
            }
          }}
          scrollEventThrottle={16}
          renderItem={renderMessageItem}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('common.appName')}</Text>
              <Text style={styles.emptySubtitle}>{t('chat.emptyState')}</Text>
              <Text style={styles.emptyHint}>{t('chat.emptyStateHint')}</Text>
            </View>
          }
        />

        <ChatInput
          onSend={editingMessageId ? handleEditSend : handleSend}
          onStop={handleStop}
          isLoading={isConversationBusy}
          isInputDisabled={isLocalModelInitializing}
          text={composerText}
          onChangeText={handleComposerTextChange}
          attachments={composerAttachments}
          onChangeAttachments={handleComposerAttachmentsChange}
          isEditing={editingMessageId !== null}
          supportsVision={supportsVision}
          bottomInset={insets.bottom}
          onCancelEdit={() => {
            setEditingMessageId(null);
            setEditingContent(undefined);
          }}
        />

        {isLocalModelInitializing ? (
          <View style={styles.localModelInitOverlay} testID="local-model-init-overlay">
            <View style={styles.localModelInitCard}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.localModelInitTitle}>
                {t('chat.localModelInitializingTitle')}
              </Text>
              <Text style={styles.localModelInitBody}>{t('chat.localModelInitializingBody')}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    body: {
      flex: 1,
    },
    localModelInitOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: colors.background,
    },
    localModelInitCard: {
      width: '100%',
      maxWidth: 320,
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 24,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    localModelInitTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    localModelInitBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerCenter: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      marginHorizontal: 12,
    },
    headerControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      minWidth: 0,
    },
    headerMenuButton: {
      flexShrink: 0,
      width: 28,
      alignItems: 'flex-start',
    },
    modeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      flexShrink: 0,
    },
    modeBadgeAgentic: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    modeBadgeDirect: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    modeBadgeText: {
      fontSize: 12,
      fontWeight: '700',
    },
    modeBadgeTextAgentic: {
      color: colors.primary,
    },
    modeBadgeTextDirect: {
      color: colors.textSecondary,
    },
    headerPersonaSelector: {
      flexShrink: 0,
    },
    headerModelSelector: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
      gap: 4,
    },
    headerRuntimeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      maxWidth: '100%',
    },
    headerRuntimeBadgeGpu: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    headerRuntimeBadgeCpu: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    headerRuntimeBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      flexShrink: 1,
    },
    headerRuntimeBadgeTextGpu: {
      color: colors.primary,
    },
    headerRuntimeBadgeTextCpu: {
      color: colors.textSecondary,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      flexShrink: 0,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      color: colors.danger,
    },
    telemetryCard: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    telemetryRow: {
      flexDirection: 'row',
      gap: 12,
    },
    telemetryMetric: {
      flex: 1,
    },
    telemetryLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    telemetryValue: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    telemetryFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    telemetryMeta: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    logsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    logsToggleText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    logsToggleBadge: {
      minWidth: 24,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
    },
    logsToggleBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
    },
    logsPanel: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    logsScroll: {
      maxHeight: MAX_LOG_PANEL_HEIGHT,
    },
    logsScrollContent: {
      paddingBottom: 4,
    },
    logsHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    logsTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    logsCount: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    logEntry: {
      gap: 6,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    logMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    logKindBadge: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    logKindText: {
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    logTimestamp: {
      fontSize: 11,
      color: colors.textTertiary,
    },
    logTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    logDetail: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    logsEmpty: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    messageList: {
      paddingVertical: 8,
      paddingBottom: 16,
    },
    messageListEmpty: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    emptyTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    emptySubtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    emptyHint: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
