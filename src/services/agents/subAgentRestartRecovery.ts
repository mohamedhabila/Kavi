import { normalizeToolName } from '../../engine/tools/toolNameNormalization';
import {
  isEffectFreeToolPolicy,
  resolveToolEffectPolicy,
} from '../../engine/durability/toolEffectPolicy';
import { isCodeOwnedEffectFreeInvocation } from '../executionJournal/toolEffectDispatchLifecycle';
import type { Message, ToolCall } from '../../types/message';
import type { SubAgentConfig, SubAgentSnapshot } from '../../types/subAgent';
import { generateId } from '../../utils/id';
import type { SubAgentSessionContext } from './lifecycle/sessionContext';
import { cloneStoredMessages, normalizeSubAgentPrompt } from './lifecycle/sessionContextMessages';

const RESTART_INTERRUPTION_ERROR =
  'The app restarted before this effect-free tool returned a successful result.';

type RecoverableEffectFreeCall = {
  assistantMessage: Message;
  toolCall: ToolCall;
  toolName: string;
  argumentsValue: unknown;
};

export type SubAgentRestartRecoveryPlan = {
  config: SubAgentConfig;
  recoveryBoundary: 'interrupted_effect_free_call' | 'effect_free_checkpoint';
  interruptedToolCallId?: string;
  interruptedToolName?: string;
  recoveredAt: number;
  remainingTimeoutMs?: number;
};

function readToolArguments(argumentsText: string): unknown {
  try {
    return JSON.parse(argumentsText || '{}') as unknown;
  } catch {
    return undefined;
  }
}

function hasExplicitWaitDuration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ms === 'number' &&
    Number.isFinite(candidate.ms) &&
    (candidate.reason === undefined || typeof candidate.reason === 'string')
  );
}

function collectUnmatchedToolCalls(
  messages: readonly Message[],
): Array<{ assistantMessage: Message; toolCall: ToolCall }> {
  const settledToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const toolCallId = message.toolCallId || message.toolCalls?.[0]?.id;
    if (toolCallId) settledToolCallIds.add(toolCallId);
  }

  const unmatched: Array<{ assistantMessage: Message; toolCall: ToolCall }> = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const toolCall of message.toolCalls ?? []) {
      // Provider replay requires a tool-role message for every assistant tool call regardless of
      // the app-local status stored on that call. A crash can land after the local call object is
      // marked completed/failed but before its tool message is checkpointed. Treat that boundary
      // as unmatched so effect-free recovery can pair it with explicit interruption evidence and
      // side-effecting recovery continues to fail closed.
      if (!settledToolCallIds.has(toolCall.id)) {
        unmatched.push({ assistantMessage: message, toolCall });
      }
    }
  }

  return unmatched;
}

function findRecoverableEffectFreeCall(
  messages: readonly Message[],
  unmatched: ReadonlyArray<{ assistantMessage: Message; toolCall: ToolCall }>,
): RecoverableEffectFreeCall | null {
  if (unmatched.length !== 1) return null;
  const pending = unmatched[0]!;
  const assistantIndex = messages.indexOf(pending.assistantMessage);
  if (assistantIndex < 0) return null;
  const batchToolCallIds = new Set(
    (pending.assistantMessage.toolCalls ?? []).map((toolCall) => toolCall.id),
  );
  // A process can die after some siblings in one parallel effect-free batch have checkpointed.
  // Appending the one missing result remains provider-valid only when the declaring assistant
  // message is followed exclusively by tool results from that same batch. Any later model/user
  // turn makes the boundary ambiguous and must continue to fail closed.
  const hasCoherentBatchTail = messages.slice(assistantIndex + 1).every((message) => {
    if (message.role !== 'tool') return false;
    const toolCallId = message.toolCallId || message.toolCalls?.[0]?.id;
    return Boolean(toolCallId && batchToolCallIds.has(toolCallId));
  });
  if (!hasCoherentBatchTail) return null;
  const toolName = normalizeToolName(pending.toolCall.name);
  if (!isCodeOwnedEffectFreeInvocation(toolName, pending.toolCall.arguments)) return null;
  const argumentsValue = readToolArguments(pending.toolCall.arguments);
  if (argumentsValue === undefined) return null;
  // `wait` is safe to replay only when the interrupted duration was explicit. This preserves the
  // original deterministic recovery boundary instead of turning malformed legacy calls into an
  // open-ended delay.
  if (toolName === 'wait' && !hasExplicitWaitDuration(argumentsValue)) return null;
  return { ...pending, toolName, argumentsValue };
}

function hasExplicitEffectFreeToolSurface(tools: SubAgentConfig['tools']): boolean {
  return (
    Array.isArray(tools) &&
    tools.every((toolName) => isEffectFreeToolPolicy(resolveToolEffectPolicy(toolName)))
  );
}

function buildProviderValidRecoveryTranscript(
  messages: Message[],
  originalPrompt: string,
  recoveredAt: number,
): Message[] {
  const coherentTail = [...messages];
  while (coherentTail[0]?.role === 'tool') {
    coherentTail.shift();
  }

  const leadingSystemMessages: Message[] = [];
  while (coherentTail[0]?.role === 'system') {
    leadingSystemMessages.push(coherentTail.shift()!);
  }
  const firstInstruction = coherentTail[0];
  if (
    firstInstruction?.role === 'user' &&
    normalizeSubAgentPrompt(firstInstruction.content) === originalPrompt
  ) {
    return [...leadingSystemMessages, ...coherentTail];
  }

  return [
    ...leadingSystemMessages,
    {
      id: generateId(),
      role: 'user',
      content: originalPrompt,
      timestamp: recoveredAt,
    },
    ...coherentTail,
  ];
}

function buildInterruptedToolMessage(
  recoverable: RecoverableEffectFreeCall,
  recoveredAt: number,
): Message {
  const content = JSON.stringify({
    status: 'interrupted',
    code: 'app_restart',
    successful: false,
    retryable: true,
    toolName: recoverable.toolName,
    requested: recoverable.argumentsValue,
    message: RESTART_INTERRUPTION_ERROR,
  });
  return {
    id: generateId(),
    role: 'tool',
    content,
    toolCallId: recoverable.toolCall.id,
    timestamp: recoveredAt,
    isError: true,
    toolCalls: [
      {
        ...recoverable.toolCall,
        name: recoverable.toolName,
        status: 'failed',
        failureKind: 'runtime_error',
        startedAt:
          recoverable.toolCall.startedAt ??
          recoverable.toolCall.updatedAt ??
          recoverable.assistantMessage.timestamp,
        updatedAt: recoveredAt,
        completedAt: recoveredAt,
        result: content,
        error: RESTART_INTERRUPTION_ERROR,
      },
    ],
  };
}

function buildRecoveryInstruction(params: {
  originalPrompt: string;
  conversationSummary: string;
  transcriptRetainedFromStart: boolean;
  interruptedToolName?: string;
}): string {
  const boundaryInstruction = params.interruptedToolName
    ? `The immediately preceding effect-free ${params.interruptedToolName} call was interrupted and has no successful result, so do not count it. Retry that exact call if the original task still requires it.`
    : 'The last durable checkpoint contains only completed effect-free work and no unmatched operation. Continue from that checkpoint.';
  const compactionInstruction = params.transcriptRetainedFromStart
    ? ''
    : ' Earlier transcript content was compacted. Treat the retained summary and durable read checkpoints as orientation only, not as proof; re-read any source content required for final claims.';
  const summary = params.conversationSummary.trim();
  const summarySection = summary
    ? `\n\nRetained worker summary (orientation only):\n${summary.slice(0, 4_000)}`
    : '';
  return `Resume the original task after an app restart. ${boundaryInstruction}${compactionInstruction} Continue from successful retained tool results without redoing or recounting them unless re-reading is required to restore omitted evidence. Preserve every original constraint, and do not infer success without tool evidence.\n\nOriginal task:\n${params.originalPrompt}${summarySection}`;
}

/**
 * Restart recovery is intentionally narrow. A fully retained transcript may resume one unmatched
 * invocation with a trusted code-owned effect-free contract. A compacted or quiescent transcript
 * may resume only when the worker's entire explicit tool surface is code-owned and effect-free.
 * Side-effecting, runtime-external, malformed, and ambiguous operations continue to fail closed
 * through normal orphan handling.
 */
export function buildSubAgentRestartRecoveryPlan(params: {
  agent: SubAgentSnapshot;
  context: SubAgentSessionContext | undefined;
  now: number;
}): SubAgentRestartRecoveryPlan | null {
  if (params.agent.status !== 'running' || !params.context) return null;
  if (!Number.isSafeInteger(params.now) || params.now < 0) return null;
  if (
    params.agent.deadlineAt !== undefined &&
    (!Number.isFinite(params.agent.deadlineAt) || params.agent.deadlineAt <= params.now)
  ) {
    return null;
  }

  const originalPrompt = normalizeSubAgentPrompt(params.context.config.prompt);
  const messages = cloneStoredMessages(params.context.messages);
  if (!originalPrompt) return null;

  const unmatched = collectUnmatchedToolCalls(messages);
  const recoverable = findRecoverableEffectFreeCall(messages, unmatched);
  const effectFreeToolSurface = hasExplicitEffectFreeToolSurface(params.context.config.tools);
  if (unmatched.length > 0 && !recoverable) return null;
  if (!recoverable && !effectFreeToolSurface) return null;
  if (params.context.transcriptRetainedFromStart !== true && !effectFreeToolSurface) return null;

  const recoveryInstruction = buildRecoveryInstruction({
    originalPrompt,
    conversationSummary: params.context.conversationSummary,
    transcriptRetainedFromStart: params.context.transcriptRetainedFromStart === true,
    interruptedToolName: recoverable?.toolName,
  });
  const coherentMessages = buildProviderValidRecoveryTranscript(
    messages,
    originalPrompt,
    params.now,
  );
  const recoveryMessages: Message[] = [
    ...coherentMessages,
    ...(recoverable ? [buildInterruptedToolMessage(recoverable, params.now)] : []),
    {
      id: generateId(),
      role: 'user',
      content: recoveryInstruction,
      timestamp: params.now,
    },
  ];
  const remainingTimeoutMs =
    params.agent.deadlineAt === undefined
      ? undefined
      : Math.floor(params.agent.deadlineAt - params.now);
  // The worker runtime enforces a one-second minimum timeout. Refuse recovery instead of
  // extending an almost-expired original deadline to satisfy that minimum.
  if (remainingTimeoutMs !== undefined && remainingTimeoutMs < 1_000) return null;

  return {
    config: {
      ...params.context.config,
      prompt: originalPrompt,
      initialMessages: recoveryMessages,
      depth: params.agent.depth,
      ...(remainingTimeoutMs !== undefined ? { timeoutMs: remainingTimeoutMs } : {}),
    },
    recoveryBoundary: recoverable ? 'interrupted_effect_free_call' : 'effect_free_checkpoint',
    ...(recoverable
      ? {
          interruptedToolCallId: recoverable.toolCall.id,
          interruptedToolName: recoverable.toolName,
        }
      : {}),
    recoveredAt: params.now,
    ...(remainingTimeoutMs !== undefined ? { remainingTimeoutMs } : {}),
  };
}
