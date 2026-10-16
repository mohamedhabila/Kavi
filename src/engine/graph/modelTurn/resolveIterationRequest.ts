import { planIterationMaxTokens } from '../../../services/context/tokenOptimization';
import {
  isOnDeviceLlmProvider,
  supportsOnDeviceLlmTools,
} from '../../../services/localLlm/provider';
import type { LlmProviderConfig } from '../../../types/provider';
import type { ThinkingLevel } from '../../thinking';
import type { AgentControlTurnDirectives } from '../agentControlGraph';

/**
 * The step's request: the run's model and thinking level (the persona's, else the person's;
 * neither chosen, the model's own default), and its output budget.
 */
export function resolveModelTurnIterationRequest(params: {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  disableTooling?: boolean;
  maxTokens: number;
  personaThinkingLevel?: ThinkingLevel;
  thinkingLevel?: ThinkingLevel;
  turnDirectives: AgentControlTurnDirectives;
}): {
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  iterationThinkingLevel?: ThinkingLevel;
  requestMaxTokens: number;
  requestModel: string;
  toolingEnabledForProvider: boolean;
} {
  const effectiveForceTextThisTurn = params.turnDirectives.forceFinalText;
  const iterationThinkingLevel = params.personaThinkingLevel ?? params.thinkingLevel;
  const plannedMaxTokens = planIterationMaxTokens({
    primaryModel: params.activeModel,
    maxTokens: params.maxTokens,
    thinkingLevel: iterationThinkingLevel,
  });
  const requestMaxTokens =
    params.turnDirectives.maxTokensOverride !== undefined
      ? Math.max(plannedMaxTokens, params.turnDirectives.maxTokensOverride)
      : plannedMaxTokens;
  const toolingEnabledForProvider =
    !params.disableTooling &&
    (!isOnDeviceLlmProvider(params.activeProvider) ||
      supportsOnDeviceLlmTools(params.activeProvider, params.activeModel));

  return {
    effectiveForceTextThisTurn,
    effectiveForceTextReasonThisTurn: effectiveForceTextThisTurn
      ? params.turnDirectives.forcedTextReason
      : undefined,
    iterationThinkingLevel,
    requestMaxTokens,
    requestModel: params.activeModel,
    toolingEnabledForProvider,
  };
}
