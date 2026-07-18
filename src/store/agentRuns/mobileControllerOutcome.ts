import { projectMobileControllerOutcomeToAgentRun } from '../../engine/graph/mobileControllerOutcomeProjection';
import type { ToolMessageOutcome } from '../../engine/toolExecution/toolMessageOutcome';
import type { AgentRunMobileControllerHandoffRef } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { Message, ToolCall } from '../../types/message';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { appendToolEffectReceipt, decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';

export type ApplyMobileControllerOutcomeResult =
  | Readonly<{ status: 'applied'; conversation: Conversation }>
  | Readonly<{ status: 'replayed'; conversation: Conversation }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'run_unavailable'
        | 'tool_call_identity_conflict'
        | 'tool_result_conflict'
        | 'graph_projection_rejected'
        | 'settlement_invalid';
    }>;

export type ApplyMobileControllerOutcomeInput = Readonly<{
  runId: string;
  handoff: AgentRunMobileControllerHandoffRef;
  receipt: ToolEffectReceipt;
  toolMessage: ToolMessageOutcome;
  settledAt: number;
}>;

type OwnedToolCall = Readonly<{
  messageIndex: number;
  toolCallIndex: number;
  message: Message;
  toolCall: ToolCall;
}>;

function findOwnedToolCall(
  messages: ReadonlyArray<Message>,
  toolCallId: string,
): OwnedToolCall | null {
  const matches: OwnedToolCall[] = [];
  messages.forEach((message, messageIndex) => {
    message.toolCalls?.forEach((toolCall, toolCallIndex) => {
      if (message.role === 'assistant' && toolCall.id === toolCallId) {
        matches.push({ messageIndex, toolCallIndex, message, toolCall });
      }
    });
  });
  return matches.length === 1 ? matches[0]! : null;
}

function existingToolResults(messages: ReadonlyArray<Message>, toolCallId: string): Message[] {
  return messages.filter(
    (message) => message.role === 'tool' && message.toolCallId === toolCallId,
  );
}

function receiptReplayMatches(toolCall: ToolCall, receipt: ToolEffectReceipt): boolean {
  try {
    return appendToolEffectReceipt(toolCall.effectReceipts, receipt, {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    }) === toolCall.effectReceipts;
  } catch {
    return false;
  }
}

function isExactReplay(params: {
  run: NonNullable<Conversation['agentRuns']>[number];
  owned: OwnedToolCall;
  receipt: ToolEffectReceipt;
  toolMessage: ToolMessageOutcome;
  toolResults: Message[];
}): boolean {
  const result = params.toolResults[0];
  const expectedStatus = params.toolMessage.status;
  return (
    params.toolResults.length === 1 &&
    result?.id === `${params.owned.message.id}_tool_${params.toolMessage.toolCallId}` &&
    result.content === params.toolMessage.content &&
    result.isError === (expectedStatus === 'failed') &&
    params.owned.toolCall.status === expectedStatus &&
    params.owned.toolCall.result === params.toolMessage.content &&
    receiptReplayMatches(params.owned.toolCall, params.receipt) &&
    params.run.controlGraph?.status === 'ready' &&
    params.run.controlGraph.pendingAsyncCount === 0 &&
    params.run.controlGraph.asyncWork.pendingOperations.length === 0
  );
}

/** Apply one journal-settled mobile outcome to chat and AgentRun state atomically. */
export function applyMobileControllerOutcomeInConversation(
  conversation: Conversation,
  input: ApplyMobileControllerOutcomeInput,
): ApplyMobileControllerOutcomeResult {
  const receipt = decodeToolEffectReceipt(input.receipt);
  if (
    !receipt ||
    !Number.isSafeInteger(input.settledAt) ||
    input.settledAt < 0 ||
    receipt.toolCallId !== input.handoff.toolCallId ||
    input.toolMessage.toolCallId !== input.handoff.toolCallId
  ) {
    return { status: 'rejected', reason: 'settlement_invalid' };
  }
  const runIndex = conversation.agentRuns?.findIndex((run) => run.id === input.runId) ?? -1;
  const run = runIndex >= 0 ? conversation.agentRuns?.[runIndex] : undefined;
  if (!run) return { status: 'rejected', reason: 'run_unavailable' };

  const owned = findOwnedToolCall(conversation.messages, input.handoff.toolCallId);
  if (!owned || owned.toolCall.name !== receipt.toolName) {
    return { status: 'rejected', reason: 'tool_call_identity_conflict' };
  }
  const toolResults = existingToolResults(conversation.messages, input.handoff.toolCallId);
  if (isExactReplay({ run, owned, receipt, toolMessage: input.toolMessage, toolResults })) {
    return { status: 'replayed', conversation };
  }
  if (toolResults.length > 0 || !['pending', 'running'].includes(owned.toolCall.status)) {
    return { status: 'rejected', reason: 'tool_result_conflict' };
  }

  const projection = projectMobileControllerOutcomeToAgentRun({
    run,
    handoff: input.handoff,
    receipt,
    toolMessage: input.toolMessage,
    settledAt: input.settledAt,
  });
  if (projection.kind !== 'projected') {
    return { status: 'rejected', reason: 'graph_projection_rejected' };
  }

  let effectReceipts: ReadonlyArray<ToolEffectReceipt>;
  try {
    effectReceipts = appendToolEffectReceipt(owned.toolCall.effectReceipts, receipt, {
      toolCallId: owned.toolCall.id,
      toolName: owned.toolCall.name,
    });
  } catch {
    return { status: 'rejected', reason: 'settlement_invalid' };
  }
  const completedToolCall: ToolCall = {
    ...owned.toolCall,
    status: input.toolMessage.status,
    result: input.toolMessage.content,
    updatedAt: input.settledAt,
    completedAt: input.settledAt,
    effectReceipts,
  };
  const providerToolCall = { ...completedToolCall };
  delete providerToolCall.effectReceipts;

  const messages = conversation.messages.map((message, messageIndex) => {
    if (messageIndex !== owned.messageIndex) return message;
    const toolCalls = [...(message.toolCalls ?? [])];
    toolCalls[owned.toolCallIndex] = completedToolCall;
    return { ...message, toolCalls };
  });
  messages.push({
    id: `${owned.message.id}_tool_${input.toolMessage.toolCallId}`,
    role: 'tool',
    content: input.toolMessage.content,
    toolCallId: input.toolMessage.toolCallId,
    toolCalls: [providerToolCall],
    timestamp: input.settledAt,
    isError: input.toolMessage.status === 'failed',
  });
  const agentRuns = [...(conversation.agentRuns ?? [])];
  agentRuns[runIndex] = {
    ...run,
    controlGraph: projection.controlGraph,
    updatedAt: Math.max(run.updatedAt, input.settledAt),
  };
  const nextConversation = {
    ...conversation,
    messages,
    agentRuns,
    updatedAt: Math.max(conversation.updatedAt, input.settledAt),
  };
  return { status: 'applied', conversation: nextConversation };
}
