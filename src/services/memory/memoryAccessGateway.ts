import type { Message } from '../../types/message';
import { prepareMemoryPromptSection, type MemoryPromptSection } from './core/memoryPrompt';
import { isLongTermMemoryEnabled } from './policy';

/**
 * What one request read from memory for its prompt: nothing because memory was off, a
 * section, or `unavailable` for a read that failed (the request goes on without memory).
 * A section leaves out the rounds the request carries itself, named by their user messages.
 */
export type SessionMemoryRead = Readonly<
  | { status: 'off' }
  | { status: 'unavailable' }
  | {
      status: 'read';
      section: MemoryPromptSection | null;
      carriedUserMessageIds: ReadonlyArray<string>;
    }
>;

/** The memory section for the latest user message in `messages`, when memory is on. */
export function readSessionMemory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): SessionMemoryRead {
  if (!isLongTermMemoryEnabled()) return { status: 'off' };
  const userMessages = messages.filter((message) => message.role === 'user');
  const carriedUserMessageIds = userMessages.map((message) => message.id);
  return {
    status: 'read',
    section: prepareMemoryPromptSection({
      conversationId,
      latestUserMessage: userMessages[userMessages.length - 1]?.content ?? '',
      inRequestUserMessageIds: carriedUserMessageIds,
    }),
    carriedUserMessageIds,
  };
}

/**
 * A read stays usable while memory is as on or off as it was when read, and while the run
 * still carries every round the read left out. Once compaction replaces some of them, they
 * are only in memory, so memory is read again for the messages the run now carries.
 */
export function isSessionMemoryReadCurrent(
  read: SessionMemoryRead,
  workingMessages: ReadonlyArray<Message>,
): boolean {
  if ((read.status === 'off') !== !isLongTermMemoryEnabled()) return false;
  if (read.status !== 'read' || read.carriedUserMessageIds.length === 0) return true;
  const carried = new Set(
    workingMessages.filter((message) => message.role === 'user').map((message) => message.id),
  );
  return read.carriedUserMessageIds.every((id) => carried.has(id));
}
