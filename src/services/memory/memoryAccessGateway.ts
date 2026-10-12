import type { Message } from '../../types/message';
import { prepareMemoryPromptSection, type MemoryPromptSection } from './core/memoryPrompt';
import { isLongTermMemoryEnabled } from './policy';

/**
 * What one request read from memory for its prompt: nothing because memory was off, a
 * section, or `unavailable` for a read that failed (the request goes on without memory).
 */
export type SessionMemoryRead = Readonly<
  | { status: 'off' }
  | { status: 'unavailable' }
  | { status: 'read'; section: MemoryPromptSection | null }
>;

/** The memory section for the latest user message in `messages`, when memory is on. */
export function readSessionMemory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): SessionMemoryRead {
  if (!isLongTermMemoryEnabled()) return { status: 'off' };
  const userMessages = messages.filter((message) => message.role === 'user');
  return {
    status: 'read',
    section: prepareMemoryPromptSection({
      conversationId,
      latestUserMessage: userMessages[userMessages.length - 1]?.content ?? '',
      inRequestUserMessageIds: userMessages.map((message) => message.id),
    }),
  };
}

/** A read stays usable while memory is as on or off as it was when read. */
export function isSessionMemoryReadCurrent(read: SessionMemoryRead): boolean {
  return (read.status === 'off') === !isLongTermMemoryEnabled();
}
