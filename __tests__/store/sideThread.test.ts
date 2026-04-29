// ---------------------------------------------------------------------------
// Tests — Side-Thread Sandbox
// ---------------------------------------------------------------------------
//
// Side threads are ephemeral branches off a parent conversation. They are
// surfaced via `parentConversationId` + `isSideThread` flags on Conversation
// and exercised through the `createSideThread` / `discardSideThread` chat
// store helpers. These tests pin the contract so the sandbox stays additive
// (it must not affect existing main-thread behavior).
// ---------------------------------------------------------------------------

import { useChatStore } from '../../src/store/useChatStore';

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
});

describe('side-thread sandbox', () => {
  it('createSideThread inherits parent provider/model/persona/system prompt', () => {
    const parentId = useChatStore
      .getState()
      .createConversation('openai', 'parent system', 'gpt-x', { personaId: 'researcher' });

    const sideId = useChatStore.getState().createSideThread(parentId);
    expect(sideId).not.toBeNull();

    const side = useChatStore.getState().conversations.find((c) => c.id === sideId);
    expect(side).toBeDefined();
    expect(side!.parentConversationId).toBe(parentId);
    expect(side!.isSideThread).toBe(true);
    expect(side!.providerId).toBe('openai');
    expect(side!.modelOverride).toBe('gpt-x');
    expect(side!.systemPrompt).toBe('parent system');
    expect(side!.personaId).toBe('researcher');
    expect(side!.messages).toEqual([]);
    expect(side!.title.startsWith('↳')).toBe(true);
  });

  it('createSideThread activates the new branch by default', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const sideId = useChatStore.getState().createSideThread(parentId);
    expect(useChatStore.getState().activeConversationId).toBe(sideId);
  });

  it('createSideThread supports activate:false', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    useChatStore.getState().setActiveConversation(parentId);
    const sideId = useChatStore.getState().createSideThread(parentId, { activate: false });
    expect(sideId).not.toBeNull();
    expect(useChatStore.getState().activeConversationId).toBe(parentId);
  });

  it('createSideThread allows overriding provider/model/persona/system prompt', () => {
    const parentId = useChatStore
      .getState()
      .createConversation('openai', 'parent system', 'gpt-x');

    const sideId = useChatStore.getState().createSideThread(parentId, {
      providerId: 'anthropic',
      modelOverride: 'claude-x',
      systemPrompt: 'side system',
      personaId: 'critic',
      title: 'Tangent',
    });

    const side = useChatStore.getState().conversations.find((c) => c.id === sideId);
    expect(side!.providerId).toBe('anthropic');
    expect(side!.modelOverride).toBe('claude-x');
    expect(side!.systemPrompt).toBe('side system');
    expect(side!.personaId).toBe('critic');
    expect(side!.title).toBe('Tangent');
  });

  it('createSideThread returns null when parent does not exist', () => {
    const result = useChatStore.getState().createSideThread('does-not-exist');
    expect(result).toBeNull();
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('createSideThread refuses to nest (no side-of-side)', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const sideId = useChatStore.getState().createSideThread(parentId);
    expect(sideId).not.toBeNull();
    const nested = useChatStore.getState().createSideThread(sideId!);
    expect(nested).toBeNull();
  });

  it('discardSideThread removes the side thread and falls back to parent', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const sideId = useChatStore.getState().createSideThread(parentId)!;
    expect(useChatStore.getState().activeConversationId).toBe(sideId);

    const removed = useChatStore.getState().discardSideThread(sideId);
    expect(removed).toBe(true);
    expect(useChatStore.getState().conversations.find((c) => c.id === sideId)).toBeUndefined();
    expect(useChatStore.getState().activeConversationId).toBe(parentId);
  });

  it('discardSideThread leaves activeConversationId untouched if a different conversation is active', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const sideId = useChatStore.getState().createSideThread(parentId)!;
    const otherId = useChatStore.getState().createConversation('openai', 'sys2');
    useChatStore.getState().setActiveConversation(otherId);

    const removed = useChatStore.getState().discardSideThread(sideId);
    expect(removed).toBe(true);
    expect(useChatStore.getState().activeConversationId).toBe(otherId);
  });

  it('discardSideThread refuses to delete a main-thread conversation', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const removed = useChatStore.getState().discardSideThread(parentId);
    expect(removed).toBe(false);
    expect(useChatStore.getState().conversations.find((c) => c.id === parentId)).toBeDefined();
  });

  it('does not retroactively flag existing conversations as side threads', () => {
    const parentId = useChatStore.getState().createConversation('openai', 'sys');
    const conv = useChatStore.getState().conversations.find((c) => c.id === parentId)!;
    expect(conv.isSideThread).toBeUndefined();
    expect(conv.parentConversationId).toBeUndefined();
  });
});
