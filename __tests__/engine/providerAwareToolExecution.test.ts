import { executeProviderAwareTool } from '../../src/engine/tools/providerAwareToolExecution';

const mockExecuteMemorySearch = jest.fn();
const mockResolveToolProviderContext = jest.fn();

jest.mock('../../src/engine/tools/builtin-memory', () => ({
  executeMemorySearch: (...args: any[]) => mockExecuteMemorySearch(...args),
}));

jest.mock('../../src/engine/tools/toolProviderContext', () => ({
  resolveToolProviderContext: (...args: any[]) => mockResolveToolProviderContext(...args),
}));

describe('executeProviderAwareTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteMemorySearch.mockResolvedValue('{"ok":true}');
  });

  it('routes memory_search to living memory with the workspace conversation scope', async () => {
    await executeProviderAwareTool({
      name: 'memory_search',
      args: { query: 'facts about codex' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(mockExecuteMemorySearch).toHaveBeenCalledWith(
      { query: 'facts about codex' },
      {
        memoryConversationId: 'workspace-1',
        sourceThreadId: 'conversation-1',
        personaId: 'default',
        taskId: null,
      },
    );
    expect(mockResolveToolProviderContext).not.toHaveBeenCalled();
  });

  it('does not resolve provider embedding config for memory_search', async () => {
    await executeProviderAwareTool({
      name: 'memory_search',
      args: { query: 'workspace facts' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(mockExecuteMemorySearch).toHaveBeenCalledWith(
      { query: 'workspace facts' },
      {
        memoryConversationId: 'workspace-1',
        sourceThreadId: 'conversation-1',
        personaId: 'default',
        taskId: null,
      },
    );
    expect(mockResolveToolProviderContext).not.toHaveBeenCalled();
  });
});
