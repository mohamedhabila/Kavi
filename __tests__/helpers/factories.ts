import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
import { canonicalConversation, TEST_USER_MESSAGE_ID } from '../fixtures/conversations';

export function makeTestMessage(index: number = 1, overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${index}`,
    role: 'assistant',
    content: `message-${index}`,
    timestamp: index,
    ...overrides,
  };
}

export function makeTestConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    ...canonicalConversation,
    messages: [],
    agentRuns: [],
    ...overrides,
  };
}

export function makeTestAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: TEST_USER_MESSAGE_ID,
    goal: 'Ship a production-ready fix.',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    currentPhase: 'pilot',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}
