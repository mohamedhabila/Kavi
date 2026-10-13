import {
  resolveConfiguredConversationWorkspaceTarget,
  resolveConversationWorkspaceReadTarget,
  resolveConversationWorkspaceTarget,
} from '../../src/services/conversationWorkspace/ownership';

describe('conversation workspace ownership', () => {
  it('keeps a conversation as its own workspace target', () => {
    expect(resolveConversationWorkspaceTarget({ conversationId: 'conv-root' })).toEqual({
      workspaceConversationId: 'conv-root',
    });
  });

  it('follows sub-agent ancestry to the conversation that owns the workspace', () => {
    const subAgents = [
      { sessionId: 'sub-parent', parentConversationId: 'conv-root' },
      { sessionId: 'sub-child', parentConversationId: 'sub-parent' },
    ] as any;

    expect(resolveConversationWorkspaceTarget({ conversationId: 'sub-child', subAgents })).toEqual({
      workspaceConversationId: 'conv-root',
      workspaceReadFallbackConversationId: 'sub-child',
    });
    expect(
      resolveConversationWorkspaceReadTarget({ conversationId: 'sub-child', subAgents }),
    ).toEqual({
      workspaceConversationId: 'conv-root',
      workspaceReadFallbackConversationIds: ['sub-child', 'sub-parent'],
    });
  });

  it('rejects malformed ownership identities instead of normalizing them across workspaces', () => {
    expect(() => resolveConversationWorkspaceTarget({ conversationId: ' conv-root' })).toThrow(
      'conversation_workspace_id_invalid',
    );
    expect(() =>
      resolveConversationWorkspaceTarget({
        conversationId: 'sub-child',
        subAgents: [{ sessionId: 'sub-child', parentConversationId: ' conv-private' } as any],
      }),
    ).toThrow('conversation_workspace_parent_id_invalid');
    expect(() =>
      resolveConversationWorkspaceTarget({
        conversationId: 'sub-child',
        subAgents: [{ sessionId: ' sub-child', parentConversationId: 'conv-private' } as any],
      }),
    ).toThrow('conversation_workspace_session_id_invalid');
  });

  it('merges explicit and derived workspace targets without normalizing either identity', () => {
    expect(
      resolveConfiguredConversationWorkspaceTarget({
        workspaceReadFallbackConversationId: 'side-1',
        derivedTarget: { workspaceConversationId: 'root-1' },
      }),
    ).toEqual({
      workspaceConversationId: 'root-1',
      workspaceReadFallbackConversationId: 'side-1',
    });
    expect(() =>
      resolveConfiguredConversationWorkspaceTarget({
        workspaceConversationId: ' root-1',
      }),
    ).toThrow('conversation_workspace_configured_id_invalid');
    expect(() =>
      resolveConfiguredConversationWorkspaceTarget({
        workspaceReadFallbackConversationId: 'side-1',
      }),
    ).toThrow('conversation_workspace_target_missing');
  });
});
