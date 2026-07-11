import type { Conversation } from '../../types/conversation';
import type { AssistantMessageMetadata, Message } from '../../types/message';
import {
  buildAssistantMessageMetadata,
  hasCompleteFinalAssistantMetadata,
  mergeAssistantMessageMetadata,
} from '../../utils/assistantMessageMetadata';
import { generateId } from '../../utils/id';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import {
  mutateOwnedForegroundModelProjection,
  releaseForegroundModelProjection,
} from '../../store/foregroundModelProjectionOwnership';
import { foregroundModelProjectionOwnersEqual } from '../../utils/foregroundModelProjectionOwner';
import {
  completeForegroundModelExecution,
  foregroundModelProjectionOwnerForLease,
} from './foregroundModelExecutionJournal';
import { isForegroundModelExecutionOwnedByCurrentProcess } from './foregroundModelExecutionProcessOwnership';
import { listPendingForegroundModelExecutions } from './foregroundModelExecutionQueries';
import type {
  CompleteForegroundModelExecutionInput,
  ForegroundModelExecutionCursor,
  ForegroundModelExecutionLease,
  ForegroundModelTerminalStatus,
} from './foregroundModelExecutionTypes';
import {
  readToolEffectRestartDisposition,
  type ResolveToolEffectRestartDisposition,
  type ToolEffectRestartDisposition,
} from './toolEffectRestartDisposition';
import { projectToolCallAfterRestart } from './toolEffectRestartProjection';

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
  'projection_owner_missing',
  'projection_owner_changed',
  'generation_changed',
  'journal_unavailable',
] as const;

export type ForegroundModelRecoveryBlockReason =
  (typeof FOREGROUND_MODEL_RECOVERY_BLOCK_REASONS)[number];

interface InterruptedToolProjection {
  assistantMessageId: string;
  toolCallId: string;
  disposition: ToolEffectRestartDisposition;
}

export interface ForegroundModelRecoveryPlan {
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

type ForegroundModelRecoveryBlockedResult = Extract<
  ForegroundModelRecoveryResult,
  { kind: 'blocked' }
>;

export interface ForegroundModelRecoveryDependencies {
  listPending(input: {
    limit: number;
    after?: ForegroundModelExecutionCursor;
  }): ForegroundModelExecutionLease[];
  mutateProjection(
    lease: ForegroundModelExecutionLease,
    timestamp: number,
  ): ForegroundModelProjectionMutationResult;
  flushChatState(): Promise<void>;
  complete(input: CompleteForegroundModelExecutionInput): Promise<unknown>;
  releaseProjection(
    lease: ForegroundModelExecutionLease,
  ): 'released' | 'conversation_missing' | 'owner_changed';
  isCurrentProcessRun(lease: ForegroundModelExecutionLease): boolean;
  clock(): number;
}

export type ForegroundModelProjectionMutationResult =
  | {
      kind: 'applied';
      plan: ForegroundModelRecoveryPlan;
      conversation: Conversation;
    }
  | { kind: 'blocked'; runId: string; reason: ForegroundModelRecoveryBlockReason };

const DEFAULT_DEPENDENCIES: ForegroundModelRecoveryDependencies = {
  listPending: listPendingForegroundModelExecutions,
  mutateProjection: mutateForegroundModelProjectionForRecovery,
  flushChatState: flushChatStorePersistenceNow,
  complete: completeForegroundModelExecution,
  isCurrentProcessRun: (lease) => isForegroundModelExecutionOwnedByCurrentProcess(lease.runId),
  releaseProjection: (lease) =>
    releaseForegroundModelProjection({
      conversationId: lease.conversationId,
      owner: foregroundModelProjectionOwnerForLease(lease),
    }),
  clock: Date.now,
};

const FOREGROUND_MODEL_RECOVERY_PAGE_SIZE = 32;
const PERMANENT_PROJECTION_BLOCK_REASONS = new Set<ForegroundModelRecoveryBlockReason>([
  'conversation_missing',
  'conversation_ownership_mismatch',
  'request_message_missing',
  'assistant_anchor_missing',
  'message_order_invalid',
  'task_ownership_missing',
  'projection_owner_missing',
  'projection_owner_changed',
]);

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

function activeToolCalls(
  messages: ReadonlyArray<Message>,
  input: {
    conversationId: string;
    taskId: string | null;
    resolveToolEffect: ResolveToolEffectRestartDisposition;
  },
): InterruptedToolProjection[] {
  const interrupted: InterruptedToolProjection[] = [];
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.status === 'pending' || toolCall.status === 'running') {
        interrupted.push({
          assistantMessageId: message.id,
          toolCallId: toolCall.id,
          disposition: input.resolveToolEffect({
            conversationId: input.conversationId,
            taskId: input.taskId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            argumentsText: toolCall.arguments,
          }),
        });
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
): ForegroundModelRecoveryBlockedResult {
  return { kind: 'blocked', runId: lease.runId, reason };
}

export function planForegroundModelRestartRecovery(
  lease: ForegroundModelExecutionLease,
  conversation: Conversation | undefined,
  resolveToolEffect: ResolveToolEffectRestartDisposition = () => ({ kind: 'not_dispatched' }),
): ForegroundModelRecoveryPlan | ForegroundModelRecoveryBlockedResult {
  if (!conversation) return blocked(lease, 'conversation_missing');
  if (conversation.id !== lease.conversationId) {
    return blocked(lease, 'conversation_ownership_mismatch');
  }
  const expectedOwner = foregroundModelProjectionOwnerForLease(lease);
  if (!conversation.foregroundModelProjectionOwner) {
    return blocked(lease, 'projection_owner_missing');
  }
  if (
    !foregroundModelProjectionOwnersEqual(
      conversation.foregroundModelProjectionOwner,
      expectedOwner,
    )
  ) {
    return blocked(lease, 'projection_owner_changed');
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
    !conversation.agentRuns?.some(
      (agentRun) =>
        agentRun.id === lease.taskId && agentRun.userMessageId === lease.requestMessageId,
    )
  ) {
    return blocked(lease, 'task_ownership_missing');
  }

  const ownedAssistantMessages = assistantMessages.slice(anchorIndex);
  const interruptedTools = activeToolCalls(ownedAssistantMessages, {
    conversationId: lease.conversationId,
    taskId: lease.taskId,
    resolveToolEffect,
  });
  const projection =
    [...ownedAssistantMessages].reverse().find((message) => !message.subAgentEvent) ??
    ownedAssistantMessages.at(-1)!;
  if (
    hasCompleteFinalAssistantMetadata(projection) &&
    interruptedTools.every((tool) => tool.disposition.kind === 'verified')
  ) {
    return {
      lease,
      status: 'succeeded',
      projectionMessageId: projection.id,
      shouldInsertInterruptionText: false,
      interruptedTools,
    };
  }

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
  conversation: Conversation,
  timestamp: number,
): Conversation {
  if (
    plan.status !== 'failed' &&
    plan.interruptedTools.every((tool) => tool.disposition.kind !== 'verified')
  ) {
    return conversation;
  }
  const interruptedToolsByKey = new Map(
    plan.interruptedTools.map((tool) => [
      `${tool.assistantMessageId}\u0000${tool.toolCallId}`,
      tool.disposition,
    ]),
  );
  const messages = conversation.messages.map((message) => {
    const toolCalls = message.toolCalls?.map((toolCall) => {
      const disposition = interruptedToolsByKey.get(`${message.id}\u0000${toolCall.id}`);
      if (!disposition) return toolCall;
      return projectToolCallAfterRestart({
        toolCall,
        disposition,
        timestamp,
        interruptedErrorMessage: INTERRUPTED_TOOL_ERROR,
      }).toolCall;
    });
    if (message.id !== plan.projectionMessageId) {
      return toolCalls === message.toolCalls ? message : { ...message, toolCalls };
    }
    if (plan.status !== 'failed' || !plan.interruptedAssistantMetadata) {
      return toolCalls === message.toolCalls ? message : { ...message, toolCalls };
    }
    return {
      ...message,
      ...(plan.shouldInsertInterruptionText ? { content: INTERRUPTED_RESPONSE_TEXT } : {}),
      ...(toolCalls ? { toolCalls } : {}),
      assistantMetadata: mergeAssistantMessageMetadata(
        message.assistantMetadata,
        plan.interruptedAssistantMetadata,
      ),
    };
  });
  if (plan.status !== 'failed') {
    return { ...conversation, messages, updatedAt: Math.max(conversation.updatedAt, timestamp) };
  }
  return {
    ...conversation,
    messages,
    updatedAt: Math.max(conversation.updatedAt, timestamp),
    logs: [
      ...(conversation.logs ?? []),
      {
        id: generateId(),
        kind: 'error' as const,
        level: 'warning' as const,
        title: 'Response interrupted after app restart',
        detail: 'The local model turn was closed without replaying model or tool execution.',
        timestamp,
      },
    ].slice(-250),
  };
}

function mutateForegroundModelProjectionForRecovery(
  lease: ForegroundModelExecutionLease,
  timestamp: number,
): ForegroundModelProjectionMutationResult {
  const mutation = mutateOwnedForegroundModelProjection<
    | { plan: ForegroundModelRecoveryPlan; conversation: Conversation }
    | ForegroundModelRecoveryBlockedResult
  >({
    conversationId: lease.conversationId,
    owner: foregroundModelProjectionOwnerForLease(lease),
    mutate: (conversation) => {
      const plan = planForegroundModelRestartRecovery(
        lease,
        conversation,
        readToolEffectRestartDisposition,
      );
      if ('kind' in plan) return { kind: 'rejected', value: plan };
      const nextConversation = applyRecoveryPlan(plan, conversation, timestamp);
      return {
        kind: 'applied',
        conversation: nextConversation,
        value: { plan, conversation: nextConversation },
      };
    },
  });
  if (mutation.kind === 'conversation_missing') {
    return blocked(lease, 'conversation_missing');
  }
  if (mutation.kind === 'owner_changed') {
    return blocked(lease, 'projection_owner_changed');
  }
  if (mutation.kind === 'rejected') {
    return mutation.value as ForegroundModelRecoveryBlockedResult;
  }
  if ('kind' in mutation.value) {
    return mutation.value;
  }
  return { kind: 'applied', ...mutation.value };
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
  const applied: Array<{
    plan: ForegroundModelRecoveryPlan;
    conversation: Conversation;
  }> = [];
  const results: ForegroundModelRecoveryResult[] = [];
  const timestamp = dependencies.clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('foreground_model_recovery_invalid_clock');
  }

  let after: ForegroundModelExecutionCursor | undefined;
  while (true) {
    const leases = dependencies.listPending({
      limit: FOREGROUND_MODEL_RECOVERY_PAGE_SIZE,
      ...(after ? { after } : {}),
    });
    if (leases.length === 0) break;
    for (const lease of leases) {
      if (dependencies.isCurrentProcessRun(lease)) continue;
      const mutation = dependencies.mutateProjection(lease, timestamp);
      if (mutation.kind === 'blocked') {
        if (PERMANENT_PROJECTION_BLOCK_REASONS.has(mutation.reason)) {
          const terminalStatus = lease.expectedStatus === 'queued' ? 'cancelled' : 'failed';
          try {
            await dependencies.complete({
              lease,
              status: terminalStatus,
              projectionMessageId: lease.assistantMessageId,
              projectionState: {
                recovery:
                  terminalStatus === 'cancelled'
                    ? 'unclaimed_before_model'
                    : 'unrecoverable_projection',
                runId: lease.runId,
                reason: mutation.reason,
              },
            });
            const release = dependencies.releaseProjection(lease);
            if (release === 'released') {
              await dependencies.flushChatState();
            }
            results.push({
              kind: 'recovered',
              runId: lease.runId,
              status: terminalStatus,
            });
          } catch (error: unknown) {
            results.push(blocked(lease, classifyCompletionError(error)));
          }
          continue;
        }
        results.push(mutation);
        continue;
      }
      applied.push(mutation);
    }
    const last = leases.at(-1)!;
    after = { createdAt: last.createdAt, runId: last.runId };
    if (leases.length < FOREGROUND_MODEL_RECOVERY_PAGE_SIZE) break;
  }
  if (applied.length > 0) {
    try {
      await dependencies.flushChatState();
    } catch {
      return [...results, ...applied.map(({ plan }) => blocked(plan.lease, 'journal_unavailable'))];
    }
  }

  const released: Array<{
    plan: ForegroundModelRecoveryPlan;
    result: ForegroundModelRecoveryResult;
  }> = [];
  for (const { plan, conversation } of applied) {
    try {
      await dependencies.complete({
        lease: plan.lease,
        status: plan.status,
        projectionMessageId: plan.projectionMessageId,
        projectionState: projectionState(plan, conversation),
      });
      const release = dependencies.releaseProjection(plan.lease);
      if (release !== 'released') {
        results.push(blocked(plan.lease, 'generation_changed'));
        continue;
      }
      released.push({
        plan,
        result: { kind: 'recovered', runId: plan.lease.runId, status: plan.status },
      });
    } catch (error: unknown) {
      results.push(blocked(plan.lease, classifyCompletionError(error)));
    }
  }
  if (released.length > 0) {
    try {
      await dependencies.flushChatState();
      results.push(...released.map(({ result }) => result));
    } catch {
      results.push(...released.map(({ plan }) => blocked(plan.lease, 'journal_unavailable')));
    }
  }
  return results;
}
