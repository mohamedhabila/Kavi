import {
  hasBrowserControllableWorkspaceTargets,
  hasDelegableWorkspaceTargets,
  filterRuntimeAvailableToolNames,
  filterToolsByRuntimeAvailability,
  isToolRuntimeAvailable,
  resolveRuntimeExplicitToolSurfaceToolNames,
  type RuntimeToolAvailabilityContext,
} from '../../src/engine/tools/runtimeAvailability';
import { resolveToolRuntimeRequirements } from '../../src/engine/tools/toolRuntimeRequirements';
import {
  isSearchProviderConfiguredSnapshot,
  setSearchProviderReadinessSnapshot,
} from '../../src/services/browser/core/searchProviderReadiness';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { ToolDefinition } from '../../src/types/tool';
import type { WorkspaceTargetConfig } from '../../src/types/remote';

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

beforeEach(() => {
  useSettingsStore.setState({
    browserProviders: [
      {
        id: 'browser-1',
        name: 'Browser worker',
        provider: 'custom',
        baseUrl: 'https://browser.example.com',
        authMode: 'none',
        enabled: true,
      },
    ],
    sshTargets: [
      {
        id: 'ssh-1',
        name: 'Builder',
        host: 'ssh.example.com',
        port: 22,
        username: 'dev',
        passwordRef: 'ssh_password_ref',
        enabled: true,
      },
    ],
  });
});

describe('runtimeAvailability', () => {
  it('detects when no browser-controllable workspace targets exist', () => {
    expect(hasBrowserControllableWorkspaceTargets([])).toBe(false);
    expect(hasBrowserControllableWorkspaceTargets([makeWorkspaceTarget({ enabled: false })])).toBe(
      false,
    );
  });

  it('treats launchable browser-first IDE targets as browser-controllable', () => {
    expect(
      hasBrowserControllableWorkspaceTargets([makeWorkspaceTarget({ provider: 'vscode-tunnel' })]),
    ).toBe(true);
  });

  it('detects when a browser-controllable workspace target exists', () => {
    expect(hasBrowserControllableWorkspaceTargets([makeWorkspaceTarget()])).toBe(true);
  });

  it('does not mark delegable workspace targets as available when SSH transport is unavailable in the current runtime', () => {
    expect(
      hasDelegableWorkspaceTargets([
        makeWorkspaceTarget({ provider: 'cursor', sshTargetId: 'ssh-1' }),
      ]),
    ).toBe(false);
  });

  it('filters external workspace control tools when no workspace targets exist', () => {
    const tools = [
      makeTool('read_file'),
      makeTool('write_file'),
      makeTool('workspace_status'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_delegate_task'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    });
    const filteredNames = new Set(filtered.map((tool) => tool.name));

    expect(filteredNames.has('read_file')).toBe(true);
    expect(filteredNames.has('write_file')).toBe(true);
    expect(filteredNames.has('workspace_status')).toBe(false);
    expect(filteredNames.has('workspace_launch_browser')).toBe(false);
    expect(filteredNames.has('workspace_delegate_task')).toBe(false);
  });

  it('keeps workspace status and only the matching control tool for available target capabilities', () => {
    const tools = [
      makeTool('workspace_status'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_delegate_task'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: true,
      hasBrowserControllableWorkspaceTargets: true,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    });

    expect(filtered.map((tool) => tool.name)).toEqual([
      'workspace_status',
      'workspace_launch_browser',
    ]);
  });

  it('retains the matching external workspace control tools when runtime capabilities exist', () => {
    const tools = [
      makeTool('read_file'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_delegate_task'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: true,
      hasBrowserControllableWorkspaceTargets: true,
      hasDelegableWorkspaceTargets: true,
      hasMobileController: false,
    });

    expect(filtered.map((tool) => tool.name)).toEqual([
      'read_file',
      'workspace_launch_browser',
      'workspace_delegate_task',
    ]);
  });

  it('filters unavailable external workspace tools out of explicit tool selections', () => {
    const filtered = filterRuntimeAvailableToolNames(
      ['workspace_launch_browser', 'workspace_delegate_task', 'workspace_launch_browser'],
      {
        hasWorkspaceTargets: false,
        hasBrowserControllableWorkspaceTargets: false,
        hasDelegableWorkspaceTargets: false,
        hasMobileController: false,
      },
    );

    expect(filtered).toBeUndefined();
  });

  it('preserves runtime-available external workspace tool selections', () => {
    const filtered = filterRuntimeAvailableToolNames(
      ['workspace_launch_browser', 'workspace_delegate_task'],
      {
        hasWorkspaceTargets: true,
        hasBrowserControllableWorkspaceTargets: true,
        hasDelegableWorkspaceTargets: true,
        hasMobileController: false,
      },
    );

    expect(filtered).toEqual(['workspace_launch_browser', 'workspace_delegate_task']);
  });

  it('pins an admitted mobile controller into the exact session tool surface', () => {
    const resolved = resolveRuntimeExplicitToolSurfaceToolNames(['request_clarification'], {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: true,
    });

    expect(resolved).toEqual(['request_clarification', 'mobile_ui_action']);
  });

  it('does not advertise mobile authority when no controller is admitted', () => {
    const resolved = resolveRuntimeExplicitToolSurfaceToolNames(undefined, {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    });

    expect(resolved).toBeUndefined();
  });
});

describe('contract-declared runtime requirements', () => {
  // Availability used to be a hardcoded chain of tool-name comparisons, so any tool it
  // did not name was advertised unconditionally. web_search was offered on every turn
  // with no provider configured, spending a model round-trip on a call that could only
  // fail. Gating is now derived from what each tool declares about itself.
  const SATISFIED: RuntimeToolAvailabilityContext = {
    hasWorkspaceTargets: true,
    hasBrowserControllableWorkspaceTargets: true,
    hasDelegableWorkspaceTargets: true,
    hasMobileController: true,
    hasWebSearchProvider: true,
  };
  const UNSATISFIED: RuntimeToolAvailabilityContext = {
    hasWorkspaceTargets: false,
    hasBrowserControllableWorkspaceTargets: false,
    hasDelegableWorkspaceTargets: false,
    hasMobileController: false,
    hasWebSearchProvider: false,
  };

  it('hides web_search when no provider is configured', () => {
    expect(isToolRuntimeAvailable('web_search', UNSATISFIED)).toBe(false);
  });

  it('offers web_search once a provider is configured', () => {
    expect(isToolRuntimeAvailable('web_search', SATISFIED)).toBe(true);
  });

  it('gates every tool that declares a requirement', () => {
    const gated = ['workspace_status', 'workspace_launch_browser', 'workspace_delegate_task'];
    for (const toolName of gated) {
      expect(resolveToolRuntimeRequirements(toolName).length).toBeGreaterThan(0);
      expect(isToolRuntimeAvailable(toolName, UNSATISFIED)).toBe(false);
      expect(isToolRuntimeAvailable(toolName, SATISFIED)).toBe(true);
    }
  });

  it('leaves a tool that declares nothing unconditionally available', () => {
    expect(resolveToolRuntimeRequirements('write_file')).toEqual([]);
    expect(isToolRuntimeAvailable('write_file', UNSATISFIED)).toBe(true);
  });

  it('does not hide a tool whose requirement key is unrecognized', () => {
    // A declaration this resolver does not understand must fail open: silently hiding
    // a working capability is worse than one wasted call.
    expect(isToolRuntimeAvailable('write_file', { ...UNSATISFIED } as never)).toBe(true);
  });
});

describe('search provider readiness snapshot', () => {
  afterEach(() => setSearchProviderReadinessSnapshot(true));

  it('starts optimistic so a working capability is never hidden before it is checked', () => {
    setSearchProviderReadinessSnapshot(true);
    expect(isSearchProviderConfiguredSnapshot()).toBe(true);
  });

  it('reflects an unconfigured provider once probed', () => {
    setSearchProviderReadinessSnapshot(false);
    expect(isSearchProviderConfiguredSnapshot()).toBe(false);
  });
});
