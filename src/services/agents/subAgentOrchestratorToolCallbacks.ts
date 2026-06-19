import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import type {
  AssistantMessageMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { recordImageToolConversationUsage } from '../usage/conversationUsage';
import { generateId } from '../../utils/id';
import {
  normalizeFinalizationOutputText,
  summarizeFinalizationToolResultPreview,
} from './finalizationText';
import { buildSubAgentResponsePreview, summarizeToolArguments } from './lifecycle/runText';
import { cloneJsonLike, coerceToolCallStatus } from './lifecycle/sessionContextMessages';
import type {
  ProgressChanges,
  SubAgentOrchestratorCallbackParams,
} from './subAgentOrchestratorCallbackTypes';

export function createSubAgentOrchestratorToolCallbacks<TAgent extends SubAgentSnapshot>(
  params: SubAgentOrchestratorCallbackParams<TAgent>,
): Pick<
  OrchestratorCallbacks,
  | 'onToolCallStart'
  | 'onToolCallComplete'
  | 'onAssistantMessage'
  | 'onToolMessage'
  | 'onError'
  | 'onUsage'
  | 'onDone'
> {
  return {
    onToolCallStart: (toolCall) => {
      if (params.abortController.signal.aborted) {
        return;
      }
      params.markModelResponseObserved(params.subAgent);
      params.runtimeState.finalNonEmptyContent = '';
      params.trackToolCall(toolCall, 'running');
      params.runtimeState.toolsUsed.push(toolCall.name);
      params.runtimeState.iterations += 1;
      const argumentSummary = summarizeToolArguments(toolCall.arguments);
      const activityText = argumentSummary
        ? `Using ${toolCall.name}: ${argumentSummary}`
        : `Using ${toolCall.name}`;
      params.updateAgentProgress(
        params.subAgent,
        {
          currentActivity: activityText,
          launchState: 'active',
          activeToolName: toolCall.name,
          activeToolStartedAt: Date.now(),
        } as ProgressChanges<TAgent>,
        {
          activityKind: 'tool',
          activityText,
        },
      );
      if (params.runtimeState.iterations >= params.maxIterations) {
        params.runControl.abortReason = 'max-iterations';
        params.abortController.abort();
      }
    },
    onToolCallComplete: (toolCall) => {
      recordImageToolConversationUsage({
        conversationId: params.config.parentConversationId,
        toolCall,
        providerId: params.providerId,
        source: 'sub-agent',
        sessionId: params.sessionId,
        parentSessionId: params.parentSessionId,
        agentRunId: params.agentRunId,
        emitLog: true,
      });
      params.trackToolCall(
        toolCall,
        coerceToolCallStatus(
          toolCall?.status,
          toolCall?.status === 'failed' ? 'failed' : 'completed',
        ),
      );
      const completedToolName =
        toolCall?.name ||
        params.subAgent.activeToolName ||
        params.runtimeState.toolsUsed[params.runtimeState.toolsUsed.length - 1] ||
        'tool';
      const preview = summarizeFinalizationToolResultPreview(toolCall?.result);
      if (preview) {
        params.runtimeState.toolResultPreviews.push({ toolName: completedToolName, preview });
      }

      if (toolCall?.result && toolCall.status !== 'failed') {
        const resultText = typeof toolCall.result === 'string' ? toolCall.result.trim() : '';
        if (resultText.length > 30) {
          params.runtimeState.lastSubstantiveToolResult =
            normalizeFinalizationOutputText(resultText) ||
            params.runtimeState.lastSubstantiveToolResult;
        }
      }

      params.updateAgentProgress(
        params.subAgent,
        {
          currentActivity: preview
            ? `Latest result from ${completedToolName}: ${preview}`
            : toolCall?.status === 'failed'
              ? `Tool ${completedToolName} failed`
              : `Completed ${completedToolName}`,
          launchState: 'active',
          activeToolName: undefined,
          activeToolStartedAt: undefined,
          lastToolResultPreview: preview,
        } as ProgressChanges<TAgent>,
        {
          activityKind: toolCall?.status === 'failed' ? 'status' : 'result',
          activityText: preview
            ? `${completedToolName}: ${preview}`
            : toolCall?.status === 'failed'
              ? `Tool ${completedToolName} failed`
              : `Completed ${completedToolName}`,
        },
      );
    },
    onAssistantMessage: (
      content: string,
      toolCalls?: ToolCall[],
      providerReplay?: MessageProviderReplay,
      assistantMetadata?: AssistantMessageMetadata,
    ) => {
      params.markModelResponseObserved(params.subAgent);
      const normalizedContent = normalizeFinalizationOutputText(content);
      const trackedToolCalls = toolCalls?.map((toolCall) =>
        params.trackToolCall(toolCall, 'pending'),
      );
      if (normalizedContent || trackedToolCalls?.length) {
        params.appendTranscriptMessage(params.transcriptMessages, {
          id: generateId(),
          role: 'assistant',
          content: normalizedContent || '',
          timestamp: Date.now(),
          ...(trackedToolCalls?.length ? { toolCalls: trackedToolCalls } : {}),
          ...(providerReplay ? { providerReplay: cloneJsonLike(providerReplay) } : {}),
          ...(assistantMetadata ? { assistantMetadata: { ...assistantMetadata } } : {}),
        });
        params.persistSessionContextNow(
          params.runtimeState.lastNonEmptyContent ||
            params.runtimeState.finalNonEmptyContent ||
            normalizedContent,
        );
      }
      if (normalizedContent) {
        params.runtimeState.outputText = normalizedContent;
        params.runtimeState.lastNonEmptyContent = normalizedContent;
        if (!toolCalls?.length && assistantMetadata?.completionStatus !== 'incomplete') {
          params.runtimeState.finalNonEmptyContent = normalizedContent;
        }
        const responsePreview = buildSubAgentResponsePreview(
          normalizedContent,
          params.maxToolResultPreviewChars,
        );
        params.updateAgentProgress(
          params.subAgent,
          {
            currentActivity: responsePreview || normalizedContent,
            launchState: 'active',
          } as ProgressChanges<TAgent>,
          {
            activityKind: 'message',
            activityText: normalizedContent,
          },
        );
      }
    },
    onToolMessage: (toolCallId, result) => {
      params.appendTranscriptMessage(params.transcriptMessages, {
        id: generateId(),
        role: 'tool',
        content: result,
        toolCallId,
        timestamp: Date.now(),
        ...(params.transcriptToolCalls.has(toolCallId)
          ? { toolCalls: [params.transcriptToolCalls.get(toolCallId)!] }
          : {}),
        ...(typeof result === 'string' && /^Error:/i.test(result) ? { isError: true } : {}),
      });
      params.refreshSubAgentArtifacts(params.subAgent, params.transcriptMessages);
      params.checkpointSessionContext(
        params.runtimeState.lastNonEmptyContent || params.runtimeState.finalNonEmptyContent,
      );
    },
    onError: (error) => {
      params.reject(error);
    },
    onUsage: (usage) => {
      params.recordUsage(usage);
    },
    onDone: () => {
      params.resolve();
    },
  };
}
