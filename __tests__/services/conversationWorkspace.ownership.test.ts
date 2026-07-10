import { resolveConversationWorkspaceTarget } from '../../src/services/conversationWorkspace/ownership';

describe('conversation workspace ownership', () => {
  it('keeps a canonical conversation as its own workspace target', () => {
    expect(
      resolveConversationWorkspaceTarget({
        conversationId: 'conv-root',
        conversations: [{ id: 'conv-root', isSideThread: false } as any],
      }),
    ).toEqual({ workspaceConversationId: 'conv-root' });
  });

  it('resolves a side thread to its parent workspace and keeps the side thread as a read fallback', () => {
    expect(
      resolveConversationWorkspaceTarget({
        conversationId: 'conv-side',
        conversations: [
          { id: 'conv-root', isSideThread: false } as any,
          {
            id: 'conv-side',
            isSideThread: true,
            parentConversationId: 'conv-root',
          } as any,
        ],
      }),
    ).toEqual({
      workspaceConversationId: 'conv-root',
      workspaceReadFallbackConversationId: 'conv-side',
    });
  });

  it('follows sub-agent ancestry and then side-thread ancestry to the shared workspace root', () => {
    expect(
      resolveConversationWorkspaceTarget({
        conversationId: 'sub-child',
        conversations: [
          { id: 'conv-root', isSideThread: false } as any,
          {
            id: 'conv-side',
            isSideThread: true,
            parentConversationId: 'conv-root',
          } as any,
        ],
        subAgents: [{ sessionId: 'sub-child', parentConversationId: 'conv-side' } as any],
      }),
    ).toEqual({
      workspaceConversationId: 'conv-root',
      workspaceReadFallbackConversationId: 'sub-child',
    });
  });

  it('rejects malformed ownership identities instead of normalizing them across workspaces', () => {
    expect(() => resolveConversationWorkspaceTarget({ conversationId: ' conv-root' })).toThrow(
      'conversation_workspace_id_invalid',
    );
    expect(() =>
      resolveConversationWorkspaceTarget({
        conversationId: 'conv-side',
        conversations: [
          {
            id: 'conv-side',
            isSideThread: true,
            parentConversationId: ' conv-private',
          } as any,
        ],
      }),
    ).toThrow('conversation_workspace_parent_id_invalid');
    expect(() =>
      resolveConversationWorkspaceTarget({
        conversationId: 'sub-child',
        subAgents: [{ sessionId: ' sub-child', parentConversationId: 'conv-private' } as any],
      }),
    ).toThrow('conversation_workspace_session_id_invalid');
  });
});
