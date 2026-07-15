import type { OrchestratorCallbacks, OrchestratorOptions } from '../../../src/engine/orchestrator';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';

export function* makeStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

export function makeCallbacks(
  overrides: Partial<OrchestratorCallbacks> = {},
): OrchestratorCallbacks {
  return {
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onReasoning: jest.fn(),
    onToolCallStart: jest.fn(),
    onToolCallComplete: jest.fn(),
    onAssistantMessage: jest.fn(),
    onToolMessage: jest.fn(),
    onError: jest.fn(),
    onUsage: jest.fn(),
    onDone: jest.fn(),
    onCommandResult: jest.fn(),
    onCompaction: jest.fn(),
    ...overrides,
  };
}

const provider: LlmProviderConfig = {
  id: 'test-provider',
  name: 'Test',
  type: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://api.test.com',
  models: ['test-model'],
};

export const makeOptions = (
  messages: Message[],
  overrides: Partial<OrchestratorOptions> = {},
): OrchestratorOptions => ({
  provider,
  model: 'test-model',
  conversationId: 'conv-1',
  systemPrompt: 'You are a test assistant.',
  messages,
  ...overrides,
});

export const allowTools =
  (toolNames: ReadonlyArray<string>) =>
  (toolName: string): boolean =>
    toolNames.includes(toolName);

export const makeMsg = (role: 'user' | 'assistant' | 'system', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
  attachments: [],
});
