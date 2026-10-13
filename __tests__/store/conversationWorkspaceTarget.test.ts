import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { WorkspaceTargetConfig } from '../../src/types/remote';
import { addConversation } from '../helpers/chatConversationFixtures';

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

    const id = addConversation('openai', 'sys');
    const conversation = useChatStore.getState().conversations.find((entry) => entry.id === id);

    expect(conversation?.workspaceTargetId).toBe('workspace-1');
  });

  it('attaches the default workspace target to the one conversation', () => {
    useSettingsStore.getState().addWorkspaceTarget(makeWorkspaceTarget());

    const id = useChatStore.getState().ensureConversation('openai', 'sys', 'gpt-x');
    const conversation = useChatStore.getState().conversations.find((entry) => entry.id === id);

    expect(conversation?.workspaceTargetId).toBe('workspace-1');
  });

});
