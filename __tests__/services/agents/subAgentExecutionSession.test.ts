import { createSubAgentExecutionSession } from '../../../src/services/agents/subAgentExecutionSession';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';
import type { SubAgentConfig } from '../../../src/types/subAgent';

describe('sub-agent execution session', () => {
  it('retains structured tool failure kinds in the recovery transcript', () => {
    const messages: Message[] = [];
    const config: SubAgentConfig = {
      parentConversationId: 'conversation-1',
      prompt: 'Continue safely',
    };
    const provider: LlmProviderConfig = {
      id: 'provider-1',
      name: 'Provider',
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'model-1',
      enabled: true,
    };
    const session = createSubAgentExecutionSession({
      sessionId: 'session-1',
      config,
      provider,
      systemPrompt: 'System prompt',
      messages,
      getIteration: () => 1,
      scheduleSessionContextCheckpoint: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      storeSessionContext: jest.fn(),
      scheduleRegistryPersist: jest.fn(),
    });

    const tracked = session.trackToolCall(
      {
        id: 'call-1',
        name: 'memory_recall',
        arguments: '{}',
        status: 'failed',
        failureKind: 'authority_revoked',
      },
      'failed',
    );

    expect(tracked).toMatchObject({
      id: 'call-1',
      status: 'failed',
      failureKind: 'authority_revoked',
    });
  });
});
