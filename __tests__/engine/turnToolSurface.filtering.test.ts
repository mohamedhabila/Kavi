import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/goals/toolSurface';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('requires resource-scoped graph capability before code tools enter the hot surface', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'compute-workspace',
          title: 'Compute workspace result',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['compute'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('python')).toBe(false);
    expect(unscopedToolNames.has('web_search')).toBe(false);
    expect(scopedToolNames.has('python')).toBe(true);
  });

  it('requires resource-scoped graph capability before side-effect tools enter the hot surface', () => {
    const unscoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const scoped = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'workspace-artifact',
          title: 'Persist workspace artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'read'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const unscopedToolNames = new Set(unscoped.map((tool) => tool.name));
    const scopedToolNames = new Set(scoped.map((tool) => tool.name));
    expect(unscopedToolNames.has('write_file')).toBe(true);
    expect(unscopedToolNames.has('read_file')).toBe(true);
    expect(unscopedToolNames.has('browser_navigate')).toBe(false);
    expect(scopedToolNames.has('write_file')).toBe(true);
  });

  it('does not add latest-user selected side-effect tools without matching graph scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'memory-state',
          title: 'Track durable memory',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read', 'write'],
          requiredResourceKinds: ['memory'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('python')).toBe(false);
    expect(selectedToolNames.has('memory_recall')).toBe(true);
  });

  it('keeps read-only same-turn continuation without adding unrelated side-effect tools', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
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
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file'],
      recentContinuationToolNames: new Set<string>(['write_file']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
  });

  it('treats artifact success criteria as live workspace writer scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'artifact-goal',
          title: 'Persist artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          successCriteria: ['evidence.artifact:artifacts/e2e-goal.txt'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('write_file')).toBe(true);
    expect(selectedToolNames.has('file_edit')).toBe(true);
    expect(selectedToolNames.has('browser_navigate')).toBe(false);
  });

  it('does not keep completed artifact writers selected from continuation alone', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [
        {
          id: 'done-artifact',
          title: 'Persisted artifact',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:{"status":"written","path":"artifacts/e2e-goal.txt"}'],
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
          successCriteria: ['evidence.artifact:artifacts/e2e-goal.txt'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['write_file'],
      recentContinuationToolNames: new Set(['write_file']),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selected.some((tool) => tool.name === 'write_file')).toBe(true);
  });

  it('does not repin observed side-effect tools without live graph scope', () => {
    const selected = resolveTurnToolSurface({
      allTools: tools,
      goals: [],
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

  it('suppresses side-effectful session activations without live graph scope', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['write_file', 'memory_remember'],
      goals: [
        {
          id: 'done-file',
          title: 'Done file task',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:done'],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      workingMessages: [userMessage('Verify the saved state.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('write_file')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
  });
});
