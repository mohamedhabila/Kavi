import type { Conversation } from '../../types/conversation';
import type { AssistantMessageMetadata, Message } from '../../types/message';
import { buildAssistantMessageMetadata, hasCompleteFinalAssistantMetadata } from '../../utils/assistantMessageMetadata';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import {
  completeForegroundModelExecution,
  listPendingForegroundModelExecutions,
  type CompleteForegroundModelExecutionInput,
  type ForegroundModelExecutionLease,
  type ForegroundModelTerminalStatus,
} from './foregroundModelExecutionJournal';

const INTERRUPTED_RESPONSE_TEXT =
  'Response interrupted because the app restarted before completion.';
const INTERRUPTED_TOOL_ERROR =
  'Tool execution was interrupted by an app restart. Verify any external effect before retrying.';

export const FOREGROUND_MODEL_RECOVERY_BLOCK_REASONS = [
  'conversation_missing',
  'conversation_ownership_mismatch',
  'request_message_missing',
  'assistant_anchor_missing',
  'message_order_invalid',
  'task_ownership_missing',
  'generation_changed',
  'journal_unavailable',
] as const;

export type ForegroundModelRecoveryBlockReason =
  (typeof FOREGROUND_MODEL_RECOVERY_BLOCK_REASONS)[number];

interface InterruptedToolProjection {
  assistantMessageId: string;
  toolCallId: string;
}

interface ForegroundModelRecoveryPlan {
  lease: ForegroundModelExecutionLease;
  status: ForegroundModelTerminalStatus;
  projectionMessageId: string;
  interruptedAssistantMetadata?: AssistantMessageMetadata;
  shouldInsertInterruptionText: boolean;
  interruptedTools: InterruptedToolProjection[];
}

export type ForegroundModelRecoveryResult =
  | { kind: 'recovered'; runId: string; status: ForegroundModelTerminalStatus }
  | { kind: 'blocked'; runId: string; reason: ForegroundModelRecoveryBlockReason };

export interface ForegroundModelRecoveryDependencies {
  listPending(): ForegroundModelExecutionLease[];
  getConversation(conversationId: string): Conversation | undefined;
  updateMessage(conversationId: string, messageId: string, content: string): void;
  updateAssistantMetadata(
    conversationId: string,
    messageId: string,
    metadata: AssistantMessageMetadata,
  ): void;
  failToolCall(
    conversationId: string,
    assistantMessageId: string,
    toolCallId: string,
    completedAt: number,
  ): void;
  appendRecoveryLog(conversationId: string, timestamp: number): void;
  flushChatState(): Promise<void>;
  complete(input: CompleteForegroundModelExecutionInput): Promise<unknown>;
  clock(): number;
}

const DEFAULT_DEPENDENCIES: ForegroundModelRecoveryDependencies = {
  listPending: listPendingForegroundModelExecutions,
  getConversation: (conversationId) =>
    useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId),
  updateMessage: (conversationId, messageId, content) =>
    useChatStore.getState().updateMessage(conversationId, messageId, content),
  updateAssistantMetadata: (conversationId, messageId, metadata) =>
    useChatStore
      .getState()
      .updateMessageAssistantMetadata(conversationId, messageId, metadata),
  failToolCall: (conversationId, assistantMessageId, toolCallId, completedAt) =>
    useChatStore
      .getState()
      .updateToolCallStatus(conversationId, assistantMessageId, toolCallId, 'failed', {
        error: INTERRUPTED_TOOL_ERROR,
        completedAt,
      }),
  appendRecoveryLog: (conversationId, timestamp) =>
    useChatStore.getState().addConversationLog(conversationId, {
      kind: 'error',
      level: 'warning',
      title: 'Response interrupted after app restart',
      detail: 'The local model turn was closed without replaying model or tool execution.',
      timestamp,
    }),
  flushChatState: flushChatStorePersistenceNow,
  complete: completeForegroundModelExecution,
  clock: Date.now,
};

function assistantMessagesInRequestSlice(
  conversation: Conversation,
  requestIndex: number,
): Message[] {
  const followingMessages = conversation.messages.slice(requestIndex + 1);
  const nextUserOffset = followingMessages.findIndex((message) => message.role === 'user');
  const requestSlice =
    nextUserOffset < 0 ? followingMessages : followingMessages.slice(0, nextUserOffset);
  return requestSlice.filter((message) => message.role === 'assistant');
}

function activeToolCalls(messages: ReadonlyArray<Message>): InterruptedToolProjection[] {
  const interrupted: InterruptedToolProjection[] = [];
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.status === 'pending' || toolCall.status === 'running') {
        interrupted.push({ assistantMessageId: message.id, toolCallId: toolCall.id });
      }
    }
  }
  return interrupted;
}

function incompleteMetadata(message: Message): AssistantMessageMetadata {
  return buildAssistantMessageMetadata(
    message.subAgentEvent || (message.toolCalls?.length ?? 0) > 0 ? 'intermediate' : 'final',
    {
      completionStatus: 'incomplete',
      finishReason: 'app_restarted',
    },
  );
}

function blocked(
  lease: ForegroundModelExecutionLease,
  reason: ForegroundModelRecoveryBlockReason,
): ForegroundModelRecoveryResult {
  return { kind: 'blocked', runId: lease.runId, reason };
}

export function planForegroundModelRestartRecovery(
  lease: ForegroundModelExecutionLease,
  conversation: Conversation | undefined,
): ForegroundModelRecoveryPlan | ForegroundModelRecoveryResult {
  if (!conversation) return blocked(lease, 'conversation_missing');
  if (conversation.id !== lease.conversationId) {
    return blocked(lease, 'conversation_ownership_mismatch');
  }
  const requestIndex = conversation.messages.findIndex(
    (message) => message.id === lease.requestMessageId && message.role === 'user',
  );
  if (requestIndex < 0) return blocked(lease, 'request_message_missing');
  const assistantMessages = assistantMessagesInRequestSlice(conversation, requestIndex);
  const anchorIndex = assistantMessages.findIndex(
    (message) => message.id === lease.assistantMessageId,
  );
  if (anchorIndex < 0) return blocked(lease, 'assistant_anchor_missing');
  const absoluteAnchorIndex = conversation.messages.findIndex(
    (message) => message.id === lease.assistantMessageId,
  );
  if (absoluteAnchorIndex <= requestIndex) return blocked(lease, 'message_order_invalid');
  if (
    lease.taskId !== null &&
    !conversation.agentRuns?.some((agentRun) => agentRun.id === lease.taskId)
  ) {
    return blocked(lease, 'task_ownership_missing');
  }

  const interruptedTools = activeToolCalls(assistantMessages);
  const completeFinal = [...assistantMessages]
    .reverse()
    .find(hasCompleteFinalAssistantMetadata);
  if (completeFinal && interruptedTools.length === 0) {
    return {
      lease,
      status: 'succeeded',
      projectionMessageId: completeFinal.id,
      shouldInsertInterruptionText: false,
      interruptedTools: [],
    };
  }

  const projection =
    [...assistantMessages].reverse().find((message) => !message.subAgentEvent) ??
    assistantMessages.at(-1)!;
  return {
    lease,
    status: 'failed',
    projectionMessageId: projection.id,
    interruptedAssistantMetadata: incompleteMetadata(projection),
    shouldInsertInterruptionText: projection.content.trim().length === 0,
    interruptedTools,
  };
}

function applyRecoveryPlan(
  plan: ForegroundModelRecoveryPlan,
  dependencies: ForegroundModelRecoveryDependencies,
  timestamp: number,
): void {
  if (plan.status !== 'failed' || !plan.interruptedAssistantMetadata) return;
  for (const tool of plan.interruptedTools) {
    dependencies.failToolCall(
      plan.lease.conversationId,
      tool.assistantMessageId,
      tool.toolCallId,
      timestamp,
    );
  }
  if (plan.shouldInsertInterruptionText) {
    dependencies.updateMessage(
      plan.lease.conversationId,
      plan.projectionMessageId,
      INTERRUPTED_RESPONSE_TEXT,
    );
  }
  dependencies.updateAssistantMetadata(
    plan.lease.conversationId,
    plan.projectionMessageId,
    plan.interruptedAssistantMetadata,
  );
  dependencies.appendRecoveryLog(plan.lease.conversationId, timestamp);
}

function projectionState(
  plan: ForegroundModelRecoveryPlan,
  conversation: Conversation,
): CompleteForegroundModelExecutionInput['projectionState'] {
  return {
    recovery: 'app_restart_projection',
    conversationId: conversation.id,
    requestMessageId: plan.lease.requestMessageId,
    projectionMessageId: plan.projectionMessageId,
    status: plan.status,
    assistantMessage: conversation.messages.find(
      (message) => message.id === plan.projectionMessageId,
    ),
    agentRun: plan.lease.taskId
      ? conversation.agentRuns?.find((agentRun) => agentRun.id === plan.lease.taskId)
      : undefined,
  };
}

function classifyCompletionError(error: unknown): ForegroundModelRecoveryBlockReason {
  return error instanceof Error && error.message.includes('generation_changed')
    ? 'generation_changed'
    : 'journal_unavailable';
}

/** Repair prior-process chat projections and close their process-bound journal generations. */
export async function recoverInterruptedForegroundModelExecutions(
  dependencies: ForegroundModelRecoveryDependencies = DEFAULT_DEPENDENCIES,
): Promise<ForegroundModelRecoveryResult[]> {
  const leases = dependencies.listPending();
  const plans: ForegroundModelRecoveryPlan[] = [];
  const results: ForegroundModelRecoveryResult[] = [];
  const timestamp = dependencies.clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('foreground_model_recovery_invalid_clock');
  }

  for (const lease of leases) {
    const plan = planForegroundModelRestartRecovery(
      lease,
      dependencies.getConversation(lease.conversationId),
    );
    if ('kind' in plan) {
      results.push(plan);
      continue;
    }
    applyRecoveryPlan(plan, dependencies, timestamp);
    plans.push(plan);
  }
  if (plans.length > 0) {
    try {
      await dependencies.flushChatState();
    } catch {
      return [
        ...results,
        ...plans.map((plan) => blocked(plan.lease, 'journal_unavailable')),
      ];
    }
  }

  for (const plan of plans) {
    const conversation = dependencies.getConversation(plan.lease.conversationId);
    if (!conversation) {
      results.push(blocked(plan.lease, 'conversation_missing'));
      continue;
    }
    try {
      await dependencies.complete({
        lease: plan.lease,
        status: plan.status,
        projectionMessageId: plan.projectionMessageId,
        projectionState: projectionState(plan, conversation),
      });
      results.push({ kind: 'recovered', runId: plan.lease.runId, status: plan.status });
    } catch (error: unknown) {
      results.push(blocked(plan.lease, classifyCompletionError(error)));
    }
  }
  return results;
}
