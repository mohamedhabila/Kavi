import { useChatStore } from '../../helpers/chatStoreHarness';

function addFinal(conversationId: string, id = 'assistant-final'): void {
  useChatStore.getState().addMessage(conversationId, {
    id,
    role: 'assistant',
    content: 'The exact final response.',
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  });
}

function publication(conversationId: string, messageId = 'assistant-final') {
  return useChatStore
    .getState()
    .conversations.find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === messageId)?.memoryPublication;
}

describe('useChatStore transitionMessageMemoryPublication', () => {
  it('strips caller-supplied receipts and admits only the code-owned transition action', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    useChatStore.getState().addMessage(conversationId, {
      id: 'assistant-final',
      role: 'assistant',
      content: 'The exact final response.',
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      memoryPublication: { version: 1, disposition: 'enqueued' },
    } as any);

    expect(publication(conversationId)).toBeUndefined();
    expect(
      useChatStore
        .getState()
        .transitionMessageMemoryPublication(conversationId, 'assistant-final', null),
    ).toEqual({
      status: 'applied',
      changed: true,
      publication: { version: 1, disposition: null },
    });
    expect(publication(conversationId)).toEqual({ version: 1, disposition: null });
  });

  it('settles an open obligation, accepts replay, and permits only enqueued withdrawal', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    addFinal(conversationId);
    const transition = useChatStore.getState().transitionMessageMemoryPublication;

    expect(transition(conversationId, 'assistant-final', null).status).toBe('applied');
    expect(transition(conversationId, 'assistant-final', 'enqueued')).toEqual({
      status: 'applied',
      changed: true,
      publication: { version: 1, disposition: 'enqueued' },
    });
    expect(transition(conversationId, 'assistant-final', 'enqueued')).toEqual({
      status: 'applied',
      changed: false,
      publication: { version: 1, disposition: 'enqueued' },
    });
    expect(transition(conversationId, 'assistant-final', 'opt_out')).toEqual({
      status: 'rejected',
      reason: 'transition_conflict',
    });
    expect(transition(conversationId, 'assistant-final', 'withdrawn').status).toBe('applied');
    expect(publication(conversationId)).toEqual({ version: 1, disposition: 'withdrawn' });
  });

  it('requires an open durability obligation before enqueued or withdrawn settlement', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    addFinal(conversationId);
    const transition = useChatStore.getState().transitionMessageMemoryPublication;

    expect(transition(conversationId, 'assistant-final', 'enqueued')).toEqual({
      status: 'rejected',
      reason: 'transition_conflict',
    });
    expect(transition(conversationId, 'assistant-final', 'withdrawn')).toEqual({
      status: 'rejected',
      reason: 'transition_conflict',
    });
    expect(publication(conversationId)).toBeUndefined();
  });

  it.each([
    {
      label: 'user message',
      message: { role: 'user' as const, content: 'User text' },
    },
    {
      label: 'incomplete final',
      message: {
        role: 'assistant' as const,
        content: 'Incomplete',
        assistantMetadata: {
          kind: 'final' as const,
          completionStatus: 'incomplete' as const,
          finishReason: 'response_failed',
        },
      },
    },
    {
      label: 'yielded final',
      message: {
        role: 'assistant' as const,
        content: 'Waiting',
        assistantMetadata: {
          kind: 'final' as const,
          completionStatus: 'complete' as const,
          finishReason: 'yielded',
        },
      },
    },
  ])('rejects an ineligible $label', ({ message }) => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    useChatStore.getState().addMessage(conversationId, { id: 'source', ...message });

    expect(
      useChatStore.getState().transitionMessageMemoryPublication(conversationId, 'source', null),
    ).toEqual({ status: 'rejected', reason: 'source_ineligible' });
  });

  it('rejects missing and duplicate exact source identities', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    addFinal(conversationId, 'duplicate');
    addFinal(conversationId, 'duplicate');

    expect(
      useChatStore.getState().transitionMessageMemoryPublication(conversationId, 'missing', null),
    ).toEqual({ status: 'rejected', reason: 'source_unavailable' });
    expect(
      useChatStore.getState().transitionMessageMemoryPublication(conversationId, 'duplicate', null),
    ).toEqual({ status: 'rejected', reason: 'source_identity_invalid' });
  });
});
