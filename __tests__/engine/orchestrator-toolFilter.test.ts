// ---------------------------------------------------------------------------
// Tests — Orchestrator toolFilter (sandbox enforcement)
// ---------------------------------------------------------------------------

import {
  makeCallbacks,
  makeMsg,
  makeStream,
  mockExecuteTool,
  mockStreamMessage,
  provider,
  resetOrchestratorToolFilterHarness,
  setMockDisableLongTermMemory,
  type OrchestratorOptions,
} from './helpers/orchestratorToolFilterHarness';
import { runOrchestrator } from '../../src/engine/orchestrator';
import { MEMORY_DISABLED_RUNTIME_CAPABILITY } from '../../src/engine/prompts/memoryPolicyPrompt';

beforeEach(() => {
  resetOrchestratorToolFilterHarness();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('Orchestrator — toolFilter', () => {
  it('treats toolFilter as subtractive authorization without grounding every allowed tool', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-tools',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Search the documentation and fetch the page')],
      toolFilter: (name) => name === 'web_search' || name === 'web_fetch',
    };

    await runOrchestrator(options, callbacks);

    const [, streamOptions] = mockStreamMessage.mock.calls[0];
    expect(streamOptions.tools.map((tool: any) => tool.name)).toEqual([]);
  });

  it('advertises deliberately pinned tools within the authorization boundary', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-explicit-tool-surface',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Search the documentation and fetch the page')],
      explicitToolSurfaceToolNames: ['web_search', 'web_fetch', 'write_file'],
      toolFilter: (name) => name === 'web_search' || name === 'web_fetch',
    };

    await runOrchestrator(options, callbacks);

    const [, streamOptions] = mockStreamMessage.mock.calls[0];
    expect(streamOptions.tools.map((tool: any) => tool.name).sort()).toEqual([
      'web_fetch',
      'web_search',
    ]);
  });

  it('cannot re-advertise disabled memory capabilities through caller tool selection', async () => {
    setMockDisableLongTermMemory(true);
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Memory is disabled.' },
          { type: 'done', content: 'Memory is disabled.' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const memoryTools = ['memory_recall', 'memory_remember', 'memory_forget'];
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-memory-policy-filter',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Remember this preference')],
      explicitToolSurfaceToolNames: [...memoryTools, 'web_search'],
      toolFilter: (name) => memoryTools.includes(name) || name === 'web_search',
    };

    await runOrchestrator(options, callbacks);

    const [, streamOptions] = mockStreamMessage.mock.calls[0];
    expect(streamOptions.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      'memory_forget',
      'web_search',
    ]);
    const [requestMessages] = mockStreamMessage.mock.calls[0];
    expect(requestMessages[0].content).toContain(MEMORY_DISABLED_RUNTIME_CAPABILITY);
  });

  it('advertises memory capabilities normally while the policy is enabled', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    const memoryTools = ['memory_recall', 'memory_remember', 'memory_forget'];
    await runOrchestrator(
      {
        provider,
        model: 'gpt-test',
        conversationId: 'conv-memory-policy-enabled',
        systemPrompt: 'Test',
        messages: [makeMsg('user', 'Remember this preference')],
        explicitToolSurfaceToolNames: memoryTools,
        toolFilter: (name) => memoryTools.includes(name),
      },
      callbacks,
    );

    const [, streamOptions] = mockStreamMessage.mock.calls[0];
    expect(streamOptions.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      memoryTools.sort(),
    );
    const [requestMessages] = mockStreamMessage.mock.calls[0];
    expect(requestMessages[0].content).not.toContain(MEMORY_DISABLED_RUNTIME_CAPABILITY);
  });

  it('revokes memory capabilities and updates policy truth within an active run', async () => {
    mockExecuteTool.mockImplementationOnce(async () => {
      setMockDisableLongTermMemory(true);
      return { status: 'completed', content: 'search complete' };
    });
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc-policy-transition',
                name: 'web_search',
                arguments: '{"queries":["release status"]}',
              },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Memory is disabled.' },
            { type: 'done', content: 'Memory is disabled.' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const explicitTools = ['memory_recall', 'memory_remember', 'memory_forget', 'web_search'];
    await runOrchestrator(
      {
        provider,
        model: 'gpt-test',
        conversationId: 'conv-memory-policy-transition',
        systemPrompt: 'Test',
        messages: [makeMsg('user', 'Check the release and remember the result')],
        explicitToolSurfaceToolNames: explicitTools,
        toolFilter: (name) => explicitTools.includes(name),
      },
      callbacks,
    );

    const firstTools = mockStreamMessage.mock.calls[0][1].tools.map(
      (tool: { name: string }) => tool.name,
    );
    const secondTools = mockStreamMessage.mock.calls[1][1].tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(firstTools).toEqual(expect.arrayContaining(['memory_recall', 'memory_remember']));
    expect(secondTools).not.toContain('memory_recall');
    expect(secondTools).not.toContain('memory_remember');
    expect(secondTools).toContain('memory_forget');
    expect(mockStreamMessage.mock.calls[1][0][0].content).toContain(
      MEMORY_DISABLED_RUNTIME_CAPABILITY,
    );
  });

  it('passes the filtered callable tool inventory into executeTool context', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc-catalog', name: 'tool_catalog', arguments: '{"category":"mcp"}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Done' },
            { type: 'done', content: 'Done' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-catalog-context',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Inspect MCP capabilities')],
      toolFilter: (name) => name === 'tool_catalog' || name === 'read_file',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool_catalog',
      '{"category":"mcp"}',
      'conv-filter-catalog-context',
      expect.objectContaining({
        availableToolNames: ['read_file', 'tool_catalog'],
      }),
    );
  });

  it('blocks a tool call when toolFilter returns false', async () => {
    // First stream returns a tool call, second returns final text
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc1',
                name: 'write_file',
                arguments: '{"path":"artifacts/blocked.txt","content":"x"}',
              },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Done' },
            { type: 'done', content: 'Done' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Do something')],
      toolFilter: (name) => name !== 'write_file',
    };

    await runOrchestrator(options, callbacks);

    // The dangerous tool should NOT have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();

    // Preflight-blocked tools stay out of user-visible trace callbacks
    expect(callbacks.calls.onToolCallStart).toHaveLength(0);
    expect(callbacks.calls.onToolCallComplete).toHaveLength(0);
    expect(callbacks.calls.onToolMessage).toHaveLength(1);
    expect(callbacks.calls.onToolMessage[0]?.content).toContain('not allowed');
    expect(callbacks.calls.onToolMessage[0]?.status).toBe('failed');
  });

  it('allows a tool call when toolFilter returns true', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: {
                id: 'tc2',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
              },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Result' },
            { type: 'done', content: 'Result' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-pass',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Do something safe')],
      explicitToolSurfaceToolNames: ['read_file'],
      toolFilter: (name) => name === 'read_file',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'read_file',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'gpt-test' }),
    );
  });

  it('treats toolFilter names as exact tool contract identifiers', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc-alias', name: 'ReadFile', arguments: '{"path":"notes.txt"}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Done' },
            { type: 'done', content: 'Done' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-alias',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Read notes.txt')],
      toolFilter: (name) => name === 'read_file',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(callbacks.calls.onToolCallStart).toHaveLength(0);
    expect(callbacks.calls.onToolCallComplete).toHaveLength(0);
    expect(callbacks.calls.onToolMessage).toHaveLength(1);
    expect(callbacks.calls.onToolMessage[0]?.content).toContain('not registered');
    expect(callbacks.calls.onToolMessage[0]?.status).toBe('failed');
  });

  it('uses a deliberately pinned tool surface when toolFilter is undefined', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc3', name: 'read_file', arguments: '{"path":"notes.txt"}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'OK' },
            { type: 'done', content: 'OK' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-no-filter',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Anything')],
      explicitToolSurfaceToolNames: ['read_file'],
      // toolFilter omitted
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'read_file',
      '{"path":"notes.txt"}',
      'conv-no-filter',
      expect.any(Object),
    );
    expect(callbacks.calls.onToolMessage).toHaveLength(1);
    expect(callbacks.calls.onToolMessage[0]).toEqual({
      version: 1,
      toolCallId: 'tc3',
      status: 'completed',
      content: 'tool result',
    });
  });

  it.each([
    {
      toolName: 'update_goals',
      argumentsJson: '{"action":"add","id":"chat-loop","name":"Chat loop"}',
    },
    {
      toolName: 'sessions_spawn',
      argumentsJson: '{"task":"Continue this conversation in a worker"}',
    },
  ])(
    'does not advertise or execute $toolName for a chitchat conversation',
    async ({ toolName, argumentsJson }) => {
      mockStreamMessage
        .mockReturnValueOnce(
          makeStream(
            [
              {
                type: 'tool_call',
                toolCall: {
                  id: `tc-hidden-${toolName}`,
                  name: toolName,
                  arguments: argumentsJson,
                },
              },
              { type: 'done', content: '' },
            ],
            'tool',
          ),
        )
        .mockReturnValueOnce(
          makeStream(
            [
              { type: 'token', content: 'Conversational answer' },
              { type: 'done', content: 'Conversational answer' },
            ],
            'text',
          ),
        );

      const callbacks = makeCallbacks();
      await runOrchestrator(
        {
          provider,
          model: 'gpt-test',
          conversationId: 'conv-chitchat-authority',
          systemPrompt: 'Test',
          messages: [makeMsg('user', 'Let us chat')],
          personaId: 'default',
        },
        callbacks,
      );

      const [, firstStreamOptions] = mockStreamMessage.mock.calls[0];
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        'update_goals',
      );
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        'sessions_spawn',
      );
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).toContain(
        'memory_remember',
      );
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        'memory_manage',
      );
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        'calendar_list',
      );
      expect(firstStreamOptions.tools.map((tool: { name: string }) => tool.name)).not.toContain(
        'read_file',
      );
      expect(mockExecuteTool).not.toHaveBeenCalled();
      expect(callbacks.calls.onToolMessage[0]?.content).toContain('not allowed');
      expect(callbacks.calls.onToolMessage[0]?.status).toBe('failed');
      expect(callbacks.calls.onDone).toHaveLength(1);
    },
  );

  it('blocks tool but continues orchestration with next text response', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: '' },
            {
              type: 'tool_call',
              toolCall: { id: 'tc4', name: 'list_files', arguments: '{"path":"artifacts"}' },
            },
            { type: 'done', content: '' },
          ],
          'tool',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [
            { type: 'token', content: 'Fallback answer' },
            { type: 'done', content: 'Fallback answer' },
          ],
          'text',
        ),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-blocked-continue',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Try blocked tool')],
      toolFilter: () => false,
    };

    await runOrchestrator(options, callbacks);

    // Should complete with onDone
    expect(callbacks.onDone).toHaveBeenCalled();
    // Tool should not have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});

describe('Orchestrator — cancel before tool execution', () => {
  it('does not execute tool when signal is aborted', async () => {
    const abortController = new AbortController();

    mockStreamMessage.mockReturnValueOnce(
      makeStream(
        [
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc-cancel', name: 'some_tool', arguments: '{}' } },
          { type: 'done', content: '' },
        ],
        'tool',
      ),
    );

    // Abort before tool execution starts (simulate via onToolCallStart)
    const callbacks = makeCallbacks();
    const originalOnToolCallStart = callbacks.onToolCallStart;
    callbacks.onToolCallStart = jest.fn((tc) => {
      // Abort as soon as we see tool call start (before execution)
      if (tc.status === 'running') {
        abortController.abort();
      }
      originalOnToolCallStart(tc);
    });

    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-cancel',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Run tool')],
      signal: abortController,
    };

    await runOrchestrator(options, callbacks);

    // Tool should not have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});
