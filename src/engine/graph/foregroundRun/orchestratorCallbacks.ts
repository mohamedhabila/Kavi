import type {
  AssistantMessageMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../../types/message';
import type { ConversationLogEntry } from '../../../types/conversation';
import { recordConversationUsageEvent } from '../../../services/usage/conversationUsage';
import { editWorkingBlock } from '../../../services/memory/workingBlocks';
import { generateId } from '../../../utils/id';
import type { OrchestratorCallbacks } from '../../orchestrator';
import {
  applyOrchestratorCompactionEffect,
  buildOrchestratorCompactionEffect,
} from '../../orchestratorCompactionEffect';
import {
  buildForegroundRunGraphStateSyncEffect,
  buildForegroundRunOrchestratorStateEffect,
  buildForegroundRunPendingAsyncSyncEffect,
} from '../foregroundRunStateSync';

type ForegroundOrchestratorCallbacksControllers = {
  assistantMessage: {
    applyAssistantMessage: (params: {
      assistantMetadata?: AssistantMessageMetadata;
      content?: string;
      providerReplay?: MessageProviderReplay;
      toolCalls?: ToolCall[];
    }) => void;
  };
  assistantStream: {
    appendReasoningToken: (token: string) => void;
    appendToken: (token: string) => void;
    resetCurrentTurn: () => void;
  };
  commandResult: {
    handleCommandResult: (result: { response?: string; action?: string }) => Promise<void>;
  };
  terminalLifecycle: {
    handleDone: () => void;
    handleError: (error: Error) => void;
  };
  toolCallLifecycle: {
    completeToolCall: (toolCall: ToolCall) => void;
    publishToolMessage: (toolCallId: string, result: string) => void | Promise<void>;
    queueToolCall: (toolCall: ToolCall) => void;
    startToolCall: (toolCall: ToolCall) => void;
  };
  trackedRunStore: {
    applyGraphStateSyncEffect: (
      effect: ReturnType<typeof buildForegroundRunGraphStateSyncEffect>,
    ) => void;
    applyOrchestratorStateEffect: (
      effect: ReturnType<typeof buildForegroundRunOrchestratorStateEffect>,
    ) => void;
    applyPendingAsyncSyncEffect: (
      effect: ReturnType<typeof buildForegroundRunPendingAsyncSyncEffect>,
    ) => void;
  };
};

type ForegroundOrchestratorCallbacksActions = {
  appendConversationLog: (entry: ConversationLogEntry) => void;
  applyConversationCompaction: (messages: unknown[]) => void;
  setLatestPendingAsyncOperations: (operations: unknown[]) => void;
  updateMessageEnrichedContent: (messageId: string, enrichedContent: string) => void;
};

export function createForegroundRunOrchestratorCallbacks(params: {
  actions: ForegroundOrchestratorCallbacksActions;
  controllers: ForegroundOrchestratorCallbacksControllers;
  conversationId: string;
  guardRunCallback: () => boolean;
  isSurfacedWorkerOutputLocked: () => boolean;
  model: string;
  providerId: string;
  trackedAgentRunId?: string;
}): OrchestratorCallbacks {
  let lastLoggedState: string | null = null;
  let lastWorkflowRoutePlanSignature = '';
  let lastWorkflowRouteUiSignature = '';

  const appendStateLogEntry = (entry: {
    kind?: ConversationLogEntry['kind'];
    title: string;
    detail?: string;
    level?: ConversationLogEntry['level'];
    timestamp?: number;
  }) => {
    params.actions.appendConversationLog({
      id: generateId(),
      timestamp: entry.timestamp ?? Date.now(),
      kind: entry.kind ?? 'state',
      level: entry.level ?? 'info',
      title: entry.title,
      ...(entry.detail ? { detail: entry.detail } : {}),
    });
  };

  const logStateChange = (state: string) => {
    if (state === 'error' || state === lastLoggedState) {
      return;
    }

    const stateEffect = buildForegroundRunOrchestratorStateEffect({
      state,
      model: params.model,
    });
    params.controllers.trackedRunStore.applyOrchestratorStateEffect(stateEffect);
    lastLoggedState = state;
    appendStateLogEntry(stateEffect.logEntry);
  };

  return {
    onStateChange: (state) => {
      if (!params.guardRunCallback()) {
        return;
      }
      logStateChange(String(state));
    },
    onToken: (token) => {
      if (!params.guardRunCallback() || params.isSurfacedWorkerOutputLocked()) {
        return;
      }
      params.controllers.assistantStream.appendToken(token);
    },
    onReasoning: (token) => {
      if (!params.guardRunCallback() || params.isSurfacedWorkerOutputLocked()) {
        return;
      }
      params.controllers.assistantStream.appendReasoningToken(token);
    },
    onAssistantStreamReset: () => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.assistantStream.resetCurrentTurn();
    },
    onUserMessageEnriched: (messageId, enrichedContent) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.actions.updateMessageEnrichedContent(messageId, enrichedContent);
    },
    onToolCallQueued: (toolCall) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.toolCallLifecycle.queueToolCall(toolCall);
    },
    onToolCallStart: (toolCall) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.toolCallLifecycle.startToolCall(toolCall);
    },
    onToolCallComplete: (toolCall) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.toolCallLifecycle.completeToolCall(toolCall);
    },
    onPendingAsyncOperationsChange: (operations) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.actions.setLatestPendingAsyncOperations(operations);
      if (!params.trackedAgentRunId) {
        return;
      }
      params.controllers.trackedRunStore.applyPendingAsyncSyncEffect(
        buildForegroundRunPendingAsyncSyncEffect({
          operations,
          timestamp: Date.now(),
        }),
      );
    },
    onAgentControlGraphStateChange: (controlGraph) => {
      if (!params.guardRunCallback() || !params.trackedAgentRunId) {
        return;
      }
      const graphStateSyncEffect = buildForegroundRunGraphStateSyncEffect({
        controlGraph,
        lastPlanSignature: lastWorkflowRoutePlanSignature,
        lastRouteSignature: lastWorkflowRouteUiSignature,
      });
      lastWorkflowRoutePlanSignature = graphStateSyncEffect.nextPlanSignature;
      lastWorkflowRouteUiSignature = graphStateSyncEffect.nextRouteSignature;
      params.controllers.trackedRunStore.applyGraphStateSyncEffect(graphStateSyncEffect);
    },
    onAssistantMessage: (content, toolCalls, providerReplay, assistantMetadata) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.assistantMessage.applyAssistantMessage({
        assistantMetadata,
        content,
        providerReplay,
        toolCalls,
      });
    },
    onToolMessage: async (toolCallId, result) => {
      if (!params.guardRunCallback()) {
        return;
      }
      await params.controllers.toolCallLifecycle.publishToolMessage(toolCallId, result);
    },
    onError: (error) => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.terminalLifecycle.handleError(error);
    },
    onUsage: (usage) => {
      if (!params.guardRunCallback()) {
        return;
      }
      recordConversationUsageEvent({
        conversationId: params.conversationId,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          totalTokens: usage.totalTokens,
          model: usage.model || params.model,
        },
        providerId: params.providerId,
        source: 'primary',
        agentRunId: params.trackedAgentRunId,
        emitLog: true,
      });
    },
    onDone: () => {
      if (!params.guardRunCallback()) {
        return;
      }
      params.controllers.terminalLifecycle.handleDone();
    },
    onCommandResult: (result) => {
      if (!params.guardRunCallback()) {
        return;
      }
      void params.controllers.commandResult.handleCommandResult(result);
    },
    onCompaction: (event) => {
      if (!params.guardRunCallback()) {
        return;
      }
      applyOrchestratorCompactionEffect({
        effect: buildOrchestratorCompactionEffect({ event }),
        actions: {
          applyConversationCompaction: params.actions.applyConversationCompaction,
          appendConversationLog: params.actions.appendConversationLog,
          writeCompactionSummary: (summary) => {
            try {
              editWorkingBlock('compaction_summary', summary, {
                conversationId: params.conversationId,
              });
            } catch {
              // Memory write is best-effort; never break compaction
            }
          },
        },
      });
    },
  };
}
