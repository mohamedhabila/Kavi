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

  it('routes memory_search through explicit voyage provider family metadata', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      provider: {
        id: 'voyage',
        name: 'Research backend',
        providerFamily: 'voyage',
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'vk',
        model: 'voyage-3-lite',
        enabled: true,
      },
      allProviders: [],
      model: 'voyage-3-lite',
    });

    await executeProviderAwareTool({
      name: 'memory_search',
      args: { query: 'facts about codex' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(mockExecuteMemorySearch).toHaveBeenCalledWith(
      { query: 'facts about codex' },
      expect.objectContaining({
        provider: 'voyage',
        apiKey: 'vk',
      }),
      { conversationId: 'workspace-1' },
    );
  });

  it('normalizes ollama memory embedding config from explicit provider family metadata', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      provider: {
        id: 'ollama',
        name: 'Local provider',
        providerFamily: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama4',
        enabled: true,
      },
      allProviders: [],
      model: 'llama4',
    });

    await executeProviderAwareTool({
      name: 'memory_search',
      args: { query: 'workspace facts' },
      conversationId: 'conversation-1',
      workspaceConversationId: 'workspace-1',
    });

    expect(mockExecuteMemorySearch).toHaveBeenCalledWith(
      { query: 'workspace facts' },
      expect.objectContaining({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
      }),
      { conversationId: 'workspace-1' },
    );
  });
});
