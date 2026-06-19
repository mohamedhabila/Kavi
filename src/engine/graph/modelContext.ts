import type { Message } from '../../types/message';
import { sanitizeGraphOwnedModelContextMessages } from './modelContextSanitization';

export function selectAgentControlGraphModelContextMessages(params: {
  memoryScopedMessages: ReadonlyArray<Message>;
  graphOwnedRun: boolean;
}): Message[] {
  if (!params.graphOwnedRun) {
    return [...params.memoryScopedMessages];
  }
  return sanitizeGraphOwnedModelContextMessages(params.memoryScopedMessages);
}
