import type { Message, ToolCall } from '../../types/message';
import type { SubAgentActivityEntry, SubAgentConfig, SubAgentSnapshot } from '../../types/subAgent';
import type { TokenUsage } from '../../types/usage';
import type { LlmProviderConfig } from '../../types/provider';
import { resolveSubAgentMaxTokens } from '../context/tokenOptimization';
import {
  createSubAgentOrchestratorCallbacks,
  type SubAgentExecutionRuntimeState,
} from './subAgentOrchestratorCallbacks';

type ProgressChanges<TAgent extends SubAgentSnapshot> = Partial<
  Pick<
    TAgent,
    | 'currentActivity'
    | 'activeToolName'
    | 'activeToolStartedAt'
    | 'lastToolResultPreview'
    | 'launchState'
    | 'modelResponsePendingSince'
    | 'taskLedger'
  >
>;

type ProgressOptions = {
  activityKind?: SubAgentActivityEntry['kind'];
  activityText?: string;
  announce?: boolean;
  markProgress?: boolean;
};

type SubAgentRunControl = {
  abortReason?: 'cancelled' | 'timeout' | 'max-iterations';
};

export async function runSubAgentOrchestratorLoop<TAgent extends SubAgentSnapshot>(params: {
  provider: LlmProviderConfig;
  model: string;
  sessionId: string;
  usageConversationId: string;
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
  systemPrompt: string;
  messages: Message[];
  allProviders?: LlmProviderConfig[];
  disableTooling: boolean;
  toolFilter?: (toolName: string) => boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  explicitToolSelectionRejectedMessage?: string;
  taskId?: string;
  subAgent: TAgent;
  config: SubAgentConfig;
  runtimeState: SubAgentExecutionRuntimeState;
  maxIterations: number;
  maxToolResultPreviewChars: number;
  runControl: SubAgentRunControl;
  abortController: AbortController;
  transcriptMessages: Message[];
  transcriptToolCalls: Map<string, ToolCall>;
  trackToolCall: (
    toolCallLike: Partial<ToolCall> | undefined,
    fallbackStatus: ToolCall['status'],
  ) => ToolCall;
  persistSessionContextNow: (conversationSummary?: string) => void;
  checkpointSessionContext: (conversationSummary?: string) => void;
  markModelResponseObserved: (agent: TAgent) => void;
  refreshSubAgentArtifacts: (agent: TAgent, messages: Message[]) => void;
  appendTranscriptMessage: (messages: Message[], message: Message) => void;
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void;
  updateAgentProgress: (
    agent: TAgent,
    changes: ProgressChanges<TAgent>,
    options?: ProgressOptions,
  ) => void;
  recordUsage: (usage: TokenUsage) => void;
}): Promise<void> {
  if (params.explicitToolSelectionRejectedMessage) {
    throw new Error(params.explicitToolSelectionRejectedMessage);
  }

  const { runOrchestrator } =
    require('../../engine/orchestrator') as typeof import('../../engine/orchestrator');

  await new Promise<void>((resolve, reject) => {
    const callbacks = createSubAgentOrchestratorCallbacks({
      abortController: params.abortController,
      config: params.config,
      providerId: params.provider.id,
      sessionId: params.sessionId,
      parentSessionId: params.config.parentSessionId,
      agentRunId: params.config.agentRunId,
      subAgent: params.subAgent,
      runtimeState: params.runtimeState,
      maxIterations: params.maxIterations,
      maxToolResultPreviewChars: params.maxToolResultPreviewChars,
      runControl: params.runControl,
      transcriptMessages: params.transcriptMessages,
      transcriptToolCalls: params.transcriptToolCalls,
      trackToolCall: params.trackToolCall,
      persistSessionContextNow: params.persistSessionContextNow,
      checkpointSessionContext: params.checkpointSessionContext,
      markModelResponseObserved: params.markModelResponseObserved,
      refreshSubAgentArtifacts: params.refreshSubAgentArtifacts,
      appendTranscriptMessage: params.appendTranscriptMessage,
      appendActivity: params.appendActivity,
      updateAgentProgress: params.updateAgentProgress,
      recordUsage: params.recordUsage,
      reject,
      resolve,
    });

    runOrchestrator(
      {
        provider: params.provider,
        model: params.model,
        conversationId: params.sessionId,
        usageConversationId: params.usageConversationId,
        workspaceConversationId: params.workspaceConversationId,
        workspaceReadFallbackConversationId:
          params.workspaceReadFallbackConversationId ?? params.sessionId,
        systemPrompt: params.systemPrompt,
        messages: params.messages,
        maxTokens: resolveSubAgentMaxTokens(params.model),
        signal: params.abortController,
        enableCompaction: true,
        enableFailover: true,
        linkUnderstandingEnabled: params.linkUnderstandingEnabled,
        mediaUnderstandingEnabled: params.mediaUnderstandingEnabled,
        allProviders: params.allProviders,
        disableTooling: params.disableTooling,
        toolFilter: params.toolFilter,
        ...(params.taskId ? { taskId: params.taskId } : {}),
      },
      callbacks,
    ).catch(reject);
  });
}
