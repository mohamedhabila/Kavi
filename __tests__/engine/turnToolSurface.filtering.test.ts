import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/tools/toolSurface';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('keeps code execution behind discovery', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      conversationToolNames: [],
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      conversationToolNames: ['python'],
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
      conversationToolNames: [],
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      conversationToolNames: ['browser_navigate'],
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
      conversationToolNames: ['list_files', 'list_files'],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('list_files')).toBe(true);
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(false);
  });

  it('does not keep direct latest-user side-effect tools after successful completion', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      conversationToolNames: ['write_file', 'write_file'],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
  });

  it('keeps core workbench tools on the surface after they ran', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      conversationToolNames: ['write_file', 'read_file'],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('read_file')).toBe(true);
  });

  it('adds pending async monitor tools to the core and discovery surface', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      pendingAsyncMonitorToolNames: new Set(['sessions_status']),
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    expect(selected.some((tool) => tool.name === 'sessions_status')).toBe(true);
    expect(selected.some((tool) => tool.name === 'write_file')).toBe(true);
    // The discovery tools are always on the surface: they are how any other tool gets there.
    expect(selected.some((tool) => tool.name === 'tool_catalog')).toBe(true);
  });

  it('keeps core tools a session also activated', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      sessionActivatedToolNames: ['write_file', 'memory_remember'],
      workingMessages: [userMessage('Verify the saved state.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('write_file')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
  });
});
