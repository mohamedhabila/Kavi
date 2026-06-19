import type { Message } from '../../../types/message';
import {
  isAssistantFinalResponsePlaceholder,
  isFinalAssistantMessage,
} from '../../../utils/assistantMessageMetadata';
import { getConsolidationState, type ConsolidationStateRow } from './schedulerState';

export const DEFAULT_TURN_THRESHOLD = 8;
export const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export type ConsolidationTriggerReason =
  | 'turn_threshold'
  | 'idle_threshold'
  | 'app_background'
  | 'manual';

function findIndexById(messages: Message[], id: string | null | undefined): number {
  if (!id) return -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.id === id) return i;
  }
  return -1;
}

export function isConsolidatableAssistantMessage(message: Message | undefined): message is Message {
  if (!message || !isFinalAssistantMessage(message)) return false;
  if (isAssistantFinalResponsePlaceholder(message)) return false;
  const metadata = message.assistantMetadata;
  if (!metadata) return true;
  return metadata.kind === 'final' && metadata.completionStatus === 'complete';
}

export function lastAssistantMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isConsolidatableAssistantMessage(messages[i])) return messages[i];
  }
  return undefined;
}

export function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i];
  }
  return undefined;
}

export interface CountableTurnsInput {
  messages: Message[];
  lastConsolidatedMessageId: string | null;
}

/** Number of `user`/`assistant` turns strictly after the anchor. */
export function countNewTurns(input: CountableTurnsInput): number {
  const idx = findIndexById(input.messages, input.lastConsolidatedMessageId);
  let count = 0;
  for (let i = idx + 1; i < input.messages.length; i += 1) {
    const message = input.messages[i];
    if (message?.role === 'user' || isConsolidatableAssistantMessage(message)) count += 1;
  }
  return count;
}

export function unconsolidatedWindow(
  messages: Message[],
  lastConsolidatedMessageId: string | null | undefined,
  anchorMessageId: string | null | undefined,
): Message[] {
  const start = findIndexById(messages, lastConsolidatedMessageId) + 1;
  const anchorIndex = findIndexById(messages, anchorMessageId);
  const end = anchorIndex >= 0 ? anchorIndex + 1 : messages.length;
  return messages.slice(Math.max(start, 0), Math.max(end, start));
}

export interface EvaluateTriggerInput {
  threadId: string;
  messages: Message[];
  now?: number;
  turnThreshold?: number;
  idleThresholdMs?: number;
  appBackgrounded?: boolean;
  state?: ConsolidationStateRow | null;
}

export interface EvaluateTriggerResult {
  shouldRun: boolean;
  reason?: ConsolidationTriggerReason;
  newTurns: number;
  idleMs: number;
  /** Last assistant message id if we should consolidate (anchor for state advance). */
  anchorMessageId?: string;
}

export function evaluateTrigger(input: EvaluateTriggerInput): EvaluateTriggerResult {
  const turnThreshold = input.turnThreshold ?? DEFAULT_TURN_THRESHOLD;
  const idleThresholdMs = input.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  const now = input.now ?? Date.now();
  const state = input.state ?? getConsolidationState(input.threadId);
  const lastAssistant = lastAssistantMessage(input.messages);

  if (!lastAssistant) {
    return { shouldRun: false, newTurns: 0, idleMs: 0 };
  }

  const newTurns = countNewTurns({
    messages: input.messages,
    lastConsolidatedMessageId: state?.lastConsolidatedMessageId ?? null,
  });

  if (newTurns === 0) {
    return { shouldRun: false, newTurns, idleMs: 0 };
  }

  const lastTurnTimestamp =
    typeof lastAssistant.timestamp === 'number' ? lastAssistant.timestamp : now;
  const idleMs = Math.max(now - lastTurnTimestamp, 0);

  if (input.appBackgrounded) {
    return {
      shouldRun: true,
      reason: 'app_background',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  if (newTurns >= turnThreshold) {
    return {
      shouldRun: true,
      reason: 'turn_threshold',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  if (idleMs >= idleThresholdMs) {
    return {
      shouldRun: true,
      reason: 'idle_threshold',
      newTurns,
      idleMs,
      anchorMessageId: lastAssistant.id,
    };
  }

  return { shouldRun: false, newTurns, idleMs, anchorMessageId: lastAssistant.id };
}
