import {
  CONV_ID,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';

let executeTool: ToolDispatcherHarness['executeTool'];
let builtinMod: ToolDispatcherHarness['builtinMod'];
let executeNativeTool: ToolDispatcherHarness['executeNativeTool'];
let memoryStore: ToolDispatcherHarness['memoryStore'];
let mockRunJobNow: ToolDispatcherHarness['mockRunJobNow'];
let mockExecutePython: ToolDispatcherHarness['mockExecutePython'];
let mockRecordAgentRunEvidence: ToolDispatcherHarness['mockRecordAgentRunEvidence'];

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeTool;
  builtinMod = harness.builtinMod;
  executeNativeTool = harness.executeNativeTool;
  memoryStore = harness.memoryStore;
  mockRunJobNow = harness.mockRunJobNow;
  mockExecutePython = harness.mockExecutePython;
  mockRecordAgentRunEvidence = harness.mockRecordAgentRunEvidence;
});

describe('executeTool — core tools routing', () => {
  it('routes memory_search with the shared conversation scope', async () => {
    const result = await executeTool('memory_search', '{"query":"state"}', CONV_ID);

    expect(result).toBe(JSON.stringify({ status: 'ok' }));
    expect(builtinMod.executeMemorySearch).toHaveBeenCalledWith(
      { query: 'state' },
      {
        provider: 'openai',
        apiKey: 'sk-image',
        baseUrl: 'https://api.openai.com/v1',
      },
      { conversationId: CONV_ID },
    );
    expect(memoryStore.searchMemory).not.toHaveBeenCalledWith('state', {
      scope: 'all',
      conversationId: CONV_ID,
    });
  });

  it('normalizes python file output without store evidence writes', async () => {
    mockExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'analysis complete',
      files: [{ path: 'reports/analysis.json', contentBase64: 'e30=' }],
    });

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'print("analysis")' }),
      CONV_ID,
      {
        workspaceConversationId: CONV_ID,
      },
    );

    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print("analysis")',
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();

    expect(JSON.parse(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        fileCount: 1,
      }),
    );
  });

  it('handles invalid JSON args gracefully', async () => {
    const result = await executeTool('read_file', '{invalid json', CONV_ID);
    // Robust arg parsing falls back to {} — tool runs with no args
    expect(typeof result).toBe('string');
  });

  it('routes cron create', async () => {
    const result = await executeTool(
      'cron',
      '{"action":"create","schedule":"0 * * * *","prompt":"test"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('task_created');
  });

  it('routes cron list', async () => {
    const result = await executeTool('cron', '{"action":"list"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.jobs).toEqual([]);
  });

  it('routes cron delete', async () => {
    const result = await executeTool('cron', '{"action":"delete","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('deleted');
  });

  it('routes cron enable', async () => {
    const result = await executeTool('cron', '{"action":"enable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('enabled');
  });

  it('routes cron disable', async () => {
    const result = await executeTool('cron', '{"action":"disable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('disabled');
  });

  it('routes cron run', async () => {
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('triggered');
    expect(mockRunJobNow).toHaveBeenCalledWith('job-1', { trigger: 'manual' });
  });

  it('handles cron unknown action', async () => {
    const result = await executeTool('cron', '{"action":"bogus"}', CONV_ID);
    expect(result).toContain('unknown cron action');
  });

  it('routes notify', async () => {
    const result = await executeTool('notification_send', '{"title":"hi","body":"there"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('notification_displayed');
    expect(executeNativeTool).toHaveBeenCalledWith(
      'notification_send',
      '{"title":"hi","body":"there"}',
    );
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', '{}', CONV_ID);
    expect(result).toContain('unknown tool');
  });

  it('routes javascript', async () => {
    const result = await executeTool('javascript', '{"code":"return 42"}', CONV_ID);
    expect(result).toBe('42');
  });

  it('routes python through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["numpy"]}',
      CONV_ID,
    );
    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['numpy'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });

  it('routes python timeout overrides through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","timeoutMs":120000}',
      CONV_ID,
    );
    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        timeoutMs: 120000,
      }),
    );
  });

  it('routes python custom package indexes through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["requests"],"indexUrls":["https://packages.example/simple"]}',
      CONV_ID,
    );

    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['requests'],
        indexUrls: ['https://packages.example/simple'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });
});
