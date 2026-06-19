import type { Message } from '../../../types/message';
import { runOrchestrator } from '../../orchestrator';
import { resolveConversationWorkspaceTarget } from '../../../services/conversationWorkspace/ownership';
import { supersedeForegroundConversationRun } from '../foregroundConversationCancellation';
import { prepareAgentRunResumeForOrchestrator } from '../runResumePreparation';
import { deduplicateToolResults, ensureToolResultPairing } from '../../toolResultPairingGuard';
import { startOrReuseForegroundTrackedRun } from './bootstrap';
import { createForegroundConversationRunRuntime } from './executionRuntime';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { resolveForegroundRunPreflight } from './preflight';
import { prepareForegroundRunRequestBootstrap } from './requestBootstrap';

function buildModelReadyMessages(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}

export async function executeForegroundConversationRun(
  params: ExecuteForegroundConversationRunParams,
): Promise<void> {
  const { context, conversationId, options } = params;
  const runInvocationId = ++context.refs.runInvocationSequenceRef.current;
  const conversation = context.helpers.getConversation(conversationId);
  const preflight = await resolveForegroundRunPreflight({
    activeModel: context.state.activeModel,
    activeProviderId: context.state.activeProviderId,
    conversation,
    conversationId,
    options,
    providers: context.state.providers,
    systemPrompt: context.state.systemPrompt,
  });

  if (preflight.kind === 'missing_provider') {
    context.helpers.setChatError(context.state.chatNoProviderMessage);
    return;
  }
  if (preflight.kind === 'missing_api_key') {
    context.helpers.setChatError(context.state.chatNoApiKeyMessage);
    return;
  }
  if (preflight.kind === 'missing_model') {
    context.helpers.setChatError(context.state.chatNoModelMessage);
    return;
  }

  const { finalizationProviderContext, model, provider, providerWithApiKey } = preflight;
  const bootstrapResult = prepareForegroundRunRequestBootstrap({
    conversation,
    conversationId,
    createAssistantMessageId: context.helpers.createId,
    createForegroundRequestId: context.helpers.createId,
    defaultConversationMode: context.state.defaultConversationMode,
    options,
    registerForegroundRequest: (requestId, abortController) => {
      context.requests.registerForegroundRequest(requestId, conversationId, abortController);
    },
    shouldAutoAbortPreviousForegroundRequest: (reason) => {
      context.requests.abortForegroundRequestForConversation(conversationId, reason);
    },
    startTrackedRun: (bootstrap) =>
      startOrReuseForegroundTrackedRun({
        bootstrap,
        clearTrackedRunCancellation: context.helpers.clearTrackedRunCancellation,
        conversationId,
        createUserMessageId: context.helpers.createId,
        startAgentRun: context.store.startAgentRun,
      }),
    supersedeExistingRun: (runId, runningWorkerCount) => {
      if (!conversation) {
        return;
      }

      supersedeForegroundConversationRun({
        actions: {
          appendConversationLog: context.helpers.appendConversationLog,
          clearPendingRunState: context.helpers.clearPendingRunState,
          completeAgentRun: context.store.completeAgentRun,
          getLatestConversation: context.helpers.getConversation,
          updateAgentRunControlGraph: context.store.updateAgentRunControlGraph,
        },
        conversation,
        conversationId,
        runId,
        runningWorkerCount,
      });
    },
  });

  const { abortController, assistantMessageId, bootstrap, foregroundRequestId } = bootstrapResult;
  context.refs.forceNextScrollRef.current = true;
  if (bootstrap.shouldInsertPlaceholderAssistant) {
    context.store.addMessage(conversationId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    });
  }
  context.requests.setStreamingMessageId(assistantMessageId);

  const clearForegroundRequestIfCurrent = () => {
    if (!context.requests.isCurrentForegroundRequest(foregroundRequestId, abortController)) {
      return false;
    }

    context.requests.clearForegroundRequest(foregroundRequestId, abortController);
    return true;
  };
  const isCurrentRunInvocation = () =>
    context.refs.runInvocationSequenceRef.current === runInvocationId &&
    context.requests.isCurrentForegroundRequest(foregroundRequestId, abortController) &&
    !abortController.signal.aborted;
  const guardRunCallback = () => isCurrentRunInvocation();
  let hasCompletedRunCallbacks = false;
  const completeRunOnce = async (task: () => Promise<void> | void) => {
    if (!isCurrentRunInvocation() || hasCompletedRunCallbacks) {
      return;
    }
    hasCompletedRunCallbacks = true;
    await task();
  };

  const runtime = createForegroundConversationRunRuntime({
    bootstrapResult,
    clearForegroundRequestIfCurrent,
    completeRunOnce,
    conversation,
    conversationId,
    finalizationProviderContext,
    getCurrentConversation: () => context.helpers.getConversation(conversationId),
    guardRunCallback,
    isCurrentRunInvocation,
    model,
    options,
    provider,
    shared: context,
  });

  const latestConversationForRequest = context.helpers.getConversation(conversationId);
  const modelReadyMessages = buildModelReadyMessages(
    latestConversationForRequest?.messages ?? conversation?.messages ?? [],
  );
  const additionalInternalPrompt = options?.additionalUserPrompt?.trim() || '';
  const orchestratorMessages = additionalInternalPrompt
    ? [
        ...modelReadyMessages,
        {
          id: context.helpers.createId(),
          role: 'system' as const,
          content: additionalInternalPrompt,
          timestamp: Date.now(),
        },
      ]
    : modelReadyMessages;
  const resumePreparation = prepareAgentRunResumeForOrchestrator({
    existingRun: bootstrap.existingRun,
    fallbackUserMessageId: bootstrap.latestUserMessage?.id,
    messages: orchestratorMessages,
  });
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId,
    conversations: context.helpers.getConversations(),
  });

  try {
    await runOrchestrator(
      {
        provider: providerWithApiKey,
        model,
        conversationId,
        workspaceConversationId: workspaceTarget.workspaceConversationId,
        workspaceReadFallbackConversationId: workspaceTarget.workspaceReadFallbackConversationId,
        systemPrompt: options?.additionalSystemPrompt
          ? [
              conversation?.systemPrompt || context.state.systemPrompt,
              options.additionalSystemPrompt,
            ]
              .filter(Boolean)
              .join('\n\n')
          : conversation?.systemPrompt || context.state.systemPrompt,
        messages: orchestratorMessages,
        signal: abortController,
        personaId: context.state.effectivePersonaId,
        allProviders: context.state.providers.map((candidate) => ({ ...candidate })),
        enableCompaction: true,
        enableFailover: true,
        thinkingLevel: context.state.thinkingLevel,
        linkUnderstandingEnabled: context.state.linkUnderstandingEnabled,
        mediaUnderstandingEnabled: context.state.mediaUnderstandingEnabled,
        maxLinks: context.state.maxLinks,
        toolFilter: options?.disableTools ? () => false : undefined,
        internalUserMessageCount: 0,
        initialPendingAsyncOperations: options?.initialPendingAsyncOperations,
        initialAgentControlGraphState: resumePreparation.initialAgentControlGraphState,
        workflowScopeUserMessageId: resumePreparation.workflowScopeUserMessageId,
      },
      runtime.callbacks,
    );
    await runtime.terminalLifecycle.awaitCompletion();
  } catch (error: unknown) {
    runtime.terminalLifecycle.handleCatch(error);
  }
}
