import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
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

describe('conversation workspace target attachment', () => {
  it('attaches the default workspace target to new conversations', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());

    const id = useChatStore.getState().createConversation('openai', 'sys');
    const conversation = useChatStore.getState().conversations.find((entry) => entry.id === id);

    expect(conversation?.workspaceTargetId).toBe('workspace-1');
  });

  it('attaches the default workspace target to new canonical threads', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());

    const id = useChatStore
      .getState()
      .getOrCreateCanonicalThread('openai', 'sys', 'gpt-x', { personaId: 'researcher' });
    const conversation = useChatStore.getState().conversations.find((entry) => entry.id === id);

    expect(conversation?.workspaceTargetId).toBe('workspace-1');
  });

});
