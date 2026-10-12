import type { Message } from '../../types/message';
import { prepareMemoryPromptSection, type MemoryPromptSection } from './core/memoryPrompt';
import { captureMemoryReadEpoch, getMemoryPolicyEpoch } from './policy';
import { captureMemoryAuthoritySnapshot, type MemoryAuthoritySnapshot } from './memoryAuthority';

/**
 * What one request read from memory for its prompt, under the memory policy generation
 * (`policyEpoch`) current when it read: turning memory on or off advances the generation.
 */
export type SessionMemoryRead = Readonly<
  { policyEpoch: number } & (
    | { status: 'off' }
    | { status: 'unavailable' }
    | {
        status: 'read';
        authoritySnapshot: MemoryAuthoritySnapshot;
        section: MemoryPromptSection | null;
      }
  )
>;

/** The memory section for the latest user message in `messages`, when memory is on. */
export function readSessionMemory(
  conversationId: string,
  messages: ReadonlyArray<Message>,
): SessionMemoryRead {
  const policyEpoch = getMemoryPolicyEpoch();
  if (captureMemoryReadEpoch() === null) return { status: 'off', policyEpoch };
  const authoritySnapshot = captureMemoryAuthoritySnapshot();
  if (!authoritySnapshot) return { status: 'unavailable', policyEpoch };
  const userMessages = messages.filter((message) => message.role === 'user');
  return {
    status: 'read',
    policyEpoch,
    authoritySnapshot,
    section: prepareMemoryPromptSection({
      conversationId,
      latestUserMessage: userMessages[userMessages.length - 1]?.content ?? '',
      inRequestUserMessageIds: userMessages.map((message) => message.id),
    }),
  };
}

/** A read stays usable until memory is turned on or off. */
export function isSessionMemoryReadCurrent(read: SessionMemoryRead): boolean {
  return read.policyEpoch === getMemoryPolicyEpoch();
}
