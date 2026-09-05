import {
  getRuntimeToolAvailabilityContext,
  hasBrowserControllableWorkspaceTargets,
  hasDelegableWorkspaceTargets,
  filterRuntimeAvailableToolNames,
  filterToolsByRuntimeAvailability,
  isToolRuntimeAvailable,
  resolveRuntimeExplicitToolSurfaceToolNames,
  setSecretConfiguredSnapshot,
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
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: true,
      hasConfiguredSecret: () => false,
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
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: true,
      hasConfiguredSecret: () => false,
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
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: true,
      hasConfiguredSecret: () => false,
    });

    expect(filtered.map((tool) => tool.name)).toEqual([
      'read_file',
      'workspace_launch_browser',
      'workspace_delegate_task',
    ]);
  });

  it('hides the workspace control tools when developer mode is off even with targets configured', () => {
    const tools = [
      makeTool('workspace_status'),
      makeTool('workspace_launch_browser'),
      makeTool('workspace_delegate_task'),
    ];

    const filtered = filterToolsByRuntimeAvailability(tools, {
      hasWorkspaceTargets: true,
      hasBrowserControllableWorkspaceTargets: true,
      hasDelegableWorkspaceTargets: true,
      hasMobileController: false,
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: false,
      hasConfiguredSecret: () => false,
    });

    expect(filtered).toEqual([]);
  });

  it('filters unavailable external workspace tools out of explicit tool selections', () => {
    const filtered = filterRuntimeAvailableToolNames(
      ['workspace_launch_browser', 'workspace_delegate_task', 'workspace_launch_browser'],
      {
        hasWorkspaceTargets: false,
        hasBrowserControllableWorkspaceTargets: false,
        hasDelegableWorkspaceTargets: false,
        hasMobileController: false,
        hasWebSearchProvider: false,
        hasDeveloperModeEnabled: true,
        hasConfiguredSecret: () => false,
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
        hasWebSearchProvider: false,
        hasDeveloperModeEnabled: true,
        hasConfiguredSecret: () => false,
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
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: true,
      hasConfiguredSecret: () => false,
    });

    expect(resolved).toEqual(['request_clarification', 'mobile_ui_action']);
  });

  it('does not advertise mobile authority when no controller is admitted', () => {
    const resolved = resolveRuntimeExplicitToolSurfaceToolNames(undefined, {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
      hasWebSearchProvider: false,
      hasDeveloperModeEnabled: true,
      hasConfiguredSecret: () => false,
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
    hasDeveloperModeEnabled: true,
    hasConfiguredSecret: () => true,
  };
  const UNSATISFIED: RuntimeToolAvailabilityContext = {
    hasWorkspaceTargets: false,
    hasBrowserControllableWorkspaceTargets: false,
    hasDelegableWorkspaceTargets: false,
    hasMobileController: false,
    hasWebSearchProvider: false,
    hasDeveloperModeEnabled: false,
    hasConfiguredSecret: () => false,
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

  it('gates every developer-surface tool behind developer_mode', () => {
    const developerGated = [
      'ssh_exec',
      'ssh_background_job_status',
      'ssh_background_job_wait',
      'ssh_fs',
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_build',
      'expo_eas_update',
      'expo_eas_submit',
      'expo_eas_deploy_web',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
      'browser_launch',
      'browser_navigate',
      'browser_click',
      'javascript',
      'python',
      'mobile_ui_action',
      'skill__github__repos',
      'skill__github__commit_files',
    ];
    for (const toolName of developerGated) {
      expect(resolveToolRuntimeRequirements(toolName)).toContain('developer_mode');
      expect(
        isToolRuntimeAvailable(toolName, { ...SATISFIED, hasDeveloperModeEnabled: false }),
      ).toBe(false);
      expect(
        isToolRuntimeAvailable(toolName, { ...SATISFIED, hasDeveloperModeEnabled: true }),
      ).toBe(true);
    }
  });

  it('leaves core file and workflow tools available regardless of developer mode', () => {
    const undisturbed = ['read_file', 'write_file', 'list_files'];
    for (const toolName of undisturbed) {
      expect(resolveToolRuntimeRequirements(toolName)).not.toContain('developer_mode');
      expect(
        isToolRuntimeAvailable(toolName, { ...UNSATISFIED, hasDeveloperModeEnabled: false }),
      ).toBe(true);
    }
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

describe('secret-gated code-owned service skill tools', () => {
  // A code-owned service skill that calls a keyed third-party API (OpenWeather, Alpha
  // Vantage, GitHub) must never be advertised before its secret is configured — the
  // model otherwise picks it, spends a round-trip on a call that can only fail, and
  // ends by telling the user the capability "needs setup" for a request a keyless
  // public source could have answered directly.
  const BASE: RuntimeToolAvailabilityContext = {
    hasWorkspaceTargets: false,
    hasBrowserControllableWorkspaceTargets: false,
    hasDelegableWorkspaceTargets: false,
    hasMobileController: false,
    hasWebSearchProvider: false,
    hasDeveloperModeEnabled: true,
    hasConfiguredSecret: () => false,
  };

  it('hides both weather tools without OPENWEATHER_API_KEY and offers them once it is configured', () => {
    for (const toolName of ['skill__weather__current', 'skill__weather__forecast']) {
      expect(resolveToolRuntimeRequirements(toolName)).toEqual(['secret:OPENWEATHER_API_KEY']);
      expect(isToolRuntimeAvailable(toolName, BASE)).toBe(false);
      expect(
        isToolRuntimeAvailable(toolName, {
          ...BASE,
          hasConfiguredSecret: (name) => name === 'OPENWEATHER_API_KEY',
        }),
      ).toBe(true);
    }
  });

  it('hides the keyed finance tools without ALPHA_VANTAGE_API_KEY but leaves crypto_price unconditional', () => {
    for (const toolName of ['skill__finance__stock_quote', 'skill__finance__exchange_rate']) {
      expect(resolveToolRuntimeRequirements(toolName)).toEqual(['secret:ALPHA_VANTAGE_API_KEY']);
      expect(isToolRuntimeAvailable(toolName, BASE)).toBe(false);
      expect(
        isToolRuntimeAvailable(toolName, {
          ...BASE,
          hasConfiguredSecret: (name) => name === 'ALPHA_VANTAGE_API_KEY',
        }),
      ).toBe(true);
    }

    expect(resolveToolRuntimeRequirements('skill__finance__crypto_price')).toEqual([]);
    expect(isToolRuntimeAvailable('skill__finance__crypto_price', BASE)).toBe(true);
  });

  it('hides GitHub tools without GITHUB_TOKEN even with developer mode on', () => {
    for (const toolName of ['skill__github__repos', 'skill__github__commit_files']) {
      expect(resolveToolRuntimeRequirements(toolName)).toEqual(
        expect.arrayContaining(['developer_mode', 'secret:GITHUB_TOKEN']),
      );
      expect(isToolRuntimeAvailable(toolName, BASE)).toBe(false);
      expect(
        isToolRuntimeAvailable(toolName, {
          ...BASE,
          hasConfiguredSecret: (name) => name === 'GITHUB_TOKEN',
        }),
      ).toBe(true);
    }
  });

  it('leaves keyless service skill tools unconditionally available', () => {
    for (const toolName of [
      'skill__productivity__timer',
      'skill__productivity__unit_convert',
      'skill__productivity__calculate',
      'skill__knowledge__wikipedia_summary',
      'skill__knowledge__define_word',
      'skill__media__generate_qr',
    ]) {
      expect(resolveToolRuntimeRequirements(toolName)).toEqual([]);
      expect(isToolRuntimeAvailable(toolName, BASE)).toBe(true);
    }
  });
});

describe('hasConfiguredSecret snapshot on the real context', () => {
  afterEach(() => {
    setSecretConfiguredSnapshot('OPENWEATHER_API_KEY', false);
  });

  it('treats an unprobed secret as unconfigured, and reflects a settled snapshot immediately', () => {
    const context = getRuntimeToolAvailabilityContext();

    // Unknown until probed counts as unavailable — never a false "configured".
    expect(context.hasConfiguredSecret('KAVI_TEST_UNPROBED_SECRET')).toBe(false);

    setSecretConfiguredSnapshot('OPENWEATHER_API_KEY', true);
    expect(context.hasConfiguredSecret('OPENWEATHER_API_KEY')).toBe(true);

    setSecretConfiguredSnapshot('OPENWEATHER_API_KEY', false);
    expect(context.hasConfiguredSecret('OPENWEATHER_API_KEY')).toBe(false);
  });
});
