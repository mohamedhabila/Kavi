import { resolveTurnToolSurface } from '../../../src/engine/tools/toolSurface';
import type { ToolDefinition } from '../../../src/types/tool';

const discoveryTools: ToolDefinition[] = [
  {
    name: 'tool_catalog',
    description: 'Discover tools.',
    input_schema: { type: 'object', properties: {} },
    contract: { category: 'tools', capabilities: ['discover'], resourceKinds: ['unknown'] },
  },
  {
    name: 'tool_describe',
    description: 'Describe one tool.',
    input_schema: { type: 'object', properties: {} },
    contract: { category: 'tools', capabilities: ['discover'], resourceKinds: ['unknown'] },
  },
  {
    name: 'memory_search',
    description: 'Recall memory facts.',
    input_schema: { type: 'object', properties: {} },
    contract: { category: 'memory', capabilities: ['read'], resourceKinds: ['memory'] },
  },
  {
    name: 'memory_remember',
    description: 'Store memory facts.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'memory',
      capabilities: ['write'],
      resourceKinds: ['memory'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'memory_forget',
    description: 'Permanently withdraw a memory fact.',
    input_schema: {
      type: 'object',
      properties: { factId: { type: 'string' } },
      required: ['factId'],
    },
    contract: {
      category: 'memory',
      capabilities: ['delete'],
      resourceKinds: ['memory'],
      sideEffects: ['destructive'],
      riskHints: ['destructive', 'requires_approval'],
      riskLevel: 'high',
    },
  },
  {
    name: 'update_plan',
    description: 'Update the task plan.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'plan',
      capabilities: ['coordinate'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    contract: {
      category: 'workspace_files',
      capabilities: ['read'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    contract: {
      category: 'workspace_files',
      capabilities: ['write', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'workspace_note_write',
    description: 'Write a non-core workspace note.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'workspace_files',
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a browser session.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'browser',
      capabilities: ['read', 'write', 'verify'],
      resourceKinds: ['browser'],
      sideEffects: ['external_run'],
    },
  },
  {
    name: 'cron',
    description: 'Manage scheduled assistant tasks.',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string' }, id: { type: 'string' } },
      required: ['action'],
    },
    contract: {
      category: 'automation',
      capabilities: ['coordinate', 'monitor'],
      resourceKinds: ['device'],
      sideEffects: ['local_artifact'],
    },
  },
];

function selectedNames(surface: ToolDefinition[]): Set<string> {
  return new Set(surface.map((tool) => tool.name));
}

describe('resolveTurnToolSurface discovery decay', () => {
  it('combines pending async monitors and default core tools', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set(['read_file']),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('memory_search')).toBe(true);
    expect(selectedNames(surface).has('read_file')).toBe(true);
    expect(selectedNames(surface).has('tool_catalog')).toBe(false);
  });

  it('keeps discovery tools available after session activation', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_search']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_plan')).toBe(true);
    expect(names.has('memory_search')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools after the same user turn activated catalog results', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_search']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_plan')).toBe(true);
    expect(names.has('memory_search')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps the plan tool on the core surface', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('update_plan')).toBe(true);
  });

  it('exposes the stable core workbench', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_plan')).toBe(true);
    expect(names.has('memory_search')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('memory_forget')).toBe(true);
    expect(names.has('write_file')).toBe(true);
    expect(names.has('cron')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(false);
  });

  it('exposes the discovery entrypoint when asked', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: true,
    });

    const names = selectedNames(surface);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools while a catalog call is unresolved in the current user turn', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      unresolvedDiscoveryToolCallInTurn: true,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools when catalog activation has already exposed callable tools', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_search']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: true,
    });

    const names = selectedNames(surface);
    expect(names.has('memory_search')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps a side-effectful catalog activation until the tool runs', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['browser_navigate']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('browser_navigate')).toBe(true);
  });

  it('does not reactivate an already completed side-effectful workflow tool from catalog', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['workspace_note_write'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['workspace_note_write']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('workspace_note_write')).toBe(false);
  });

  it('keeps a core reader after it ran', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['read_file'],
      recentContinuationToolNames: new Set(['read_file']),
      activatedCatalogToolNames: new Set<string>(),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('read_file')).toBe(true);
  });
});
