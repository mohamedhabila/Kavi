import { resolveConversationWorkspaceSource } from '../../src/services/workspaces/source';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Conversation } from '../../src/types/conversation';
import type { WorkspaceTargetConfig } from '../../src/types/remote';

function makeWorkspaceTarget(
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig {
  return {
    id: 'workspace-1',
    name: 'Main repo',
    rootPath: '/workspace/main',
    enabled: true,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: overrides.id ?? 'conversation-1',
    title: overrides.title ?? 'Chat',
    messages: overrides.messages ?? [],
    providerId: overrides.providerId ?? 'openai',
    systemPrompt: overrides.systemPrompt ?? 'sys',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
  useSettingsStore.setState({
    workspaceTargets: [],
    defaultWorkspaceTargetId: null,
  });
});

describe('resolveConversationWorkspaceSource', () => {
  it('uses the attached workspace target when the conversation has one', () => {
    useSettingsStore
      .getState()
      .addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-attached' }));
    useChatStore.setState({
      conversations: [
        makeConversation({ id: 'conversation-1', workspaceTargetId: 'workspace-attached' }),
      ],
    });

    const source = resolveConversationWorkspaceSource('conversation-1');

    expect(source).toEqual({
      kind: 'target',
      target: expect.objectContaining({ id: 'workspace-attached' }),
    });
  });

  it('falls back to the default workspace target when the conversation has none', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());
    useChatStore.setState({
      conversations: [makeConversation({ id: 'conversation-1' })],
    });

    const source = resolveConversationWorkspaceSource('conversation-1');

    expect(source).toEqual({
      kind: 'target',
      target: expect.objectContaining({ id: 'workspace-1' }),
    });
  });

  it('falls back to the default workspace target when the attached target is stale', () => {
    useSettingsStore
      .getState()
      .addWorkspaceTarget(makeWorkspaceTarget({ id: 'workspace-default' }));
    useChatStore.setState({
      conversations: [
        makeConversation({ id: 'conversation-1', workspaceTargetId: 'workspace-missing' }),
      ],
    });

    const source = resolveConversationWorkspaceSource('conversation-1');

    expect(source).toEqual({
      kind: 'target',
      target: expect.objectContaining({ id: 'workspace-default' }),
    });
  });

  it('uses the conversation workspace when no attached or default target exists', () => {
    useChatStore.setState({
      conversations: [makeConversation({ id: 'conversation-1' })],
    });

    const source = resolveConversationWorkspaceSource('conversation-1', 'conversation-fallback');

    expect(source).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-1',
      fallbackConversationId: 'conversation-fallback',
    });
  });
});
