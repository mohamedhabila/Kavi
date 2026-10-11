import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/tools/toolSurface';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('keeps code execution behind discovery', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['python']),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('python')).toBe(false);
    // web_search is default everyday surface now; code execution still requires a
    // discovery activation, which is what this test guards.
    expect(unscopedToolNames.has('web_search')).toBe(true);
    expect(scopedToolNames.has('python')).toBe(true);
  });

  it('keeps side-effect tools outside the core behind discovery', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['browser_navigate']),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('write_file')).toBe(true);
    expect(unscopedToolNames.has('read_file')).toBe(true);
    expect(unscopedToolNames.has('browser_navigate')).toBe(false);
    expect(scopedToolNames.has('write_file')).toBe(true);
    expect(scopedToolNames.has('browser_navigate')).toBe(true);
  });

  it('keeps read-only same-turn continuation without adding unrelated side-effect tools', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['list_files'],
      recentContinuationToolNames: new Set<string>(['list_files']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('list_files')).toBe(true);
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(false);
  });

  it('does not keep direct latest-user side-effect tools after successful completion', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file'],
      recentContinuationToolNames: new Set<string>(['write_file']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
  });

  it('keeps core workbench tools on the surface after they ran', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file', 'read_file'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('read_file')).toBe(true);
  });

  it('does not carry forward side-effectful category tools from recent use alone', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Inspect the page and continue.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-browser',
              name: 'browser_navigate',
              arguments: '{"urls":["https://example.com"]}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: '{"ok":true}',
          toolCallId: 'tc-browser',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('browser_navigate')).toBe(false);
    expect(selectedToolNames.has('browser_snapshot')).toBe(false);
    expect(selectedToolNames.has('browser_click')).toBe(false);
  });

  it('keeps pending async monitor tools without broad default or discovery fallback', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set(['read_file', 'web_search']),
      pendingAsyncMonitorToolNames: new Set(['sessions_status']),
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    expect(selected.some((tool) => tool.name === 'sessions_status')).toBe(true);
    expect(selected.some((tool) => tool.name === 'write_file')).toBe(true);
    expect(selected.some((tool) => tool.name === 'tool_catalog')).toBe(false);
  });

  it('keeps core tools a session also activated', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['write_file', 'memory_remember'],
      workingMessages: [userMessage('Verify the saved state.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('write_file')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
  });
});
