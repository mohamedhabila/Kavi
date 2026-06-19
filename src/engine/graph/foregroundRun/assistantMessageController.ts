import type { Message, ToolCall } from '../../../types/message';
import { truncateLogDetail } from '../../../utils/logDetail';
import { buildForegroundAssistantTurnRoutingEffect } from './assistantTurnRouting';

type StreamingDraftSnapshot = {
  content?: string;
  reasoning?: string;
};

type PersistedAssistantMessage = Pick<
  Message,
  'content' | 'providerReplay' | 'reasoning' | 'toolCalls'
>;

type ForegroundAssistantMessageControllerAccessors = {
  getCurrentAssistantMessageId: () => string;
  getCurrentStreamingDraft: () => StreamingDraftSnapshot | undefined;
  getPersistedAssistantMessage: (messageId: string) => PersistedAssistantMessage | undefined;
  hasQueuedNextAssistantTurn: () => boolean;
  isSurfacedWorkerOutputLocked: () => boolean;
};

type ForegroundAssistantMessageControllerActions = {
  clearSurfacedWorkerOutputLock: () => void;
  commitResolvedContent: (content: string, finalize?: boolean) => void;
  ensureAssistantTurn: () => void;
  enterWorkPhase: (title: string, checkpointTitle?: string) => void;
  mergeLiveToolCalls: (messageId: string, toolCalls: ToolCall[]) => void;
  persistToolCalls: (messageId: string, toolCalls: ToolCall[]) => void;
  queueNextAssistantTurn: () => void;
  resolveAssistantTurnContent: (content: string) => string;
  setAssistantMetadata: (messageId: string, metadata: Message['assistantMetadata']) => void;
  setProviderReplay: (messageId: string, providerReplay: Message['providerReplay']) => void;
  syncSummary: (summary: string) => void;
};

export function createForegroundAssistantMessageController(params: {
  accessors: ForegroundAssistantMessageControllerAccessors;
  actions: ForegroundAssistantMessageControllerActions;
}) {
  return {
    applyAssistantMessage(input: {
      assistantMetadata?: Message['assistantMetadata'];
      content?: string;
      providerReplay?: Message['providerReplay'];
      toolCalls?: ToolCall[];
    }) {
      const currentAssistantMessageId = params.accessors.getCurrentAssistantMessageId();
      const persistedAssistantMessage =
        params.accessors.getPersistedAssistantMessage(currentAssistantMessageId);
      const currentDraft = params.accessors.getCurrentStreamingDraft();
      const routingEffect = buildForegroundAssistantTurnRoutingEffect({
        assistantMetadata: input.assistantMetadata,
        currentDraftContent: currentDraft?.content,
        currentDraftReasoning: currentDraft?.reasoning,
        hasProviderReplay: Boolean(input.providerReplay),
        incomingContent: input.content,
        persistedContent: persistedAssistantMessage?.content,
        persistedReasoning: persistedAssistantMessage?.reasoning,
        persistedToolCalls: persistedAssistantMessage?.toolCalls,
        rawToolCalls: input.toolCalls,
        startNextAssistantTurn: params.accessors.hasQueuedNextAssistantTurn(),
        surfacedWorkerOutputLocked: params.accessors.isSurfacedWorkerOutputLocked(),
      });
      const { incomingToolCalls } = routingEffect;

      if (routingEffect.shouldShortCircuitForSurfacedWorkerOutput) {
        if (input.providerReplay) {
          params.actions.setProviderReplay(currentAssistantMessageId, input.providerReplay);
        }
        if (input.assistantMetadata) {
          params.actions.setAssistantMetadata(currentAssistantMessageId, input.assistantMetadata);
        }
        return;
      }

      if (routingEffect.shouldClearSurfacedWorkerOutputLock) {
        params.actions.clearSurfacedWorkerOutputLock();
      }

      if (routingEffect.shouldStartFreshTurnBeforeApplying) {
        params.actions.ensureAssistantTurn();
      }

      const activeAssistantMessageId = params.accessors.getCurrentAssistantMessageId();
      if (input.providerReplay) {
        params.actions.setProviderReplay(activeAssistantMessageId, input.providerReplay);
      }
      if (input.assistantMetadata) {
        params.actions.setAssistantMetadata(activeAssistantMessageId, input.assistantMetadata);
      }

      const resolvedContent = input.content
        ? params.actions.resolveAssistantTurnContent(input.content)
        : input.content;

      if (incomingToolCalls.length) {
        const normalizedToolCalls = incomingToolCalls.map((toolCall) => ({
          ...toolCall,
          status: toolCall.status ?? 'pending',
        }));
        params.actions.mergeLiveToolCalls(activeAssistantMessageId, normalizedToolCalls);
        params.actions.persistToolCalls(activeAssistantMessageId, normalizedToolCalls);
      }

      if (routingEffect.workPhasePresentation) {
        params.actions.enterWorkPhase(
          routingEffect.workPhasePresentation.title,
          routingEffect.workPhasePresentation.checkpointTitle,
        );
      } else if (routingEffect.shouldSyncSummaryFromContent && resolvedContent) {
        params.actions.syncSummary(truncateLogDetail(resolvedContent) || resolvedContent);
      }

      if (routingEffect.shouldCommitResolvedContent && resolvedContent) {
        params.actions.commitResolvedContent(
          resolvedContent,
          routingEffect.shouldFinalizeCommittedContent,
        );
      }

      if (routingEffect.shouldQueueNextAssistantTurn) {
        params.actions.queueNextAssistantTurn();
      }
    },
  };
}
