import {
  NonRetryableSchedulerExecutionError,
  SchedulerAppBackgroundAbortError,
  SchedulerExecutionError,
} from './executionError';
import { useChatStore } from '../../store/useChatStore';
import { runOrchestrator } from '../../engine/orchestrator';
import type { CronJob } from '../cron/types';
import { createAgentControlGraphTerminalOutcomeTracker } from '../../engine/graph/terminalOutcome';
import { createScheduledJobOrchestratorCallbacks } from './jobExecutorCallbacks';
import type { SchedulerExecutionResult } from './executionResult';
import type { PendingVerifiedProcedureObservation } from '../memory/verifiedProcedure/executionSession';
import {
  registerScheduledJobExecution,
  getScheduledExecutionLifecycleEpoch,
  ScheduledAppBackgroundAbortReason,
  type ScheduledExecutionContext,
} from './executionLifecycle';
import {
  checkpointScheduledAttemptConversation,
  checkpointScheduledAttemptHooks,
  checkpointScheduledExecutionResult,
  markScheduledAttemptEffectUnsafe,
  flushScheduledConversationPersistence,
} from './jobExecutorPersistence';
import { createScheduledJobRetryPolicy } from './jobExecutorRetryPolicy';
import {
  configureScheduledExecutionConversation,
  resolveScheduledExecutionConversation,
  resolveScheduledOccurrenceCompletedOutput,
  resolveScheduledExecutionProvider,
} from './jobExecutorSetup';
import {
  checkpointScheduledProjectionClaim,
  claimScheduledProjection,
  pendingScheduledProcedureCommit,
  releaseScheduledProjectionAfterExecution,
  type ScheduledProjectionLease,
} from './jobExecutorProjection';
import { throwNormalizedScheduledJobExecutionError } from './jobExecutorErrorNormalization';

export async function executeScheduledJob(
  job: CronJob,
  context: ScheduledExecutionContext = {
    lifecycleEpoch: getScheduledExecutionLifecycleEpoch(),
  },
): Promise<SchedulerExecutionResult> {
  const executionLifecycle = registerScheduledJobExecution(job.id, context.lifecycleEpoch);
  let executionConversationId: string | undefined;
  let projectionLease: ScheduledProjectionLease | undefined;
  try {
    executionLifecycle.throwIfBackgrounded();
    const prompt = job.payload?.prompt?.trim();
    if (!prompt) {
      throw new NonRetryableSchedulerExecutionError(
        new Error(`Scheduled task "${job.name}" is missing a prompt`),
      );
    }
    const { settings, provider, model, apiKey, systemPrompt } =
      await resolveScheduledExecutionProvider(job);
    executionLifecycle.throwIfBackgrounded();

    const { chatState, conversationId } = resolveScheduledExecutionConversation({
      job,
      provider,
      model,
      systemPrompt,
    });
    executionConversationId = conversationId;
    projectionLease = claimScheduledProjection({
      job,
      conversationId,
      prompt,
    });
    await checkpointScheduledProjectionClaim(conversationId);
    executionLifecycle.throwIfBackgrounded();
    const executionPersonaId = configureScheduledExecutionConversation({
      job,
      provider,
      model,
      conversationId,
    });
    const completedOutput = resolveScheduledOccurrenceCompletedOutput({
      job,
      chatState: useChatStore.getState(),
      conversationId,
    });
    const assistantMessageId = projectionLease.owner.assistantMessageId;
    await checkpointScheduledAttemptConversation(job, conversationId);
    if (completedOutput) {
      return checkpointScheduledExecutionResult({
        job,
        output: completedOutput,
        conversationId,
      });
    }

    await checkpointScheduledAttemptHooks(job);
    executionLifecycle.throwIfBackgrounded();

    const retryPolicy = createScheduledJobRetryPolicy(executionLifecycle.controller.signal);
    const terminalOutcome = createAgentControlGraphTerminalOutcomeTracker();
    const transcriptMutationAllowed = () => !executionLifecycle.controller.signal.aborted;
    const {
      callbacks,
      flushReadySurfacedSubAgentOutputs,
      commitPostSurfaceSuccessResponse,
      commitTerminalFailureResponse,
      finalizeSurfacedOutputSuccess,
      getActiveAssistantMessageId,
      getAccumulatedContent,
      getGraphFailureResponseApplied,
    } = createScheduledJobOrchestratorCallbacks({
      chatState,
      conversationId,
      assistantMessageId,
      transcriptMutationAllowed,
      retryPolicy,
      terminalOutcome,
    });

    const messages =
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.filter((message) => message.id !== assistantMessageId) || [];
    let pendingVerifiedProcedureObservation: PendingVerifiedProcedureObservation | undefined;

    try {
      const orchestratorResult = await runOrchestrator(
        {
          provider: { ...provider, apiKey },
          model,
          conversationId,
          personaId: executionPersonaId,
          taskId: job.runningAttemptId ?? null,
          executionRunId: projectionLease.owner.runId,
          agentRunId: job.runningAttemptId,
          beforeEffectDispatch: () => markScheduledAttemptEffectUnsafe(job),
          systemPrompt:
            settings.systemPrompt ||
            'You are a helpful personal AI assistant with access to tools.',
          messages,
          signal: executionLifecycle.controller,
          thinkingLevel: settings.thinkingLevel,
          allProviders: settings.providers.map((candidate) => ({ ...candidate })),
          enableCompaction: true,
          enableFailover: true,
          linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
          mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
          maxLinks: settings.maxLinks,
        },
        callbacks,
      );
      pendingVerifiedProcedureObservation = orchestratorResult.pendingVerifiedProcedureObservation;
      flushReadySurfacedSubAgentOutputs();
      commitPostSurfaceSuccessResponse();
      commitTerminalFailureResponse();
    } catch (error: unknown) {
      const sourceError = error instanceof Error ? error : new Error(String(error));
      if (
        executionLifecycle.controller.signal.reason instanceof ScheduledAppBackgroundAbortReason
      ) {
        throw new SchedulerAppBackgroundAbortError(sourceError, conversationId);
      }
      flushReadySurfacedSubAgentOutputs();
      commitTerminalFailureResponse({
        content: `Error: ${sourceError.message}`,
      });
      if (retryPolicy.isProviderFailureNonRetryable(sourceError)) {
        throw new NonRetryableSchedulerExecutionError(sourceError, conversationId);
      }
      throw new SchedulerExecutionError(sourceError, conversationId);
    }

    executionLifecycle.throwIfBackgrounded();

    const terminalFailure = terminalOutcome.resolveFailure();
    if (terminalFailure) {
      flushReadySurfacedSubAgentOutputs();
      const failureContent =
        getGraphFailureResponseApplied() && getAccumulatedContent().trim()
          ? getAccumulatedContent()
          : `Error: ${terminalFailure.message}`;
      commitTerminalFailureResponse({ content: failureContent });
      throw retryPolicy.isTerminalFailureNonRetryable(terminalOutcome.hasControlGraphFailure())
        ? new NonRetryableSchedulerExecutionError(terminalFailure, conversationId)
        : new SchedulerExecutionError(terminalFailure, conversationId);
    }

    finalizeSurfacedOutputSuccess();

    const result = resolveScheduledOccurrenceCompletedOutput({
      job,
      chatState: useChatStore.getState(),
      conversationId,
    });
    if (!result) {
      throw new SchedulerExecutionError(
        new Error('Scheduled task did not produce a complete final assistant response.'),
        conversationId,
      );
    }

    const warnings = await flushScheduledConversationPersistence('result');

    return checkpointScheduledExecutionResult({
      job,
      output: result,
      conversationId,
      warnings,
      ...(pendingVerifiedProcedureObservation
        ? {
            pendingVerifiedProcedureCommit: pendingScheduledProcedureCommit(
              pendingVerifiedProcedureObservation,
              job,
              projectionLease,
              getActiveAssistantMessageId(),
            ),
          }
        : {}),
    });
  } catch (error: unknown) {
    return await throwNormalizedScheduledJobExecutionError(error, executionConversationId);
  } finally {
    try {
      await releaseScheduledProjectionAfterExecution(job, projectionLease);
    } finally {
      executionLifecycle.unregister();
    }
  }
}
