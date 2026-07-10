import { resolveForegroundConversationExecutionContext } from '../../src/engine/graph/foregroundRun/executionContext';
import { createConversation } from '../helpers/foregroundRunExecutionContextHarness';

describe('foreground run target-conversation execution context resolution', () => {
  it('uses the configured default mode when the target conversation has no mode', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: undefined, personaId: 'reviewer' }),
        defaultConversationMode: 'chitchat',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'reviewer',
    });
  });

  it('resolves agentic targets to the super-agent persona', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'agentic', personaId: 'stale-persona' }),
        defaultConversationMode: 'chitchat',
      }),
    ).toEqual({
      mode: 'agentic',
      personaId: 'super-agent',
    });
  });

  it('preserves a non-super-agent persona for chitchat targets', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'chitchat', personaId: 'reviewer' }),
        defaultConversationMode: 'agentic',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'reviewer',
    });
  });

  it('drops a stale super-agent persona when the target is chitchat', () => {
    expect(
      resolveForegroundConversationExecutionContext({
        conversation: createConversation({ mode: 'chitchat', personaId: 'super-agent' }),
        defaultConversationMode: 'agentic',
      }),
    ).toEqual({
      mode: 'chitchat',
      personaId: 'default',
    });
  });
});
