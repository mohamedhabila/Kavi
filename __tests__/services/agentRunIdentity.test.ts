import { createAgentRunIdentityKey } from '../../src/services/agents/agentRunIdentity';

describe('agent run identity', () => {
  it('separates identical run ids owned by different conversations', () => {
    expect(
      createAgentRunIdentityKey({ conversationId: 'conversation-a', runId: 'run-1' }),
    ).not.toBe(createAgentRunIdentityKey({ conversationId: 'conversation-b', runId: 'run-1' }));
  });

  it('cannot collide when ids contain separators', () => {
    expect(
      createAgentRunIdentityKey({ conversationId: 'conversation::a', runId: 'run-1' }),
    ).not.toBe(createAgentRunIdentityKey({ conversationId: 'conversation', runId: 'a::run-1' }));
  });
});
