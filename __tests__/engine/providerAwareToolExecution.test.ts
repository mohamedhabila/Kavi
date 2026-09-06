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

  it('fails sessions_spawn with a structured unavailable failureKind when no provider is configured', async () => {
    mockResolveToolProviderContext.mockResolvedValue({ provider: null, allProviders: [] });

    const result = await executeProviderAwareTool({
      name: 'sessions_spawn',
      args: { task: 'Investigate the failing build' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(result?.status).toBe('failed');
    expect((result as { failureKind?: string })?.failureKind).toBe('unavailable');
  });

  it('fails sessions_send with a structured unavailable failureKind when no provider is configured', async () => {
    mockResolveToolProviderContext.mockResolvedValue({ provider: null, allProviders: [] });

    const result = await executeProviderAwareTool({
      name: 'sessions_send',
      args: { sessionId: 'session-1', message: 'status?' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(result?.status).toBe('failed');
    expect((result as { failureKind?: string })?.failureKind).toBe('unavailable');
  });
});
