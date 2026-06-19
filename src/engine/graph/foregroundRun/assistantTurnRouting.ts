import type { ToolCall } from '../../../types/message';
import {
  buildToolExecutionWorkPhasePresentation,
  type ToolExecutionWorkPhasePresentation,
} from '../../toolExecution/toolExecutionPresentation';

type AssistantMetadata = {
  kind?: 'intermediate' | 'final';
};

export type ForegroundAssistantTurnRoutingEffect = {
  incomingToolCalls: ToolCall[];
  shouldShortCircuitForSurfacedWorkerOutput: boolean;
  shouldClearSurfacedWorkerOutputLock: boolean;
  shouldStartFreshTurnBeforeApplying: boolean;
  shouldQueueNextAssistantTurn: boolean;
  shouldCommitResolvedContent: boolean;
  shouldFinalizeCommittedContent: boolean;
  shouldSyncSummaryFromContent: boolean;
  workPhasePresentation?: ToolExecutionWorkPhasePresentation;
};

export function buildForegroundAssistantTurnRoutingEffect(params: {
  assistantMetadata?: AssistantMetadata;
  currentDraftContent?: string;
  currentDraftReasoning?: string;
  hasProviderReplay?: boolean;
  incomingContent?: string;
  persistedContent?: string;
  persistedReasoning?: string;
  persistedToolCalls?: ToolCall[];
  rawToolCalls?: ToolCall[];
  startNextAssistantTurn: boolean;
  surfacedWorkerOutputLocked: boolean;
}): ForegroundAssistantTurnRoutingEffect {
  const incomingToolCalls =
    params.rawToolCalls?.filter((toolCall) => toolCall.id?.trim() && toolCall.name?.trim()) ?? [];
  const rawToolCallCount = params.rawToolCalls?.length ?? 0;
  const persistedToolCallCount = params.persistedToolCalls?.length ?? 0;
  const persistedContent = params.persistedContent?.trim() ?? '';
  const persistedReasoning = params.persistedReasoning?.trim() ?? '';
  const currentDraftContent = params.currentDraftContent?.trim() ?? '';
  const currentDraftReasoning = params.currentDraftReasoning?.trim() ?? '';
  const incomingContent = params.incomingContent?.trim() ?? '';
  const incomingContentShouldBeVisible = incomingToolCalls.length === 0 && Boolean(incomingContent);
  const hasVisibleAssistantContent =
    incomingContentShouldBeVisible ||
    Boolean(persistedContent) ||
    Boolean(persistedReasoning) ||
    Boolean(currentDraftContent) ||
    Boolean(currentDraftReasoning);
  const shouldStartNewToolOnlyTurn =
    !params.startNextAssistantTurn &&
    incomingToolCalls.length > 0 &&
    persistedToolCallCount > 0 &&
    !persistedContent &&
    !persistedReasoning &&
    !currentDraftContent &&
    !currentDraftReasoning;
  const shouldQueueNextAssistantTurn = incomingToolCalls.length > 0;
  const hasNonToolTurnSignal = Boolean(
    params.incomingContent ||
    params.hasProviderReplay ||
    (rawToolCallCount === 0 && params.assistantMetadata?.kind === 'final'),
  );
  const shouldStartFreshTurnBeforeApplying =
    (params.startNextAssistantTurn || shouldStartNewToolOnlyTurn) &&
    (incomingToolCalls.length > 0 || hasNonToolTurnSignal);

  return {
    incomingToolCalls,
    shouldShortCircuitForSurfacedWorkerOutput:
      params.surfacedWorkerOutputLocked && incomingToolCalls.length === 0,
    shouldClearSurfacedWorkerOutputLock:
      params.surfacedWorkerOutputLocked && incomingToolCalls.length > 0,
    shouldStartFreshTurnBeforeApplying,
    shouldQueueNextAssistantTurn,
    shouldCommitResolvedContent: incomingContentShouldBeVisible,
    shouldFinalizeCommittedContent: incomingToolCalls.length === 0,
    shouldSyncSummaryFromContent: incomingContentShouldBeVisible,
    workPhasePresentation:
      incomingToolCalls.length > 0 && !hasVisibleAssistantContent
        ? buildToolExecutionWorkPhasePresentation(incomingToolCalls[0]?.name)
        : undefined,
  };
}
