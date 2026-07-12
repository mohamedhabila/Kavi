import type { Message } from '../../types/message';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export type UniqueMessageIdentityResolution =
  | { status: 'resolved'; index: number; message: Message }
  | { status: 'invalid'; reason: 'id_invalid' | 'missing' | 'ambiguous' };

export type PriorUserMessageIdentityResolution =
  | { status: 'resolved'; priorUserMessageId: string | null }
  | {
      status: 'invalid';
      reason:
        | 'current_message_id_invalid'
        | 'current_message_missing'
        | 'current_message_ambiguous'
        | 'current_message_not_user'
        | 'prior_message_id_invalid'
        | 'prior_message_ambiguous';
    };

export type SealedPriorUserMessageIdentityResolution =
  | { status: 'resolved'; priorUserMessageId: string | undefined }
  | { status: 'invalid' };

export type ClosedTurnSourceIdentityResolution =
  | {
      status: 'resolved';
      sourceStartMessageId: string | null;
      sourceStartIndex: number | null;
      sourceEndMessageId: string;
      sourceEndIndex: number;
      priorUserMessageId: string | null;
    }
  | { status: 'invalid' };

export function resolveUniqueMessageIdentity(
  messages: readonly Message[],
  messageId: string | undefined,
): UniqueMessageIdentityResolution {
  if (!isExactMemoryProvenanceId(messageId)) {
    return { status: 'invalid', reason: 'id_invalid' };
  }
  let resolvedIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.id !== messageId) continue;
    if (resolvedIndex >= 0) return { status: 'invalid', reason: 'ambiguous' };
    resolvedIndex = index;
  }
  const message = resolvedIndex >= 0 ? messages[resolvedIndex] : undefined;
  return message
    ? { status: 'resolved', index: resolvedIndex, message }
    : { status: 'invalid', reason: 'missing' };
}

/**
 * Resolve the one user message immediately preceding a code-owned current
 * message. Message ids are matched exactly; missing or malformed provenance
 * fails closed instead of guessing from the end of the conversation.
 */
export function resolvePriorUserMessageIdentity(
  messages: readonly Message[],
  currentUserMessageId: string | undefined,
): PriorUserMessageIdentityResolution {
  if (currentUserMessageId === undefined) {
    return { status: 'resolved', priorUserMessageId: null };
  }
  const current = resolveUniqueMessageIdentity(messages, currentUserMessageId);
  if (current.status === 'invalid') {
    const reason =
      current.reason === 'id_invalid'
        ? 'current_message_id_invalid'
        : current.reason === 'missing'
          ? 'current_message_missing'
          : 'current_message_ambiguous';
    return { status: 'invalid', reason };
  }
  if (current.message.role !== 'user') {
    return { status: 'invalid', reason: 'current_message_not_user' };
  }

  for (let index = current.index - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const prior = resolveUniqueMessageIdentity(messages, message.id);
    if (prior.status === 'invalid') {
      return {
        status: 'invalid',
        reason:
          prior.reason === 'ambiguous' ? 'prior_message_ambiguous' : 'prior_message_id_invalid',
      };
    }
    return { status: 'resolved', priorUserMessageId: prior.message.id! };
  }
  return { status: 'resolved', priorUserMessageId: null };
}

export function resolveSealedPriorUserMessageIdentity(
  messages: readonly Message[],
  currentUserMessageId: string | undefined,
  sealedPriorUserMessageId: string | undefined,
): SealedPriorUserMessageIdentityResolution {
  const derived = resolvePriorUserMessageIdentity(messages, currentUserMessageId);
  if (
    derived.status === 'invalid' ||
    (sealedPriorUserMessageId !== undefined &&
      sealedPriorUserMessageId !== derived.priorUserMessageId)
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'resolved',
    priorUserMessageId: sealedPriorUserMessageId ?? derived.priorUserMessageId ?? undefined,
  };
}

export function resolveClosedTurnSourceIdentity(
  messages: readonly Message[],
  sourceStartMessageId: string | undefined,
  sourceEndMessageId: string | undefined,
): ClosedTurnSourceIdentityResolution {
  const sourceEnd = resolveUniqueMessageIdentity(messages, sourceEndMessageId);
  if (sourceEnd.status === 'invalid' || sourceEnd.message.role !== 'assistant') {
    return { status: 'invalid' };
  }
  const prior = resolvePriorUserMessageIdentity(messages, sourceStartMessageId);
  if (prior.status === 'invalid') return { status: 'invalid' };
  if (sourceStartMessageId === undefined) {
    return {
      status: 'resolved',
      sourceStartMessageId: null,
      sourceStartIndex: null,
      sourceEndMessageId: sourceEnd.message.id!,
      sourceEndIndex: sourceEnd.index,
      priorUserMessageId: null,
    };
  }
  const sourceStart = resolveUniqueMessageIdentity(messages, sourceStartMessageId);
  if (
    sourceStart.status === 'invalid' ||
    sourceStart.message.role !== 'user' ||
    sourceStart.index >= sourceEnd.index
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'resolved',
    sourceStartMessageId: sourceStart.message.id!,
    sourceStartIndex: sourceStart.index,
    sourceEndMessageId: sourceEnd.message.id!,
    sourceEndIndex: sourceEnd.index,
    priorUserMessageId: prior.priorUserMessageId,
  };
}
