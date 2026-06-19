import type { Message } from '../../types/message';
import { sanitizeModelVisibleWorkingMessages } from './modelVisibleWorkingMessages';

export function sanitizeGraphOwnedModelContextMessages(
  messages: ReadonlyArray<Message>,
): Message[] {
  return sanitizeModelVisibleWorkingMessages(messages, {
    dropAssistantSubAgentEvents: true,
  });
}
