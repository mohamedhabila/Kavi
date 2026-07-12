import type { Message } from '../../types/message';
import type { IngestionJob } from './ingestionQueueStore';
import {
  resolvePriorUserMessageIdentity,
  resolveUniqueMessageIdentity,
} from './priorUserMessageIdentity';

export interface ResolvedJobSourceWindow {
  turnMessages: Message[];
  priorIdentityMessages: Message[];
}

export function resolveJobSourceWindow(
  job: IngestionJob,
  messages: Message[],
): ResolvedJobSourceWindow | null {
  const sourceEnd = resolveUniqueMessageIdentity(messages, job.sourceEndMessageId);
  if (sourceEnd.status === 'invalid' || sourceEnd.message.role !== 'assistant') return null;

  let startIndex = 0;
  if (job.sourceStartMessageId) {
    const sourceStart = resolveUniqueMessageIdentity(messages, job.sourceStartMessageId);
    if (
      sourceStart.status === 'invalid' ||
      sourceStart.message.role !== 'user' ||
      sourceStart.index >= sourceEnd.index
    ) {
      return null;
    }
    startIndex = sourceStart.index;
  }
  const priorUserIdentity = resolvePriorUserMessageIdentity(
    messages,
    job.sourceStartMessageId ?? undefined,
  );
  if (
    priorUserIdentity.status === 'invalid' ||
    priorUserIdentity.priorUserMessageId !== job.priorUserMessageId
  ) {
    return null;
  }
  const priorSource = job.priorUserMessageId
    ? resolveUniqueMessageIdentity(messages, job.priorUserMessageId)
    : null;
  if (priorSource?.status === 'invalid') return null;

  const turnMessages = messages.slice(startIndex, sourceEnd.index + 1);
  if (turnMessages.at(-1)?.id !== job.sourceEndMessageId) return null;
  return {
    turnMessages,
    priorIdentityMessages: messages.slice(priorSource?.index ?? startIndex, sourceEnd.index + 1),
  };
}
