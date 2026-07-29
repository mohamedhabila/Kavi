import { normalizeToolName } from '../../engine/tools/toolNameNormalization';
import type { Message, ToolCall } from '../../types/message';
import type { SubAgentConfig, SubAgentSnapshot } from '../../types/subAgent';
import { generateId } from '../../utils/id';
import type { SubAgentSessionContext } from './lifecycle/sessionContext';
import { cloneStoredMessages, normalizeSubAgentPrompt } from './lifecycle/sessionContextMessages';

const RESTART_INTERRUPTION_ERROR =
  'The app restarted before this effect-free wait returned a successful result.';

type RecoverableWaitCall = {
  assistantMessage: Message;
  toolCall: ToolCall;
  argumentsValue: { ms: number; reason?: string };
};

export type SubAgentRestartRecoveryPlan = {
  config: SubAgentConfig;
  interruptedToolCallId: string;
  interruptedToolName: 'wait';
  recoveredAt: number;
  remainingTimeoutMs?: number;
};

function readWaitArguments(argumentsText: string): RecoverableWaitCall['argumentsValue'] | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.ms !== 'number' || !Number.isFinite(candidate.ms)) return null;
    if (candidate.reason !== undefined && typeof candidate.reason !== 'string') return null;
    return {
      ms: candidate.ms,
      ...(typeof candidate.reason === 'string' ? { reason: candidate.reason } : {}),
    };
  } catch {
    return null;
  }
}

function findRecoverableWait(messages: readonly Message[]): RecoverableWaitCall | null {
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
      if (
        (toolCall.status === 'pending' || toolCall.status === 'running') &&
        !settledToolCallIds.has(toolCall.id)
      ) {
        unmatched.push({ assistantMessage: message, toolCall });
      }
    }
  }

  if (unmatched.length !== 1) return null;
  const pending = unmatched[0]!;
  if (pending.assistantMessage !== messages[messages.length - 1]) return null;
  if (normalizeToolName(pending.toolCall.name) !== 'wait') return null;
  const argumentsValue = readWaitArguments(pending.toolCall.arguments);
  return argumentsValue ? { ...pending, argumentsValue } : null;
}

function buildInterruptedToolMessage(
  recoverable: RecoverableWaitCall,
  recoveredAt: number,
): Message {
  const content = JSON.stringify({
    status: 'interrupted',
    code: 'app_restart',
    successful: false,
    retryable: true,
    toolName: 'wait',
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
        name: 'wait',
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

function buildRecoveryInstruction(originalPrompt: string): string {
  return `Resume the original task after an app restart. The immediately preceding wait call was interrupted and has no successful result, so do not count it. Retry that exact wait if the original task still requires it. Continue from the successful tool results already present, without redoing or recounting them. Preserve every original constraint, and do not infer success without tool evidence.\n\nOriginal task:\n${originalPrompt}`;
}

/**
 * Restart recovery is intentionally narrow. It only resumes a fully retained transcript whose
 * sole unmatched operation is the deterministic, effect-free wait tool. Ambiguous reads and all
 * side-effecting tools continue to fail closed through normal orphan handling.
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
  // Recovery requires an explicit persistence integrity signal. A plausible-looking leading
  // user message cannot prove that an earlier bounded transcript window was not discarded.
  if (!originalPrompt || params.context.transcriptRetainedFromStart !== true) return null;

  const recoverable = findRecoverableWait(messages);
  if (!recoverable) return null;

  const recoveryInstruction = buildRecoveryInstruction(originalPrompt);
  const recoveryMessages: Message[] = [
    ...messages,
    buildInterruptedToolMessage(recoverable, params.now),
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
    interruptedToolCallId: recoverable.toolCall.id,
    interruptedToolName: 'wait',
    recoveredAt: params.now,
    ...(remainingTimeoutMs !== undefined ? { remainingTimeoutMs } : {}),
  };
}
