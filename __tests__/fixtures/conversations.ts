import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

export const TEST_CONVERSATION_ID = 'conv-1';
export const TEST_USER_MESSAGE_ID = 'msg-user';

export const canonicalUserMessage: Message = {
  id: TEST_USER_MESSAGE_ID,
  role: 'user',
  content: 'Ship a production-ready fix.',
  timestamp: 1,
};

export const canonicalAssistantMessage: Message = {
  id: 'msg-assistant',
  role: 'assistant',
  content: 'The fix is ready.',
  timestamp: 2,
};

export const canonicalConversation: Conversation = {
  id: TEST_CONVERSATION_ID,
  title: 'Conversation',
  messages: [],
  agentRuns: [],
  providerId: 'provider-1',
  systemPrompt: 'System prompt',
  createdAt: 1,
  updatedAt: 1,
};
