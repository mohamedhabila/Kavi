import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/goals/toolSurface';
import { resourceFlowTools, tools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('exposes stable graph-control and discovery tools when no graph surface is available', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage('Compare the docs and reply.')],
    });

    expect(selected.map((tool) => tool.name)).toEqual([
      'update_goals',
      'memory_recall',
      'memory_remember',
      'read_file',
      'write_file',
      'list_files',
      'tool_catalog',
      'tool_describe',
    ]);
  });

  it('keeps the discovery surface stable regardless of registry order', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [...tools].reverse(),
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage('Compare the docs and reply.')],
    });

    expect(selected.map((tool) => tool.name)).toEqual([
      'update_goals',
      'memory_recall',
      'memory_remember',
      'read_file',
      'write_file',
      'list_files',
      'tool_catalog',
      'tool_describe',
    ]);
  });

  it('surfaces memory resource tools from graph-owned memory goals', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      goals: [
        {
          id: 'memory-state',
          title: 'track-memory-facts',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'read'],
          requiredResourceKinds: ['memory'],
        },
      ],
      workingMessages: [
        userMessage('Subject `longmem-entity` has access_code `LONGMEM-E2E-42`.'),
      ],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(false);
  });

  it('exposes discovery tools as a stable graph bootstrap surface', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: true,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
    expect(selectedToolNames.has('web_search')).toBe(false);
  });

  it('exposes safe mobile discovery tools without exposing mobile side-effect consumers', () => {
    const selected = resolveTurnToolSurface({
      allTools: resourceFlowTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: true,
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('contacts_search')).toBe(true);
    expect(names.has('sms_compose')).toBe(false);
    expect(names.has('contacts_get')).toBe(false);
  });

  it('loads the discovered category tools on the turn after tool_catalog', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find the browser tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc1',
              name: 'tool_catalog',
              arguments: '{"category":"browser"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'browser',
            tools: [
              { name: 'browser_navigate' },
              { name: 'browser_click' },
              { name: 'browser_snapshot' },
            ],
          }),
          toolCallId: 'tc1',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('browser_navigate')).toBe(true);
    expect(selectedToolNames.has('browser_snapshot')).toBe(true);
    expect(selectedToolNames.has('browser_click')).toBe(true);
    expect(selectedToolNames.has('expo_eas_list_projects')).toBe(false);
  });

  it('loads code tools on the turn after tool_catalog discovers the code category', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find code tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-code',
              name: 'tool_catalog',
              arguments: '{"category":"code"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'code',
            tools: [{ name: 'javascript' }, { name: 'python' }],
          }),
          toolCallId: 'tc-code',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('javascript')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('loads pdf tools on the turn after tool_catalog discovers the pdf category', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find the PDF tools and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-pdf',
              name: 'tool_catalog',
              arguments: '{"category":"pdf"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'pdf',
            tools: [{ name: 'pdf_read' }],
          }),
          toolCallId: 'tc-pdf',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('pdf_read')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('loads search hits on the turn after tool_catalog search', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Search the catalog for memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall","capabilities":["read"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('loads described tools on the turn after tool_describe', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Describe memory recall before using it.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-describe',
              name: 'tool_describe',
              arguments: '{"name":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'describe',
            tool: { name: 'memory_recall' },
          }),
          toolCallId: 'tc-describe',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools after catalog activation exposes callable tools', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools after same-turn activation', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Discover memory recall.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-catalog',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content:
            '{"tools":[{"name":"memory_recall","activation":{"name":"memory_recall","eligible":true,"callableNow":false}}]}',
          toolCallId: 'tc-catalog',
          timestamp: 3,
        },
      ],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps web_search available after prior search and fetch activity', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Compare the docs and reply.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'web_search',
              arguments: '{"queries":["OpenAI structured outputs docs"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            provider: 'gemini',
            searches: [
              {
                query: 'OpenAI structured outputs docs',
                results: [
                  {
                    title: 'Structured outputs',
                    url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                  },
                ],
              },
            ],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          timestamp: 4,
          toolCalls: [
            {
              id: 'tc-fetch',
              name: 'web_fetch',
              arguments:
                '{"urls":["https://developers.openai.com/api/docs/guides/structured-outputs"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-2',
          role: 'tool',
          content: JSON.stringify({
            fetches: [
              {
                url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                content: 'Structured outputs guide',
              },
            ],
          }),
          toolCallId: 'tc-fetch',
          timestamp: 5,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('web_search')).toBe(true);
    expect(selectedToolNames.has('web_fetch')).toBe(true);
  });
});
