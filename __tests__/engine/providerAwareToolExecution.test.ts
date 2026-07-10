import { executeProviderAwareTool } from '../../src/engine/tools/providerAwareToolExecution';

const mockResolveToolProviderContext = jest.fn();

jest.mock('../../src/engine/tools/toolProviderContext', () => ({
  resolveToolProviderContext: (...args: any[]) => mockResolveToolProviderContext(...args),
}));

describe('executeProviderAwareTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('leaves local memory_search to the scoped builtin-memory route', async () => {
    const result = await executeProviderAwareTool({
      name: 'memory_search',
      args: { query: 'facts about codex' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(result).toBeNull();
    expect(mockResolveToolProviderContext).not.toHaveBeenCalled();
  });
});
