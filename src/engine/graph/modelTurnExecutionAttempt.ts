import { buildPromptCachingPlan } from '../../services/context/tokenOptimization';
import { splitCacheableSystemPromptSections } from '../../services/llm/core/systemPromptSections';
import { resolveModelHostedFamily } from '../../services/llm/catalog/providerFamilies';
import { resolveProviderTransport } from '../../services/llm/catalog/providerProtocols';
import type { ToolChoiceMode } from '../../services/llm/support/contracts';
import { isContextOverflowProviderError } from '../../services/llm/support/requestErrors';
import type {
  AssistantCompletionMetadata,
  Message,
  MessageProviderReplay,
} from '../../types/message';
import { getThinkingParams } from '../thinking';
import { canContinueAnthropicThinking } from '../orchestratorMessageFormatting';
import { estimateWorkingMessageTokens } from '../orchestratorCompaction';
import {
  getProviderOverflowRetryMaxTokens,
  isDirectAnthropicProvider,
} from '../orchestratorProviderRuntime';
import { isToolLoopInProgress } from '../orchestratorToolTranscript';
import { hasProviderToolTurnReplayCoverage } from '../../services/llm/support/toolTurnReplayCoverage';
import {
  executeAgentControlGraphModelTurnStreaming,
  executeAgentControlGraphModelTurnViaSendMessage,
} from './modelTurnExecutionStreaming';
import {
  buildGraphObservabilityRecordedEvent,
  buildToolSurfaceTokenAuditDetail,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from './graphObservability';
import {
  compactAgentTurnWorkingMessages,
  prepareAgentTurnRequestBudget,
} from './agentTurnRequestBudget';
import type {
  ExecuteAgentControlGraphModelTurnParams,
  PendingAgentToolCall,
} from './modelTurnExecutionTypes';

export type ExecuteAgentControlGraphModelTurnAttemptResult =
  | {
      kind: 'success';
      completion?: AssistantCompletionMetadata;
      contextWindow: number;
      fullContent: string;
      pendingToolCalls: PendingAgentToolCall[];
      providerReplay?: MessageProviderReplay;
      reasoning: string;
      requestMaxTokens: number;
      workingMessages: Message[];
    }
  | {
      kind: 'overflow_retry';
      nextRequestMaxTokens: number;
      workingMessages: Message[];
    };

export async function executeAgentControlGraphModelTurnAttempt(
  params: ExecuteAgentControlGraphModelTurnParams & {
    allowOverflowRetry?: boolean;
  },
): Promise<ExecuteAgentControlGraphModelTurnAttemptResult> {
  const anthropicTarget = isDirectAnthropicProvider(params.activeProvider);
  const isGemini3 =
    resolveModelHostedFamily(params.requestModel) === 'gemini' &&
    /gemini[- ]?3/i.test(params.requestModel);
  const geminiNativeTransport = resolveProviderTransport(params.activeProvider) === 'gemini';

  const preparedRequestBudget = await prepareAgentTurnRequestBudget({
    compactionEngine: params.compactionEngine,
    conversationId: params.conversationId,
    enrichedSystemPrompt: params.preparedTurn.enrichedSystemPrompt,
    enrichedSystemPromptSections: params.preparedTurn.enrichedSystemPromptSections,
    iteration: params.iteration,
    livingMemory: params.livingMemory,
    onCompaction: params.onCompaction,
    pinnedToolNames: params.preparedTurn.pinnedToolNames,
    sessionPinnedCount: params.toolSurfacePinTelemetry?.sessionPinnedCount ?? 0,
    turnPinnedCount: params.toolSurfacePinTelemetry?.turnPinnedCount ?? 0,
    requestMaxTokens: params.requestMaxTokens,
    requestModel: params.requestModel,
    toolsForIteration: params.preparedTurn.toolsForIteration,
    warn: params.warn,
    workingMessages: params.workingMessages,
  });
  if (preparedRequestBudget.toolSurfaceTokenAudit) {
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_SURFACE_TOKEN_AUDIT,
        iteration: params.iteration,
        detail: buildToolSurfaceTokenAuditDetail(preparedRequestBudget.toolSurfaceTokenAudit),
      }),
    ]);
  }
  const contextWindow = preparedRequestBudget.contextWindow;
  const workingMessages = preparedRequestBudget.workingMessages;

  const toolLoopInProgress = isToolLoopInProgress(workingMessages);
  const budgetResult = preparedRequestBudget.budgetResult;
  const requestedThinkingParams = getThinkingParams(params.thinkingLevel, params.requestModel, {
    maxTokens: params.requestMaxTokens,
  });
  const anthropicToolLoopInProgress = anthropicTarget && toolLoopInProgress;
  const anthropicReplayableThinking =
    anthropicToolLoopInProgress && canContinueAnthropicThinking(workingMessages);
  const anthropicThinkingRequested =
    anthropicTarget && Object.prototype.hasOwnProperty.call(requestedThinkingParams, 'thinking');
  const forceToolChoiceCandidate =
    budgetResult.tools.length > 0 && params.hasPendingAsyncOperations;
  const forceToolChoice =
    anthropicThinkingRequested && (!anthropicToolLoopInProgress || anthropicReplayableThinking)
      ? false
      : forceToolChoiceCandidate;
  const forcedToolChoice: ToolChoiceMode | undefined = forceToolChoice
    ? anthropicTarget && params.hasPendingAsyncOperations
      ? { type: 'required', disableParallelToolUse: true }
      : 'required'
    : undefined;
  const requestMessages = [
    { role: 'system', content: budgetResult.systemPrompt },
    ...budgetResult.messages,
  ];
  const stableSystemPrompt = splitCacheableSystemPromptSections(
    params.preparedTurn.enrichedSystemPromptSections,
  ).cacheableText;
  const promptCachingPlan = buildPromptCachingPlan({
    provider: params.activeProvider,
    model: params.requestModel,
    estimatedInputTokens: budgetResult.result.totalTokens,
    conversationId: params.conversationId,
    systemPrompt: budgetResult.systemPrompt,
    stableSystemPrompt,
    tools: params.preparedTurn.toolsForIteration ? budgetResult.tools : [],
  });

  const shouldDisableAnthropicThinking =
    anthropicThinkingRequested &&
    (forceToolChoice || (anthropicToolLoopInProgress && !anthropicReplayableThinking));
  const thinkingParams = shouldDisableAnthropicThinking ? {} : requestedThinkingParams;
  const anthropicThinkingEnabled =
    anthropicTarget && Object.prototype.hasOwnProperty.call(thinkingParams, 'thinking');
  const effectiveTemperature = anthropicThinkingEnabled
    ? undefined
    : isGemini3
      ? 1.0
      : params.temperature;
  const streamOptions: Record<string, any> = {
    model: params.requestModel,
    conversationId: params.conversationId,
    tools: params.preparedTurn.toolsForIteration ? budgetResult.tools : undefined,
    toolChoice: forcedToolChoice,
    maxTokens: params.requestMaxTokens,
    temperature: effectiveTemperature,
    signal: params.signal?.signal,
    enablePromptCaching: promptCachingPlan.enablePromptCaching,
    promptCacheKey: promptCachingPlan.promptCacheKey,
    usageTelemetry: {
      tokenBuckets: preparedRequestBudget.usageTokenBuckets,
      promptCache: promptCachingPlan.telemetry,
    },
    ...thinkingParams,
  };

  if (promptCachingPlan.enablePromptCaching) {
    streamOptions.systemPromptSections = params.preparedTurn.enrichedSystemPromptSections;
  }
  const allowQueuedToolCalls = !(
    (params.effectiveForceTextReasonThisTurn === 'async_terminal_completion' ||
      params.effectiveForceTextReasonThisTurn === 'workflow_route_completed' ||
      params.effectiveForceTextReasonThisTurn === 'yield_finalization' ||
      params.effectiveForceTextReasonThisTurn === 'incomplete_delivery_continuation') &&
    (!params.preparedTurn.toolsForIteration || budgetResult.tools.length === 0)
  );

  const MAX_TOOL_TURN_REPLAY_RETRIES = 4;

  try {
    let streamResult:
      | Awaited<ReturnType<typeof executeAgentControlGraphModelTurnStreaming>>
      | undefined;

    let usedNonStreamingReplayReconcile = false;
    let retryingForMissingReplayCoverage = false;

    for (let retry = 0; retry <= MAX_TOOL_TURN_REPLAY_RETRIES; retry += 1) {
      const shouldReconcileViaSendMessage =
        isGemini3 &&
        geminiNativeTransport &&
        usedNonStreamingReplayReconcile === false &&
        retry > 0;

      let adoptedNonStreamingReplayReconcile = false;

      if (shouldReconcileViaSendMessage) {
        usedNonStreamingReplayReconcile = true;
        const reconcileResult = await executeAgentControlGraphModelTurnViaSendMessage({
          applyGraphEvents: params.applyGraphEvents,
          budgetTools: budgetResult.tools || [],
          callbacks: params.callbacks,
          geminiNative: true,
          iteration: params.iteration,
          llm: params.llm,
          recordPerformanceMetrics: params.recordPerformanceMetrics,
          reportUsage: params.reportUsage,
          requestMessages,
          requestModel: params.requestModel,
          signal: params.signal,
          streamOptions,
        });
        const reconcileHasReplayCoverage = hasProviderToolTurnReplayCoverage({
          model: params.requestModel,
          pendingToolCalls: reconcileResult.pendingToolCalls,
          providerReplay: reconcileResult.providerReplay,
        });
        if (reconcileResult.pendingToolCalls.length > 0 && reconcileHasReplayCoverage) {
          streamResult = reconcileResult;
          adoptedNonStreamingReplayReconcile = true;
        }
      }

      if (!adoptedNonStreamingReplayReconcile) {
        streamResult = await executeAgentControlGraphModelTurnStreaming({
          allowQueuedToolCalls,
          applyGraphEvents: params.applyGraphEvents,
          budgetTools: budgetResult.tools || [],
          callbacks: params.callbacks,
          iteration: params.iteration,
          llm: params.llm,
          recordPerformanceMetrics: params.recordPerformanceMetrics,
          reportUsage: params.reportUsage,
          requestMessages,
          requestModel: params.requestModel,
          signal: params.signal,
          streamOptions,
        });
      }

      if (!streamResult) {
        throw new Error('Model turn streaming did not produce a result');
      }

      const hasToolTurnReplayCoverage = hasProviderToolTurnReplayCoverage({
        model: params.requestModel,
        pendingToolCalls: streamResult.pendingToolCalls,
        providerReplay: streamResult.providerReplay,
      });

      if (hasToolTurnReplayCoverage) {
        break;
      }

      if (streamResult.pendingToolCalls.length > 0) {
        retryingForMissingReplayCoverage = true;
      } else if (!retryingForMissingReplayCoverage) {
        break;
      }

      if (retry >= MAX_TOOL_TURN_REPLAY_RETRIES) {
        break;
      }

      params.applyGraphEvents([
        {
          type: 'MODEL_TURN_FAILED',
          iteration: params.iteration,
          reason: 'provider_replay_retry',
        },
      ]);
      params.callbacks.onAssistantStreamReset?.();
      params.callbacks.onStateChange('thinking');
      await params.yieldToUiFrame();
    }

    if (!streamResult) {
      throw new Error('Model turn streaming did not produce a result');
    }

    if (
      streamResult.pendingToolCalls.length > 0 &&
      !hasProviderToolTurnReplayCoverage({
        model: params.requestModel,
        pendingToolCalls: streamResult.pendingToolCalls,
        providerReplay: streamResult.providerReplay,
      })
    ) {
      throw new Error('Model tool turn is missing required provider replay coverage after retries');
    }

    return {
      kind: 'success',
      completion: streamResult.completion,
      contextWindow,
      fullContent: streamResult.fullContent,
      pendingToolCalls: streamResult.pendingToolCalls,
      providerReplay: streamResult.providerReplay,
      reasoning: streamResult.reasoning,
      requestMaxTokens: params.requestMaxTokens,
      workingMessages,
    };
  } catch (streamError: unknown) {
    if (
      !params.signal?.signal.aborted &&
      params.compactionEngine &&
      params.allowOverflowRetry &&
      isContextOverflowProviderError(streamError)
    ) {
      const overflowRecovery = await compactAgentTurnWorkingMessages({
        compactionEngine: params.compactionEngine,
        conversationId: params.conversationId,
        currentMessages: workingMessages,
        livingMemory: params.livingMemory,
        onCompaction: params.onCompaction,
        currentTokenCount: estimateWorkingMessageTokens(workingMessages),
        forceTier: 'aggressive',
        failureLabel: 'Provider overflow recovery compaction failed',
        warn: params.warn,
      });
      const nextMaxTokens = getProviderOverflowRetryMaxTokens(
        params.requestMaxTokens,
        params.requestModel,
      );

      if (overflowRecovery.compacted || nextMaxTokens < params.requestMaxTokens) {
        return {
          kind: 'overflow_retry',
          nextRequestMaxTokens: nextMaxTokens,
          workingMessages: overflowRecovery.messages,
        };
      }
    }

    throw streamError instanceof Error ? streamError : new Error(String(streamError));
  }
}
