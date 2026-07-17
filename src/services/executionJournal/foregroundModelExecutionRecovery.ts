import type { Conversation } from '../../types/conversation';
import type { AssistantMessageMetadata, Message } from '../../types/message';
import {
  buildAssistantMessageMetadata,
  hasCompleteFinalAssistantMetadata,
  mergeAssistantMessageMetadata,
} from '../../utils/assistantMessageMetadata';
import { generateId } from '../../utils/id';
import { normalizeMessageMemoryPublication } from '../../utils/messageMemoryPublication';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import {
  mutateOwnedModelProjection,
  releaseModelProjection,
} from '../../store/modelProjectionOwnership';
import { modelProjectionOwnersEqual } from '../../utils/modelProjectionOwner';
import {
  completeForegroundModelExecution,
  modelProjectionOwnerForForegroundLease,
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
  settleMessageMemoryPublication,
  type MessageMemoryPublicationSettlementResult,
} from '../memory/messageMemoryPublicationSettlement';
import { AGENT_RUNTIME_ERROR_CODES, isAgentRuntimeErrorCode } from '../runtimeError';
import {
  buildToolEffectRestartDispositionResolver,
  type ResolveToolEffectRestartDisposition,
  type ToolEffectRestartDisposition,
  type ToolEffectRestartLookupInput,
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
  'effect_reconciliation_pending',
  'generation_changed',
  'journal_unavailable',
  'memory_publication_pending',
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
  ): Promise<ForegroundModelRecoveryProjectionMutationResult>;
  flushChatState(): Promise<void>;
  settleMemoryPublication(input: {
    conversationId: string;
    sourceEndMessageId: string;
    sourceRunId?: string;
  }): Promise<MessageMemoryPublicationSettlementResult>;
  complete(input: CompleteForegroundModelExecutionInput): Promise<unknown>;
  releaseProjection(
    lease: ForegroundModelExecutionLease,
  ): 'released' | 'conversation_missing' | 'owner_changed';
  isCurrentProcessRun(lease: ForegroundModelExecutionLease): boolean;
  clock(): number;
}

export type ForegroundModelRecoveryProjectionMutationResult =
  | {
      kind: 'applied';
      plan: ForegroundModelRecoveryPlan;
      conversation: Conversation;
    }
  | { kind: 'blocked'; runId: string; reason: ForegroundModelRecoveryBlockReason };

const DEFAULT_DEPENDENCIES: ForegroundModelRecoveryDependencies = {
  listPending: listPendingForegroundModelExecutions,
  mutateProjection: mutateModelProjectionForForegroundRecovery,
  flushChatState: flushChatStorePersistenceNow,
  settleMemoryPublication: settleMessageMemoryPublication,
  complete: completeForegroundModelExecution,
  isCurrentProcessRun: (lease) => isForegroundModelExecutionOwnedByCurrentProcess(lease.runId),
  releaseProjection: (lease) =>
    releaseModelProjection({
      conversationId: lease.conversationId,
      owner: modelProjectionOwnerForForegroundLease(lease),
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
    executionRunId: string;
    resolveToolEffect: ResolveToolEffectRestartDisposition;
  },
): InterruptedToolProjection[] {
  return messages.flatMap((message) =>
    (message.toolCalls ?? [])
      .filter((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running')
      .map((toolCall) => ({
        assistantMessageId: message.id,
        toolCallId: toolCall.id,
        disposition: input.resolveToolEffect({
          conversationId: input.conversationId,
          executionRunId: input.executionRunId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          argumentsText: toolCall.arguments,
        }),
      })),
  );
}

function foregroundToolEffectRestartInputs(
  lease: ForegroundModelExecutionLease,
  conversation: Conversation | undefined,
): ToolEffectRestartLookupInput[] {
  if (!conversation || conversation.id !== lease.conversationId) return [];
  const requestIndex = conversation.messages.findIndex(
    (message) => message.id === lease.requestMessageId && message.role === 'user',
  );
  if (requestIndex < 0) return [];
  const assistantMessages = assistantMessagesInRequestSlice(conversation, requestIndex);
  const anchorIndex = assistantMessages.findIndex(
    (message) => message.id === lease.assistantMessageId,
  );
  if (anchorIndex < 0) return [];
  return assistantMessages.slice(anchorIndex).flatMap((message) =>
    (message.toolCalls ?? [])
      .filter((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running')
      .map((toolCall) => ({
        conversationId: lease.conversationId,
        executionRunId: lease.runId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        argumentsText: toolCall.arguments,
      })),
  );
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
  const expectedOwner = modelProjectionOwnerForForegroundLease(lease);
  if (!conversation.modelProjectionOwner) {
    return blocked(lease, 'projection_owner_missing');
  }
  if (!modelProjectionOwnersEqual(conversation.modelProjectionOwner, expectedOwner)) {
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
    executionRunId: lease.runId,
    resolveToolEffect,
  });
  if (interruptedTools.some((tool) => tool.disposition.kind === 'reconciliation_required')) {
    return blocked(lease, 'effect_reconciliation_pending');
  }
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

export function applyForegroundModelRecoveryPlan(
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
    // AgentRun recovery is the sole owner of task tool projection and counters.
    // Plain chat has no AgentRun owner, so this journal projects those tools.
    const toolCalls =
      plan.lease.taskId === null
        ? message.toolCalls?.map((toolCall) => {
            const disposition = interruptedToolsByKey.get(`${message.id}\u0000${toolCall.id}`);
            if (!disposition) return toolCall;
            return projectToolCallAfterRestart({
              toolCall,
              disposition,
              timestamp,
              interruptedErrorMessage: INTERRUPTED_TOOL_ERROR,
            }).toolCall;
          })
        : message.toolCalls;
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

async function mutateModelProjectionForForegroundRecovery(
  lease: ForegroundModelExecutionLease,
  timestamp: number,
): Promise<ForegroundModelRecoveryProjectionMutationResult> {
  const conversationSnapshot = useChatStore
    .getState()
    .conversations.find((conversation) => conversation.id === lease.conversationId);
  const resolveToolEffect = await buildToolEffectRestartDispositionResolver(
    foregroundToolEffectRestartInputs(lease, conversationSnapshot),
  );
  const mutation = mutateOwnedModelProjection<
    | { plan: ForegroundModelRecoveryPlan; conversation: Conversation }
    | ForegroundModelRecoveryBlockedResult
  >({
    conversationId: lease.conversationId,
    owner: modelProjectionOwnerForForegroundLease(lease),
    mutate: (conversation) => {
      const plan = planForegroundModelRestartRecovery(lease, conversation, resolveToolEffect);
      if ('kind' in plan) return { kind: 'rejected', value: plan };
      const nextConversation = applyForegroundModelRecoveryPlan(plan, conversation, timestamp);
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
  return isAgentRuntimeErrorCode(
    error,
    AGENT_RUNTIME_ERROR_CODES.FOREGROUND_MODEL_GENERATION_CHANGED,
  )
    ? 'generation_changed'
    : 'journal_unavailable';
}

function hasOpenMemoryPublication(
  plan: ForegroundModelRecoveryPlan,
  conversation: Conversation,
): boolean {
  const source = conversation.messages.find((message) => message.id === plan.projectionMessageId);
  return (
    plan.status === 'succeeded' &&
    normalizeMessageMemoryPublication(source?.memoryPublication)?.disposition === null
  );
}

async function settleRecoveryMemoryPublication(
  plan: ForegroundModelRecoveryPlan,
  conversation: Conversation,
  dependencies: ForegroundModelRecoveryDependencies,
): Promise<boolean> {
  if (!hasOpenMemoryPublication(plan, conversation)) return true;
  try {
    const settlement = await dependencies.settleMemoryPublication({
      conversationId: plan.lease.conversationId,
      sourceEndMessageId: plan.projectionMessageId,
      ...(plan.lease.taskId !== null ? { sourceRunId: plan.lease.taskId } : {}),
    });
    return (
      settlement.conversationId === plan.lease.conversationId &&
      settlement.sourceEndMessageId === plan.projectionMessageId &&
      (settlement.status === 'terminal' || settlement.status === 'settled') &&
      settlement.disposition !== undefined
    );
  } catch {
    return false;
  }
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
      const mutation = await dependencies.mutateProjection(lease, timestamp);
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
    if (!(await settleRecoveryMemoryPublication(plan, conversation, dependencies))) {
      results.push(blocked(plan.lease, 'memory_publication_pending'));
      continue;
    }
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
