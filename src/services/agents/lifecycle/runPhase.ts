import type { Message } from '../../../types/message';
import type { SubAgentResult, SubAgentSnapshot } from '../../../types/subAgent';
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
    toolFilter,
  } = resolveSubAgentToolAccess({
    tools: params.config.tools,
    sandboxPolicy,
  });
  const workspaceConversationId =
    params.config.workspaceConversationId?.trim() || params.config.parentConversationId;
  const workspaceReadFallbackConversationId =
    params.config.workspaceReadFallbackConversationId?.trim() || sessionId;
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
    iterations: 0,
    lastTokenHeartbeatAt: 0,
    lastTaskLedgerSignature: '',
    toolsUsed: [],
    toolResultPreviews: [],
  };
  let terminalCompletionState: SubAgentResult['completionState'];
  const requireStructuredExecutionEvidence = Boolean(params.config.workstreamId?.trim());
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
    await runSubAgentOrchestratorLoop({
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
      toolFilter,
      linkUnderstandingEnabled: params.config.linkUnderstandingEnabled,
      mediaUnderstandingEnabled: params.config.mediaUnderstandingEnabled,
      explicitToolSelectionRejectedMessage,
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

    terminalCompletionState = await resolveWorkerOutput('completed');

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
      announce: params.announce,
      scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
      persistRegistryBestEffort: params.persistRegistryBestEffort,
      scheduleSessionContextEvictionWhenDurable: params.scheduleSessionContextEvictionWhenDurable,
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

    terminalCompletionState = await resolveWorkerOutput(status);

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
      error: errorMessage,
      terminalMessage,
      subAgent,
      outputTruncation: OUTPUT_TRUNCATION,
      maxToolResultPreviewChars: params.maxToolResultPreviewChars,
      shouldAnnounce: params.config.announce !== false,
      refreshArtifacts: params.refreshSubAgentArtifacts,
      appendActivity: params.appendActivity,
      normalizePreviewText,
      announce: params.announce,
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
