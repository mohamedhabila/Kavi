import { appForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import { hasConversationWork } from '../../src/services/conversationWorkStop';
import type { Conversation } from '../../src/types/conversation';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-work',
    title: 'Work',
    messages: [],
    providerId: 'provider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Conversation;
}

describe('hasConversationWork', () => {
  afterEach(() => {
    appForegroundRequestRegistry.clearForConversation('conversation-work');
  });

  it('is false for a quiet conversation', () => {
    expect(hasConversationWork(conversation())).toBe(false);
  });

  it('sees a reply still streaming into the conversation', () => {
    appForegroundRequestRegistry.register({
      conversationId: 'conversation-work',
      requestId: 'request-1',
      controller: new AbortController(),
    });

    expect(hasConversationWork(conversation())).toBe(true);
  });

  it('sees a running agent run and a held projection claim', () => {
    expect(
      hasConversationWork(conversation({ agentRuns: [{ id: 'run', status: 'running' } as never] })),
    ).toBe(true);
    expect(hasConversationWork(conversation({ modelProjectionOwner: {} as never }))).toBe(true);
  });

  it('ignores runs that already finished', () => {
    expect(
      hasConversationWork(
        conversation({ agentRuns: [{ id: 'run', status: 'completed' } as never] }),
      ),
    ).toBe(false);
  });
});
