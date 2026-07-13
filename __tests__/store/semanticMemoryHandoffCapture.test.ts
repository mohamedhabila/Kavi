import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

describe('semantic memory handoff capture and activation', () => {
  it('attaches only exact source identity when an active top-level history is replaced', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'My private preference must not be copied into handoff state.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 11,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    });

    const freshId = useChatStore.getState().createConversation('openai', 'system');
    const fresh = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === freshId)!;

    expect(fresh.semanticMemoryHandoff).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'source-assistant',
    });
    expect(JSON.stringify(fresh.semanticMemoryHandoff)).not.toContain('private preference');
  });

  it('does not inherit active-user handoff state for inactive background conversations', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'Remember this.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Done.',
      timestamp: 11,
    });

    const inactiveId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, { activate: false });
    const canonicalId = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'system', undefined, {
        activate: false,
        personaId: 'background',
      });

    for (const id of [inactiveId, canonicalId]) {
      expect(
        useChatStore.getState().conversations.find((conversation) => conversation.id === id)
          ?.semanticMemoryHandoff,
      ).toBeUndefined();
    }
  });

  it('retains the content-free barrier across personas for globally shared facts', () => {
    const sourceId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, { personaId: 'researcher' });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'A globally applicable preference.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 11,
    });

    const targetId = useChatStore
      .getState()
      .createConversation('openai', 'system', undefined, { personaId: 'writer' });
    const target = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === targetId)!;

    expect(target.semanticMemoryHandoff).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'source-assistant',
    });
    expect(JSON.stringify(target.semanticMemoryHandoff)).not.toContain('globally applicable');
  });

  it('forwards a pending source boundary across consecutive blank conversations', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'Remember this before I open another chat.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 11,
    });

    const firstFreshId = useChatStore.getState().createConversation('openai', 'system');
    const expected = useChatStore
      .getState()
      .conversations.find(
        (conversation) => conversation.id === firstFreshId,
      )!.semanticMemoryHandoff;
    expect(expected).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'source-assistant',
    });
    const secondFreshId = useChatStore.getState().createConversation('openai', 'system');

    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === secondFreshId)!
        .semanticMemoryHandoff,
    ).toEqual(expected);
  });

  it('does not capture a new boundary while long-term memory is disabled', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'This turn must stay outside memory.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 11,
    });
    useSettingsStore.setState({ disableLongTermMemory: true } as never);

    const freshId = useChatStore.getState().createConversation('openai', 'system');
    useSettingsStore.setState({ disableLongTermMemory: false } as never);

    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === freshId)
        ?.semanticMemoryHandoff,
    ).toBeUndefined();
  });

  it('ignores an owned in-flight placeholder while preserving an older closed boundary', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'closed-user',
      role: 'user',
      content: 'Closed turn.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'closed-assistant',
      role: 'assistant',
      content: 'Closed.',
      timestamp: 11,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'running-user',
      role: 'user',
      content: 'Still running.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'running-placeholder',
      role: 'assistant',
      content: '',
      timestamp: 13,
    });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) =>
        entry.id === sourceId
          ? {
              ...entry,
              modelProjectionOwner: {
                surface: 'foreground' as const,
                runId: 'running-request',
                requestMessageId: 'running-user',
                assistantMessageId: 'running-placeholder',
                controlEpoch: 0,
              },
            }
          : entry,
      ),
    }));

    const freshId = useChatStore.getState().createConversation('openai', 'system');

    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === freshId)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'closed-assistant',
    });
  });

  it('forwards an existing pending boundary before inspecting its owned placeholder', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'Original boundary.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Closed.',
      timestamp: 11,
    });
    const waitingId = useChatStore.getState().createConversation('openai', 'system');
    const pending = useChatStore
      .getState()
      .conversations.find((entry) => entry.id === waitingId)!.semanticMemoryHandoff;
    expect(pending).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'source-assistant',
    });
    useChatStore.getState().addMessage(waitingId, {
      id: 'waiting-user',
      role: 'user',
      content: 'Waiting on memory.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(waitingId, {
      id: 'waiting-placeholder',
      role: 'assistant',
      content: '',
      timestamp: 13,
    });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) =>
        entry.id === waitingId
          ? {
              ...entry,
              modelProjectionOwner: {
                surface: 'foreground' as const,
                runId: 'waiting-request',
                requestMessageId: 'waiting-user',
                assistantMessageId: 'waiting-placeholder',
                controlEpoch: 0,
              },
            }
          : entry,
      ),
    }));

    const nextId = useChatStore.getState().createConversation('openai', 'system');

    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === nextId)
        ?.semanticMemoryHandoff,
    ).toEqual(pending);
  });

  it('captures an explicitly completed assistant while projection ownership is releasing', () => {
    const sourceId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-user',
      role: 'user',
      content: 'Finished request.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(sourceId, {
      id: 'source-assistant',
      role: 'assistant',
      content: 'Finished response.',
      timestamp: 11,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) =>
        entry.id === sourceId
          ? {
              ...entry,
              modelProjectionOwner: {
                surface: 'foreground' as const,
                runId: 'finishing-request',
                requestMessageId: 'source-user',
                assistantMessageId: 'source-assistant',
                controlEpoch: 0,
              },
            }
          : entry,
      ),
    }));

    const freshId = useChatStore.getState().createConversation('openai', 'system');

    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === freshId)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: sourceId,
      sourceThreadId: sourceId,
      sourceEndMessageId: 'source-assistant',
    });
  });

  it('attaches a boundary when activating an existing chat and preserves a pending target', () => {
    const firstId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(firstId, {
      id: 'first-user',
      role: 'user',
      content: 'First chat.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(firstId, {
      id: 'first-assistant',
      role: 'assistant',
      content: 'First done.',
      timestamp: 11,
    });
    const secondId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) => {
        if (entry.id !== secondId) return entry;
        const { semanticMemoryHandoff: _semanticMemoryHandoff, ...withoutHandoff } = entry;
        return withoutHandoff;
      }),
    }));
    useChatStore.getState().addMessage(secondId, {
      id: 'second-user',
      role: 'user',
      content: 'Second chat.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(secondId, {
      id: 'second-assistant',
      role: 'assistant',
      content: 'Second done.',
      timestamp: 13,
    });

    useChatStore.getState().setActiveConversation(firstId);
    const firstPending = useChatStore
      .getState()
      .conversations.find((entry) => entry.id === firstId)!.semanticMemoryHandoff;
    expect(firstPending).toEqual({
      version: 1,
      memoryConversationId: secondId,
      sourceThreadId: secondId,
      sourceEndMessageId: 'second-assistant',
    });

    useChatStore.setState({ activeConversationId: secondId });
    useChatStore.getState().setActiveConversation(firstId);
    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === firstId)
        ?.semanticMemoryHandoff,
    ).toEqual(firstPending);
  });

  it('attaches a boundary when activating an existing canonical persona thread', () => {
    const defaultId = useChatStore.getState().getOrCreateCanonicalThread('openai', 'system');
    useChatStore.getState().addMessage(defaultId, {
      id: 'default-user',
      role: 'user',
      content: 'Default persona.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(defaultId, {
      id: 'default-assistant',
      role: 'assistant',
      content: 'Default done.',
      timestamp: 11,
    });
    const researcherId = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'system', undefined, { personaId: 'researcher' });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) => {
        if (entry.id !== researcherId) return entry;
        const { semanticMemoryHandoff: _semanticMemoryHandoff, ...withoutHandoff } = entry;
        return withoutHandoff;
      }),
    }));
    useChatStore.getState().addMessage(researcherId, {
      id: 'researcher-user',
      role: 'user',
      content: 'Research persona.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(researcherId, {
      id: 'researcher-assistant',
      role: 'assistant',
      content: 'Research done.',
      timestamp: 13,
    });

    const activatedDefaultId = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'system');

    expect(activatedDefaultId).toBe(defaultId);
    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === defaultId)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: researcherId,
      sourceThreadId: researcherId,
      sourceEndMessageId: 'researcher-assistant',
    });
  });

  it('attaches the exact workspace and producing thread across the real side-thread flow', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(parentId, {
      id: 'parent-user',
      role: 'user',
      content: 'Remember this before the side thread.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(parentId, {
      id: 'parent-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 11,
    });

    const firstSideId = useChatStore.getState().createSideThread(parentId)!;
    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === firstSideId)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: parentId,
      sourceThreadId: parentId,
      sourceEndMessageId: 'parent-assistant',
    });

    useChatStore.setState((state) => ({
      conversations: state.conversations.map((entry) => {
        if (entry.id !== firstSideId) return entry;
        const { semanticMemoryHandoff: _semanticMemoryHandoff, ...withoutHandoff } = entry;
        return withoutHandoff;
      }),
    }));
    useChatStore.getState().addMessage(firstSideId, {
      id: 'side-user',
      role: 'user',
      content: 'Remember this side-thread detail too.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(firstSideId, {
      id: 'side-assistant',
      role: 'assistant',
      content: 'Understood.',
      timestamp: 13,
    });

    const secondSideId = useChatStore.getState().createSideThread(parentId)!;
    expect(
      useChatStore.getState().conversations.find((entry) => entry.id === secondSideId)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: parentId,
      sourceThreadId: firstSideId,
      sourceEndMessageId: 'side-assistant',
    });
  });

  it('does not capture yielded state but preserves a closed side-thread boundary', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(parentId, {
      id: 'parent-user',
      role: 'user',
      content: 'Continue later.',
      timestamp: 10,
    });
    useChatStore.getState().addMessage(parentId, {
      id: 'parent-yielded',
      role: 'assistant',
      content: '',
      timestamp: 11,
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'incomplete',
        finishReason: 'yielded',
      },
    });
    const withoutClosedTurn = useChatStore.getState().createConversation('openai', 'system');
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === withoutClosedTurn)
        ?.semanticMemoryHandoff,
    ).toBeUndefined();

    useChatStore.getState().setActiveConversation(parentId);
    const sideId = useChatStore.getState().createSideThread(parentId)!;
    useChatStore.getState().addMessage(sideId, {
      id: 'side-user',
      role: 'user',
      content: 'Side work.',
      timestamp: 12,
    });
    useChatStore.getState().addMessage(sideId, {
      id: 'side-assistant',
      role: 'assistant',
      content: 'Side done.',
      timestamp: 13,
    });
    const afterSide = useChatStore.getState().createConversation('openai', 'system');
    expect(
      useChatStore.getState().conversations.find((conversation) => conversation.id === afterSide)
        ?.semanticMemoryHandoff,
    ).toEqual({
      version: 1,
      memoryConversationId: parentId,
      sourceThreadId: sideId,
      sourceEndMessageId: 'side-assistant',
    });
  });
});
