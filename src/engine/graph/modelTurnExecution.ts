import { isTokenBudgetExhaustedCompletion } from '../../services/llm/support/completionRecovery';
import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import {
  getEscalatedToolCallEmissionMaxTokens,
  isIncompleteAssistantCompletion,
} from '../orchestratorProviderRuntime';
import { executeAgentControlGraphModelTurnAttempt } from './modelTurnExecutionAttempt';
import type {
  ExecuteAgentControlGraphModelTurnParams,
  ExecuteAgentControlGraphModelTurnResult,
  PendingAgentToolCall,
} from './modelTurnExecutionTypes';
export type { PendingAgentToolCall } from './modelTurnExecutionTypes';

const MAX_INCOMPLETE_TOOL_CALL_EMISSION_RETRIES = 2;
const MAX_PROVIDER_OVERFLOW_RETRIES = 1;

export async function executeAgentControlGraphModelTurn(
  params: ExecuteAgentControlGraphModelTurnParams,
): Promise<ExecuteAgentControlGraphModelTurnResult> {
  let fullContent = '';
  let reasoning = '';
  let providerReplay: MessageProviderReplay | undefined;
  let completion: AssistantCompletionMetadata | undefined;
  let pendingToolCalls: PendingAgentToolCall[] = [];
  let requestMaxTokens = params.requestMaxTokens;
  let workingMessages = params.workingMessages;
  let contextWindow = 0;
  let providerOverflowRetryCount = 0;
  attemptLoop: for (let toolCallEmissionRetryCount = 0; ; toolCallEmissionRetryCount += 1) {
    const attempt = await executeAgentControlGraphModelTurnAttempt({
      ...params,
      allowOverflowRetry: providerOverflowRetryCount < MAX_PROVIDER_OVERFLOW_RETRIES,
      requestMaxTokens,
      workingMessages,
    });
    if (attempt.kind === 'overflow_retry') {
      providerOverflowRetryCount += 1;
      workingMessages = attempt.workingMessages;
      requestMaxTokens = attempt.nextRequestMaxTokens;
      params.callbacks.onAssistantStreamReset?.();
      params.callbacks.onStateChange('thinking');
      await params.yieldToUiFrame();
      continue attemptLoop;
    }
    completion = attempt.completion;
    contextWindow = attempt.contextWindow;
    fullContent = attempt.fullContent;
    pendingToolCalls = attempt.pendingToolCalls;
    providerReplay = attempt.providerReplay;
    reasoning = attempt.reasoning;
    requestMaxTokens = attempt.requestMaxTokens;
    workingMessages = attempt.workingMessages;

    const shouldRetryIncompleteToolCallEmission =
      Boolean(params.preparedTurn.toolsForIteration?.length) &&
      pendingToolCalls.length > 0 &&
      isIncompleteAssistantCompletion(completion) &&
      isTokenBudgetExhaustedCompletion(completion);

    if (shouldRetryIncompleteToolCallEmission) {
      const nextMaxTokens = getEscalatedToolCallEmissionMaxTokens(
        requestMaxTokens,
        params.requestModel,
      );
      if (
        toolCallEmissionRetryCount < MAX_INCOMPLETE_TOOL_CALL_EMISSION_RETRIES &&
        nextMaxTokens > requestMaxTokens
      ) {
        params.applyGraphEvents([
          {
            type: 'MODEL_TURN_FAILED',
            iteration: params.iteration,
            reason: 'incomplete_tool_call_emission_retry',
          },
        ]);
        params.callbacks.onAssistantStreamReset?.();
        requestMaxTokens = nextMaxTokens;
        params.callbacks.onStateChange('thinking');
        await params.yieldToUiFrame();
        continue attemptLoop;
      }
    }

    if (pendingToolCalls.length > 0 && isIncompleteAssistantCompletion(completion)) {
      const finishReason = completion?.finishReason || 'interrupted_tool_turn';
      params.callbacks.onAssistantStreamReset?.();
      params.applyGraphEvents([
        {
          type: 'MODEL_TURN_FAILED',
          iteration: params.iteration,
          reason: `incomplete_tool_call_emission_${finishReason}`,
        },
      ]);
      throw new Error(
        `The model response ended before tool-call emission completed (${finishReason}). Partial tool calls were discarded to avoid executing incomplete actions.`,
      );
    }

    return {
      completion,
      contextWindow,
      fullContent,
      pendingToolCalls,
      providerReplay,
      reasoning,
      requestMaxTokens,
      workingMessages,
    };
  }
}
