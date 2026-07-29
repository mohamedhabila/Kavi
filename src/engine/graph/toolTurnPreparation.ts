import type { AgentGoal } from '../../types/agentRun';
import type {
  AssistantCompletionMetadata,
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  detectLoops,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../loopDetection';
import { resolveAssistantToolTurnContent } from './assistantToolTurnContent';
import { buildAgentControlGraphLoopRecoveryDecision } from './loopRecovery';
import { buildLoopDetectedObservabilityDetail } from './graphObservability';
import type { PendingAgentToolCall } from './modelTurnExecutionTypes';
import { trimAgentControlGraphPendingToolCallsAfterYield } from './sessionsYield';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';

export type PrepareAgentControlGraphToolTurnResult =
  | {
      status: 'finalized';
      warningInjectedThisRound: boolean;
      workingMessages: Message[];
    }
  | {
      status: 'blocked';
      warningInjectedThisRound: boolean;
      workingMessages: Message[];
      blockDetails: string;
      loopObservabilityDetail?: string;
    }
  | {
      status: 'prepared';
      assistantMetadata: AssistantMessageMetadata;
      assistantToolTurnContent: string;
      executableToolCalls: ReadonlyArray<PendingAgentToolCall>;
      toolCallObjects: ToolCall[];
      warningInjectedThisRound: boolean;
      workingMessages: Message[];
      loopObservabilityDetail?: string;
    };

export interface PrepareAgentControlGraphToolTurnParams {
  iteration: number;
  maxToolIterations: number;
  toolCallHistory: ToolCallRecord[];
  stagnationSignatures: ReadonlyArray<IterationProgressSignature>;
  warningInjectedThisRound: boolean;
  turnAssistantContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  pendingToolCalls: ReadonlyArray<PendingAgentToolCall>;
  goals?: ReadonlyArray<AgentGoal>;
  workingMessages: Message[];
}

export function prepareAgentControlGraphToolTurn(
  params: PrepareAgentControlGraphToolTurnParams,
): PrepareAgentControlGraphToolTurnResult {
  const yieldedToolCalls = trimAgentControlGraphPendingToolCallsAfterYield(params.pendingToolCalls);
  const clarificationToolCall = yieldedToolCalls.find(
    (toolCall) => normalizeToolName(toolCall.name) === REQUEST_CLARIFICATION_TOOL_NAME,
  );
  const executableToolCalls = clarificationToolCall ? [clarificationToolCall] : yieldedToolCalls;
  const loopCheck = detectLoops(params.toolCallHistory, params.stagnationSignatures, {
    goals: params.goals,
  });
  const toolCallObjects: ToolCall[] = executableToolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
    ...(toolCall.raw ? { raw: toolCall.raw } : {}),
    status: 'pending',
  }));
  const assistantToolTurnContent = resolveAssistantToolTurnContent({
    content: params.turnAssistantContent,
    toolCalls: toolCallObjects,
  });
  const assistantMetadata = buildAssistantMessageMetadata('intermediate', params.completion);

  const workingMessages = [...params.workingMessages];
  workingMessages.push({
    id: `msg_${Date.now()}_assistant_${params.iteration}`,
    role: 'assistant',
    content: assistantToolTurnContent,
    toolCalls: toolCallObjects,
    timestamp: Date.now(),
    reasoning: params.reasoning || undefined,
    providerReplay: params.providerReplay,
    assistantMetadata,
  });

  const loopRecoveryDecision = buildAgentControlGraphLoopRecoveryDecision({
    loopCheck,
    warningAlreadyInjected: params.warningInjectedThisRound,
    iteration: params.iteration,
    maxIterations: params.maxToolIterations,
    toolCallHistory: params.toolCallHistory,
    goals: params.goals,
  });
  const loopObservabilityDetail = buildLoopDetectedObservabilityDetail(loopCheck);
  if (loopRecoveryDecision.type === 'block') {
    return {
      status: 'blocked',
      warningInjectedThisRound: params.warningInjectedThisRound,
      workingMessages,
      blockDetails: loopRecoveryDecision.details,
      ...(loopObservabilityDetail ? { loopObservabilityDetail } : {}),
    };
  }

  let warningInjectedThisRound = params.warningInjectedThisRound;
  if (loopRecoveryDecision.type === 'warning') {
    workingMessages.push({
      id: `msg_${Date.now()}_loop_warning_${params.iteration}`,
      role: 'system',
      content: loopRecoveryDecision.warningMessage,
      timestamp: Date.now(),
    });
    warningInjectedThisRound = loopRecoveryDecision.nextWarningState;
  } else if (loopRecoveryDecision.shouldResetWarningState) {
    warningInjectedThisRound = false;
  }

  return {
    status: 'prepared',
    assistantMetadata,
    assistantToolTurnContent,
    executableToolCalls,
    toolCallObjects,
    warningInjectedThisRound,
    workingMessages,
    ...(loopObservabilityDetail && loopRecoveryDecision.type === 'warning'
      ? { loopObservabilityDetail }
      : {}),
  };
}
