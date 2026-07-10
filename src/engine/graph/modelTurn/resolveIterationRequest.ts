import type { RequestFrame } from '../../../services/agents/requestFrame';
import { planIterationModel } from '../../../services/context/tokenOptimization';
import {
  isOnDeviceLlmProvider,
  supportsOnDeviceLlmTools,
} from '../../../services/localLlm/provider';
import type { LlmProviderConfig } from '../../../types/provider';
import type { Message } from '../../../types/message';
import { hasModelVisibleAttachments } from '../../../utils/messageAttachments';
import type { ThinkingLevel } from '../../thinking';
import type { AgentControlTurnDirectives } from '../agentControlGraph';

function requestDecisionForcedTextReason(
  action: RequestFrame['decision']['action'],
): AgentControlTurnDirectives['forcedTextReason'] {
  switch (action) {
    case 'clarify':
      return 'request_clarification';
    case 'consent':
      return 'request_consent';
    case 'decline':
      return 'request_decline';
    case 'wait':
      return 'request_wait';
    case 'act':
      return undefined;
  }
}

export function resolveModelTurnIterationRequest(params: {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  disableTooling?: boolean;
  iteration: number;
  maxTokens: number;
  personaThinkingLevel?: ThinkingLevel;
  requestFrame: RequestFrame;
  thinkingLevel: ThinkingLevel;
  turnDirectives: AgentControlTurnDirectives;
  workingMessages: ReadonlyArray<Message>;
}): {
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  iterationThinkingLevel: ThinkingLevel;
  requestMaxTokens: number;
  requestModel: string;
  toolingEnabledForProvider: boolean;
} {
  const effectiveForceTextThisTurn =
    params.turnDirectives.forceFinalText || params.requestFrame.decision.action !== 'act';
  const actionablePromptTurn = !effectiveForceTextThisTurn;
  const hasRecentToolMessages = params.workingMessages
    .slice(-6)
    .some((message) => message.role === 'tool');
  const hasAttachments = params.workingMessages.some((message) =>
    hasModelVisibleAttachments(message.attachments),
  );
  const iterationPlan = planIterationModel({
    provider: params.activeProvider,
    primaryModel: params.activeModel,
    iteration: params.iteration,
    maxTokens: params.maxTokens,
    actionableRequest: actionablePromptTurn,
    hasRecentToolMessages,
    hasAttachments,
    thinkingLevel: params.personaThinkingLevel ?? params.thinkingLevel,
  });
  const requestModel = iterationPlan.model;
  const requestMaxTokens =
    params.turnDirectives.maxTokensOverride !== undefined
      ? Math.max(iterationPlan.maxTokens, params.turnDirectives.maxTokensOverride)
      : iterationPlan.maxTokens;
  const toolingEnabledForProvider =
    !params.disableTooling &&
    (!isOnDeviceLlmProvider(params.activeProvider) ||
      supportsOnDeviceLlmTools(params.activeProvider, requestModel));

  const effectiveForceTextReasonThisTurn = params.turnDirectives.forceFinalText
    ? params.turnDirectives.forcedTextReason
    : requestDecisionForcedTextReason(params.requestFrame.decision.action);

  return {
    effectiveForceTextThisTurn,
    effectiveForceTextReasonThisTurn,
    iterationThinkingLevel: iterationPlan.thinkingLevel,
    requestMaxTokens,
    requestModel,
    toolingEnabledForProvider,
  };
}
