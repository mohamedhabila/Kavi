import {
  resolveOrderedGoalCapabilities,
  resolveTurnToolSurface,
} from '../../../src/engine/goals/toolSurface';
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
    name: 'memory_recall',
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
    name: 'update_goals',
    description: 'Update graph goals.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'tools',
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
];

function selectedNames(surface: ToolDefinition[]): Set<string> {
  return new Set(surface.map((tool) => tool.name));
}

describe('resolveOrderedGoalCapabilities', () => {
  it('preserves goal declaration order and deduplicates', () => {
    expect(resolveOrderedGoalCapabilities(['write', 'read', 'discover', 'read'])).toEqual([
      'write',
      'read',
      'discover',
    ]);
  });

  it('keeps calendar workflow discover-before-read ordering', () => {
    expect(resolveOrderedGoalCapabilities(['discover', 'read', 'verify'])).toEqual([
      'discover',
      'read',
      'verify',
    ]);
  });
});

describe('resolveTurnToolSurface discovery decay', () => {
  it('combines pending async monitors, default core tools, and goal capabilities', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'memory-goal',
          title: 'Recall memory',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['read'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set(['read_file']),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('memory_recall')).toBe(true);
    expect(selectedNames(surface).has('read_file')).toBe(true);
    expect(selectedNames(surface).has('tool_catalog')).toBe(false);
  });

  it('keeps discovery tools available after session activation', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_recall']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_goals')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps discovery tools after the same user turn activated catalog results', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_recall']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_goals')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('keeps graph mutation available after completed work so the next task can bootstrap', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'done',
          title: 'done',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:{"status":"written"}'],
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
          completionPolicy: 'blocking',
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('update_goals')).toBe(true);
  });

  it('keeps graph mutation available for live graph work', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'active',
          title: 'active',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          completionPolicy: 'blocking',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('update_goals')).toBe(true);
  });

  it('exposes the stable core workbench when no live graph scope exists', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_goals')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('write_file')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(false);
  });

  it('exposes the discovery entrypoint when the graph has no narrower surface', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
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
      goals: [],
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

  it('narrows goal capability tools by required resource kind', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'memory-goal',
          title: 'Track facts',
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

    const names = selectedNames(surface);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('read_file')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(false);
    expect(names.has('tool_catalog')).toBe(false);
  });

  it('keeps memory tools as core without adding memory-block tools from unscoped goals', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'scope-a',
          title: 'scope-a-planning',
          status: 'active',
          completionPolicy: 'persistent',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('update_goals')).toBe(true);
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('memory_block')).toBe(false);
  });

  it('does not treat memory block editing as structured fact-memory grounding', () => {
    const memoryBlockTool: ToolDefinition = {
      name: 'memory_block',
      description: 'Read or edit model-editable memory blocks.',
      input_schema: { type: 'object', properties: {} },
      contract: {
        category: 'memory_block',
        capabilities: ['read', 'write'],
        resourceKinds: ['memory_block'],
        sideEffects: ['local_artifact'],
      },
    };
    const surface = resolveTurnToolSurface({
      allTools: [...discoveryTools, memoryBlockTool],
      goals: [
        {
          id: 'memory-state',
          title: 'Track durable memory',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write', 'read'],
          requiredResourceKinds: ['memory'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('memory_remember')).toBe(true);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('memory_block')).toBe(false);
  });

  it('surfaces workspace writers from active artifact success criteria', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
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

    const names = selectedNames(surface);
    expect(names.has('write_file')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(true);
    expect(names.has('browser_navigate')).toBe(false);
  });

  it('surfaces workspace writers from active file-hash success criteria', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'hash-goal',
          title: 'Persist hashed artifact',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          successCriteria: ['evidence.file_hash:artifacts/e2e-goal.txt:sha256'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('write_file')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(true);
    expect(names.has('browser_navigate')).toBe(false);
  });

  it('surfaces exact tools from active structural evidence-tool criteria', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'exact-tool-goal',
          title: 'Use explicit evidence source',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          successCriteria: ['evidence.tool:write_file'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set<string>(),
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('write_file')).toBe(true);
    expect(names.has('workspace_note_write')).toBe(false);
  });

  it('keeps discovery tools when catalog activation has already exposed callable tools', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['memory_recall']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: true,
    });

    const names = selectedNames(surface);
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);
  });

  it('does not resurrect side-effectful catalog activations without live graph scope', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'done-workspace',
          title: 'Done workspace task',
          status: 'completed',
          dependencies: [],
          evidence: ['workspace_note_write:done'],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['workspace_note_write', 'memory_remember']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    const names = selectedNames(surface);
    expect(names.has('workspace_note_write')).toBe(false);
    expect(names.has('memory_remember')).toBe(true);
  });

  it('allows side-effectful catalog activations required by live graph scope', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'active-workspace',
          title: 'Active workspace task',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['workspace_note_write']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('workspace_note_write')).toBe(true);
  });

  it('allows side-effectful catalog activations without a completed graph resource owner', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
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
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['workspace_note_write'],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['workspace_note_write']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('workspace_note_write')).toBe(false);
  });

  it('does not self-repin completed non-memory read tools without live graph scope', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: ['read_file'],
      recentContinuationToolNames: new Set(['read_file']),
      activatedCatalogToolNames: new Set<string>(),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('read_file')).toBe(true);
  });

  it('does not reactivate side-effectful catalog tools already evidenced by completed goals', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'done-weak',
          title: 'Done weak goal',
          status: 'completed',
          dependencies: [],
          evidence: ['workspace_note_write:{"status":"written"}'],
          createdAt: 1,
          updatedAt: 2,
      completionPolicy: 'blocking',
          successCriteria: ['evidence.min:1'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['workspace_note_write']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('workspace_note_write')).toBe(false);
  });

  it('does not keep completed artifact-criterion writers hot without live graph scope', () => {
    const surface = resolveTurnToolSurface({
      allTools: discoveryTools,
      goals: [
        {
          id: 'done-artifact',
          title: 'Done artifact task',
          status: 'completed',
          dependencies: [],
          evidence: ['write_file:{"status":"written","path":"artifacts/out.txt"}'],
          createdAt: 1,
          updatedAt: 2,
          completionPolicy: 'blocking',
          successCriteria: ['evidence.artifact:artifacts/out.txt'],
        },
      ],
      pendingAsyncMonitorToolNames: new Set<string>(),
      observedToolNames: [],
      recentContinuationToolNames: new Set<string>(),
      activatedCatalogToolNames: new Set(['write_file']),
      unresolvedDiscoveryToolCallInTurn: false,
      includeToolCatalog: false,
    });

    expect(selectedNames(surface).has('write_file')).toBe(true);
    expect(selectedNames(surface).has('workspace_note_write')).toBe(false);
  });
});
