import {
  filterToolsByRuntimeAvailability,
  getRuntimeToolAvailabilityContext,
  hasLaunchableWorkspaceTargets,
  remapRuntimeUnavailableToolNames,
  resolveRuntimeFallbackToolName,
} from '../../src/engine/tools/runtimeAvailability';
import type { ToolDefinition, WorkspaceTargetConfig } from '../../src/types';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    input_schema: { type: 'object', properties: {} },
  };
}

function makeWorkspaceTarget(
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig {
  return {
    id: 'ws-1',
    name: 'Workspace',
    rootPath: '/workspace/project',
    provider: 'code-server',
    baseUrl: 'https://workspace.example.com',
    authMode: 'none',
    enabled: true,
    ...overrides,
  };
}

describe('runtimeAvailability', () => {
  it('detects when no launchable workspace targets exist', () => {
    expect(hasLaunchableWorkspaceTargets([])).toBe(false);
    expect(hasLaunchableWorkspaceTargets([makeWorkspaceTarget({ enabled: false })])).toBe(false);
  });

  it('does not treat browser-only IDE targets as file-capable workspace targets', () => {
    expect(
      hasLaunchableWorkspaceTargets([makeWorkspaceTarget({ provider: 'vscode-tunnel' })]),
    ).toBe(false);
  });

  it('detects when a launchable workspace target exists', () => {
    expect(hasLaunchableWorkspaceTargets([makeWorkspaceTarget()])).toBe(true);
  });

  it('filters remote workspace tools when no launchable workspace target exists', () => {
    const tools = [
      makeTool('read_file'),
      makeTool('write_file'),
      makeTool('workspace_status'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_read_file'),
      makeTool('workspace_write_file'),
      makeTool('workspace_list_files'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: false,
      hasLaunchableWorkspaceTargets: false,
      hasControllableWorkspaceTargets: false,
    });
    const filteredNames = new Set(filtered.map((tool) => tool.name));

    expect(filteredNames.has('read_file')).toBe(true);
    expect(filteredNames.has('write_file')).toBe(true);
    expect(filteredNames.has('workspace_status')).toBe(false);
    expect(filteredNames.has('workspace_launch_browser')).toBe(false);
    expect(filteredNames.has('workspace_read_file')).toBe(false);
    expect(filteredNames.has('workspace_write_file')).toBe(false);
    expect(filteredNames.has('workspace_list_files')).toBe(false);
  });

  it('keeps workspace status when targets exist but only control paths are configured', () => {
    const tools = [
      makeTool('workspace_status'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_read_file'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: true,
      hasLaunchableWorkspaceTargets: false,
      hasControllableWorkspaceTargets: true,
    });

    expect(filtered.map((tool) => tool.name)).toEqual([
      'workspace_status',
      'workspace_launch_browser',
    ]);
  });

  it('retains remote workspace tools when a launchable workspace target exists', () => {
    const tools = [makeTool('read_file'), makeTool('workspace_write_file')];

    const filtered = filterToolsByRuntimeAvailability(
      tools,
      getRuntimeToolAvailabilityContext([makeWorkspaceTarget()]),
    );

    expect(filtered.map((tool) => tool.name)).toEqual(['read_file', 'workspace_write_file']);
  });

  it('falls back from remote workspace file tools to local workspace tools when unavailable', () => {
    const resolved = resolveRuntimeFallbackToolName('workspace_write_file', {
      availableToolNames: new Set(['read_file', 'write_file', 'list_files']),
      context: {
        hasWorkspaceTargets: false,
        hasLaunchableWorkspaceTargets: false,
        hasControllableWorkspaceTargets: false,
      },
    });

    expect(resolved).toBe('write_file');
  });

  it('does not fall back when a launchable workspace target exists', () => {
    const resolved = resolveRuntimeFallbackToolName('workspace_write_file', {
      availableToolNames: new Set(['read_file', 'write_file', 'workspace_write_file']),
      context: {
        hasWorkspaceTargets: true,
        hasLaunchableWorkspaceTargets: true,
        hasControllableWorkspaceTargets: false,
      },
    });

    expect(resolved).toBe('workspace_write_file');
  });

  it('remaps and deduplicates stale workspace tool arrays', () => {
    const remapped = remapRuntimeUnavailableToolNames(
      [
        'workspace_read_file',
        'workspace_write_file',
        'workspace_list_files',
        'workspace_write_file',
      ],
      {
        context: {
          hasWorkspaceTargets: false,
          hasLaunchableWorkspaceTargets: false,
          hasControllableWorkspaceTargets: false,
        },
      },
    );

    expect(remapped).toEqual(['read_file', 'write_file', 'list_files']);
  });
});
