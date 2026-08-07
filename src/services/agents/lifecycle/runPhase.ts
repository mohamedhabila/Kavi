import type { Message } from '../../../types/message';
import type {
  SubAgentResult,
  SubAgentSnapshot,
  SubAgentTerminationCause,
} from '../../../types/subAgent';
import { generateId } from '../../../utils/id';
import { createSubAgentExecutionSession } from '../subAgentExecutionSession';
import type { SubAgentExecutionRuntimeState } from '../subAgentOrchestratorCallbacks';
import { runSubAgentOrchestratorLoop } from '../subAgentOrchestratorRun';
import { finalizeCompletedSubAgentRun, finalizeFailedSubAgentRun } from './terminalizePhase';
import { resolveSubAgentRunOutput } from './terminalOutputResolution';
import type { ActiveSubAgentRunControl } from './phases';
import type { RunPreparedSubAgentSessionParams } from './runPhaseTypes';
import { normalizeSubAgentPrompt } from './sessionContextMessages';
import {
  buildInitialSubAgentMessages,
  buildSubAgentSystemPrompt,
  OUTPUT_TRUNCATION,
  resolveCurrentTaskPrompt,
} from './runConfig';
import { normalizePreviewText } from './runText';
import { createSubAgentUsageRecorder } from './runUsage';
import { resolveSubAgentToolAccess } from '../subAgentToolAccess';
import { pushTask, completeTask } from '../../memory/taskStack';
import {
  requireExactDurableScopeId,
  resolveOptionalExactDurableScopeId,
} from '../../../utils/durableScopeIdentity';
import { isWorkerMemoryToolName } from '../workerMemoryBundle';
import { isExactMemoryProvenanceId } from '../../memory/memoryProvenanceIdentity';
import type { VerifiedProcedureMemoryLineage } from '../../memory/verifiedProcedure/provenanceHash';

function lastExactMessageId(
  messages: readonly Message[],
  role: Message['role'],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === role && isExactMemoryProvenanceId(message.id)) {
      return message.id;
    }
  }
  return undefined;
}

function resolveVerifiedProcedureMemoryLineage(params: {
  requestMessages: readonly Message[];
  sessionId: string;
  taskId: string | null;
  transcriptMessages: readonly Message[];
}): VerifiedProcedureMemoryLineage | undefined {
  const sourceMessageId = lastExactMessageId(params.requestMessages, 'user');
  const sourceTurnId = lastExactMessageId(params.transcriptMessages, 'assistant');
  if (!sourceMessageId || !sourceTurnId || !isExactMemoryProvenanceId(params.sessionId)) {
    return undefined;
  }
  return {
    sourceMessageId,
    sourceRunId: params.sessionId,
    sourceTurnId,
    taskId: params.taskId,
  };
}

export async function runPreparedSubAgentSession<TAgent extends SubAgentSnapshot>(
  params: RunPreparedSubAgentSessionParams<TAgent>,
): Promise<SubAgentResult> {
  const { sessionId, depth, maxIterations, timeoutMs, sandboxPolicy, subAgent } = params.prepared;

  const messages = buildInitialSubAgentMessages(params.config);
  const transcriptMessages: Message[] = messages.map((message) =>
    params.sanitizeTranscriptMessage(message),
  );
  const currentTaskPrompt = resolveCurrentTaskPrompt(
    messages,
    normalizeSubAgentPrompt(params.config.prompt) || '',
  );
  const {
    explicitToolSelectionRejectedMessage,
    disableToolingForExplicitEmptyToolSurface,
    explicitToolSurfaceToolNames,
    toolFilter,
  } = resolveSubAgentToolAccess({
    tools: params.config.tools,
    sandboxPolicy,
  });
  const configuredMemoryTool = params.config.tools?.find(isWorkerMemoryToolName);
  const workerToolFilter = (toolName: string): boolean =>
    !isWorkerMemoryToolName(toolName) && (toolFilter ? toolFilter(toolName) : true);
  const workerToolSelectionRejectedMessage = configuredMemoryTool
    ? `Worker memory tool "${configuredMemoryTool}" is unavailable. Parent memory is provided only through a task-scoped evidence bundle.`
    : explicitToolSelectionRejectedMessage;
  const workspaceConversationId =
    resolveOptionalExactDurableScopeId(
      params.config.workspaceConversationId,
      'sub_agent_workspace_id_invalid',
    ) ??
    requireExactDurableScopeId(
      params.config.parentConversationId,
      'sub_agent_parent_conversation_id_invalid',
    );
  const workspaceReadFallbackConversationId =
    resolveOptionalExactDurableScopeId(
      params.config.workspaceReadFallbackConversationId,
      'sub_agent_workspace_fallback_id_invalid',
    ) ?? requireExactDurableScopeId(sessionId, 'sub_agent_session_id_invalid');
  const recordParentConversationUsage = createSubAgentUsageRecorder({
    config: params.config,
    provider: params.provider,
    sessionId,
  });

  const runtimeState: SubAgentExecutionRuntimeState = {
    outputText: '',
    lastNonEmptyContent: '',
    finalNonEmptyContent: '',
    lastSubstantiveToolResult: '',
    iterations: subAgent.iterations ?? 0,
    lastTokenHeartbeatAt: 0,
    lastTaskLedgerSignature: '',
    toolsUsed: subAgent.toolsUsed ? [...subAgent.toolsUsed] : [],
    toolResultPreviews: [],
  };
  let terminalCompletionState: SubAgentResult['completionState'];
  let failureCause: Extract<
    SubAgentTerminationCause,
    'tool_failure' | 'internal_failure' | 'unknown'
  > = workerToolSelectionRejectedMessage ? 'tool_failure' : 'unknown';
  // Keyed on what the scoping goal asks for, not on whether a workstream exists.
  // `sessions_spawn` requires a workstreamId, so keying on its presence held every
  // delegated worker to the execution-evidence bar — including one asked only to return
  // an answer, which makes no state-changing calls and so can never clear it.
  const requireStructuredExecutionEvidence =
    Boolean(params.config.workstreamId?.trim()) && params.config.deliverableKind !== 'information';
  const systemPrompt = buildSubAgentSystemPrompt(params.config, depth);
  const { transcriptToolCalls, checkpointSessionContext, persistSessionContextNow, trackToolCall } =
    createSubAgentExecutionSession({
      sessionId,
      config: params.config,
      provider: params.provider,
      allProviders: params.allProviders,
      systemPrompt,
      messages: transcriptMessages,
      getIteration: () => runtimeState.iterations,
      scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
      clearPendingSessionContextCheckpoint: params.clearPendingSessionContextCheckpoint,
      clearSessionContextEviction: params.clearSessionContextEviction,
      storeSessionContext: params.storeSessionContext,
      scheduleRegistryPersist: params.scheduleRegistryPersist,
    });
  checkpointSessionContext();
  params.updateAgentProgress(subAgent, {
    currentActivity: 'Bootstrapping worker',
    launchState: 'bootstrapping',
  });

  const resolveWorkerOutput = async (
    status: SubAgentResult['status'],
  ): Promise<SubAgentResult['completionState']> => {
    const resolvedOutput = await resolveSubAgentRunOutput({
      status,
      provider: params.provider,
      model: params.config.model || params.provider.model,
      systemPrompt,
      currentTaskPrompt,
      outputText: runtimeState.outputText,
      lastNonEmptyContent: runtimeState.lastNonEmptyContent,
      finalNonEmptyContent: runtimeState.finalNonEmptyContent,
      lastSubstantiveToolResult: runtimeState.lastSubstantiveToolResult,
      toolsUsed: runtimeState.toolsUsed,
      toolResultPreviews: runtimeState.toolResultPreviews,
      transcriptMessages,
      iterations: runtimeState.iterations,
      startedAt: subAgent.startedAt,
      timeoutMs,
      outputTruncation: OUTPUT_TRUNCATION,
      requireStructuredExecutionEvidence,
      maxToolResultPreviewChars: params.maxToolResultPreviewChars,
      finalizationMaxTranscriptMessages: params.finalizationMaxTranscriptMessages,
      finalizationMessageCharLimit: params.finalizationMessageCharLimit,
      finalizationToolContentCharLimit: params.finalizationToolContentCharLimit,
      finalizationMinRemainingMs: params.finalizationMinRemainingMs,
      finalizationTimeoutCapMs: params.finalizationTimeoutCapMs,
      reportUsage: (usage) => {
        recordParentConversationUsage(usage, 'sub-agent-finalizer', { recordSessionUsage: true });
      },
      onFinalizationStart: () => {
        params.updateAgentProgress(
          subAgent,
          {
            currentActivity: 'Finalizing verified findings',
            launchState: 'finalizing',
            activeToolName: undefined,
            activeToolStartedAt: undefined,
          },
          {
            activityKind: 'status',
            activityText: 'Finalizing verified findings',
          },
        );
      },
      onFinalizedOutput: (contractSafeOutput) => {
        params.appendTranscriptMessage(transcriptMessages, {
          id: generateId(),
          role: 'assistant',
          content: contractSafeOutput,
          timestamp: Date.now(),
        });
        params.appendActivity(subAgent, 'message', contractSafeOutput);
      },
    });
    runtimeState.outputText = resolvedOutput.output;
    return resolvedOutput.completionState;
  };

  const abortController = new AbortController();
  const runControl: ActiveSubAgentRunControl = { abortController };
  params.activeRunControls.set(sessionId, runControl);
  const timeoutTimer =
    timeoutMs != null
      ? setTimeout(() => {
          runControl.abortReason = 'timeout';
          abortController.abort();
        }, timeoutMs)
      : undefined;
  (timeoutTimer as any)?.unref?.();

  // Push task onto the conversation stack so memory recall is scoped.
  let taskStackEntry: ReturnType<typeof pushTask> | null = null;
  if (params.config.parentConversationId) {
    const title =
      params.config.name?.trim() || currentTaskPrompt.trim().slice(0, 80) || 'Sub-agent task';
    try {
      taskStackEntry = pushTask(params.config.parentConversationId, title);
    } catch {
      // Task-stack failure is best-effort; never break sub-agent execution.
    }
  }

  try {
    const workerModel = params.config.model || params.provider.model;
    const orchestratorResult = await runSubAgentOrchestratorLoop({
      provider: params.provider,
      model: workerModel,
      sessionId,
      usageConversationId: params.config.parentConversationId,
      workspaceConversationId,
      workspaceReadFallbackConversationId,
      systemPrompt,
      messages,
      allProviders: params.allProviders,
      disableTooling: disableToolingForExplicitEmptyToolSurface,
      explicitToolSurfaceToolNames,
      toolFilter: workerToolFilter,
      linkUnderstandingEnabled: params.config.linkUnderstandingEnabled,
      mediaUnderstandingEnabled: params.config.mediaUnderstandingEnabled,
      explicitToolSelectionRejectedMessage: workerToolSelectionRejectedMessage,
      taskId: params.config.workstreamId,
      subAgent,
      config: params.config,
      runtimeState,
      maxIterations,
      maxToolResultPreviewChars: params.maxToolResultPreviewChars,
      runControl,
      abortController,
      transcriptMessages,
      transcriptToolCalls,
      trackToolCall,
      persistSessionContextNow,
      checkpointSessionContext,
      markModelResponseObserved: params.markModelResponseObserved,
      refreshSubAgentArtifacts: params.refreshSubAgentArtifacts,
      appendTranscriptMessage: params.appendTranscriptMessage,
      appendActivity: params.appendActivity,
      updateAgentProgress: params.updateAgentProgress,
      recordUsage: (usage) => {
        recordParentConversationUsage(usage, 'sub-agent');
      },
    });

    failureCause = 'unknown';
    terminalCompletionState = await resolveWorkerOutput('completed');
    const pendingVerifiedProcedureObservation =
      orchestratorResult.terminalDisposition === 'final_candidate' &&
      terminalCompletionState === 'verified_success' &&
      !abortController.signal.aborted
        ? orchestratorResult.pendingVerifiedProcedureObservation
        : undefined;
    const verifiedProcedureMemoryLineage = pendingVerifiedProcedureObservation
      ? resolveVerifiedProcedureMemoryLineage({
          requestMessages: messages,
          sessionId,
          taskId: params.config.workstreamId ?? null,
          transcriptMessages,
        })
      : undefined;

    failureCause = 'internal_failure';
    return finalizeCompletedSubAgentRun({
      sessionId,
      depth,
      config: params.config,
      provider: params.provider,
      allProviders: params.allProviders,
      systemPrompt,
      transcriptMessages,
      output: runtimeState.outputText,
      completionState: terminalCompletionState,
      toolsUsed: runtimeState.toolsUsed,
      iterations: runtimeState.iterations,
      subAgent,
      outputTruncation: OUTPUT_TRUNCATION,
      shouldAnnounce: params.config.announce !== false,
      refreshArtifacts: params.refreshSubAgentArtifacts,
      signalTerminal: params.signalTerminal,
      scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
      persistRegistryBestEffort: params.persistRegistryBestEffort,
      scheduleSessionContextEvictionWhenDurable: params.scheduleSessionContextEvictionWhenDurable,
      pendingVerifiedProcedureCommit:
        pendingVerifiedProcedureObservation && verifiedProcedureMemoryLineage
          ? {
              memoryLineage: verifiedProcedureMemoryLineage,
              observation: pendingVerifiedProcedureObservation,
            }
          : undefined,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const storedRunControl = params.activeRunControls.get(sessionId);
    const abortReason = storedRunControl?.abortReason;
    const isCancelled =
      abortReason === 'cancelled' ||
      (typeof storedRunControl?.cancelReason === 'string' &&
        storedRunControl.cancelReason.trim().length > 0);
    const isTimeout =
      abortReason === 'timeout' ||
      (!isCancelled &&
        !abortReason &&
        ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted));
    const isIterationLimit = abortReason === 'max-iterations';
    const status = isCancelled ? 'cancelled' : isTimeout ? 'timeout' : 'error';
    const terminalMessage = isCancelled
      ? storedRunControl?.cancelReason || 'Cancelled by supervisor.'
      : isTimeout
        ? 'Worker reached its configured deadline before completion.'
        : isIterationLimit
          ? `Worker reached maxIterations (${maxIterations}) before completion.`
          : `Worker failed: ${errMsg}`;
    const errorMessage =
      status === 'cancelled' ? undefined : isTimeout || isIterationLimit ? terminalMessage : errMsg;
    const terminationCause: Exclude<SubAgentTerminationCause, 'completed'> = isCancelled
      ? 'cancelled'
      : isTimeout
        ? 'timeout'
        : isIterationLimit
          ? 'iteration_limit'
          : failureCause;

    failureCause = 'unknown';
    terminalCompletionState = await resolveWorkerOutput(status);

    failureCause = 'internal_failure';
    return finalizeFailedSubAgentRun({
      sessionId,
      depth,
      config: params.config,
      provider: params.provider,
      allProviders: params.allProviders,
      systemPrompt,
      transcriptMessages,
      output: runtimeState.outputText,
      completionState: terminalCompletionState,
      toolsUsed: runtimeState.toolsUsed,
      iterations: runtimeState.iterations,
      status,
      terminationCause,
      error: errorMessage,
      terminalMessage,
      subAgent,
      outputTruncation: OUTPUT_TRUNCATION,
      maxToolResultPreviewChars: params.maxToolResultPreviewChars,
      shouldAnnounce: params.config.announce !== false,
      refreshArtifacts: params.refreshSubAgentArtifacts,
      appendActivity: params.appendActivity,
      normalizePreviewText,
      signalTerminal: params.signalTerminal,
      scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
      persistRegistryBestEffort: params.persistRegistryBestEffort,
      scheduleSessionContextEvictionWhenDurable: params.scheduleSessionContextEvictionWhenDurable,
    });
  } finally {
    if (taskStackEntry && params.config.parentConversationId) {
      try {
        completeTask(params.config.parentConversationId, taskStackEntry.id);
      } catch {
        // Best-effort; never break the teardown path.
      }
    }
    params.activeRunControls.delete(sessionId);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
}
