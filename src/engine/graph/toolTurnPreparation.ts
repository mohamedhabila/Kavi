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
      executableToolCalls: ReadonlyArray<PendingAgentToolCall>;
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
  callbacks: {
    onAssistantMessage: (
      content: string,
      toolCalls?: ToolCall[],
      providerReplay?: MessageProviderReplay,
      assistantCompletion?: AssistantMessageMetadata,
    ) => void;
  };
  yieldToUiFrame: () => Promise<void>;
}

export async function prepareAgentControlGraphToolTurn(
  params: PrepareAgentControlGraphToolTurnParams,
): Promise<PrepareAgentControlGraphToolTurnResult> {
  const executableToolCalls = trimAgentControlGraphPendingToolCallsAfterYield(
    params.pendingToolCalls,
  );
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

  params.callbacks.onAssistantMessage(
    assistantToolTurnContent,
    toolCallObjects,
    params.providerReplay,
    buildAssistantMessageMetadata('intermediate', params.completion),
  );
  await params.yieldToUiFrame();

  const workingMessages = [...params.workingMessages];
  workingMessages.push({
    id: `msg_${Date.now()}_assistant_${params.iteration}`,
    role: 'assistant',
    content: assistantToolTurnContent,
    toolCalls: toolCallObjects,
    timestamp: Date.now(),
    reasoning: params.reasoning || undefined,
    providerReplay: params.providerReplay,
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
    executableToolCalls,
    warningInjectedThisRound,
    workingMessages,
    ...(loopObservabilityDetail && loopRecoveryDecision.type === 'warning'
      ? { loopObservabilityDetail }
      : {}),
  };
}
