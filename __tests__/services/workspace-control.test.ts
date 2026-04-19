import {
  buildWorkspaceDelegationCommand,
  delegateWorkspaceTask,
  getWorkspaceTargetControlStatus,
  launchWorkspaceBrowserSession,
} from '../../src/services/workspaces/control';

const mockBrowserNavigate = jest.fn();
const mockLaunchBrowserLiveSession = jest.fn();
const mockStopBrowserLiveSession = jest.fn();
const mockExecuteSshCommand = jest.fn();
const mockGetSecure = jest.fn();

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ browserProviders: [], sshTargets: [] }),
  },
}));

jest.mock('../../src/services/browser/automation', () => ({
  browserNavigate: (...args: any[]) => mockBrowserNavigate(...args),
}));

jest.mock('../../src/services/browser/jobs', () => ({
  launchBrowserLiveSession: (...args: any[]) => mockLaunchBrowserLiveSession(...args),
  stopBrowserLiveSession: (...args: any[]) => mockStopBrowserLiveSession(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  executeSshCommand: (...args: any[]) => mockExecuteSshCommand(...args),
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(target?.enabled),
    reason: target?.enabled ? 'ready' : 'disabled',
  }),
}));

const browserProviders = [
  {
    id: 'browser-1',
    name: 'Primary Browserbase',
    provider: 'browserbase',
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header',
    apiKeyRef: 'browser_provider_api_key_browser-1',
    projectId: 'proj_123',
    enabled: true,
  },
];

const sshTargets = [
  {
    id: 'ssh-1',
    name: 'Host machine',
    host: 'ssh.example.com',
    port: 22,
    username: 'developer',
    authMode: 'password',
    passwordRef: 'ssh_password_1',
    enabled: true,
  },
];

describe('workspace control service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue(null);
    mockLaunchBrowserLiveSession.mockResolvedValue('browser-session-1');
    mockBrowserNavigate.mockResolvedValue({
      ok: true,
      targetId: 'page-1',
      url: 'https://code.example.com/?folder=%2Fworkspace%2Frepo',
    });
    mockExecuteSshCommand.mockResolvedValue('completed');
  });

  it('reports ready Cursor CLI delegation when an SSH target is linked', () => {
    const status = getWorkspaceTargetControlStatus(
      {
        id: 'ws-1',
        name: 'Cursor repo',
        rootPath: '/workspace/repo',
        provider: 'cursor',
        sshTargetId: 'ssh-1',
        enabled: true,
      },
      { browserProviders, sshTargets },
    );

    expect(status.aiTaskReady).toBe(true);
    expect(status.aiTaskCommandSource).toBe('cursor-default');
    expect(status.summary).toContain('AI handoff');
  });

  it('launches a workspace target into a browser session and navigates to its URL', async () => {
    const result = await launchWorkspaceBrowserSession(
      {
        id: 'ws-1',
        name: 'Main repo',
        rootPath: '/workspace/repo',
        provider: 'code-server',
        browserProviderId: 'browser-1',
        baseUrl: 'https://code.example.com',
        authMode: 'none',
        enabled: true,
      },
      { settings: { browserProviders, sshTargets } },
    );

    expect(mockLaunchBrowserLiveSession).toHaveBeenCalledWith(browserProviders[0]);
    expect(mockBrowserNavigate).toHaveBeenCalledWith('browser-session-1', {
      url: 'https://code.example.com/?folder=%2Fworkspace%2Frepo',
    });
    expect(result).toEqual({
      sessionId: 'browser-session-1',
      providerId: 'browser-1',
      url: 'https://code.example.com/?folder=%2Fworkspace%2Frepo',
    });
  });

  it('builds the documented Cursor CLI command by default', () => {
    expect(
      buildWorkspaceDelegationCommand(
        {
          id: 'ws-1',
          name: 'Cursor repo',
          rootPath: '/workspace/repo',
          provider: 'cursor',
          sshTargetId: 'ssh-1',
          enabled: true,
        },
        'Fix the failing test',
        'ask',
      ),
    ).toBe("agent -p 'Fix the failing test' --mode=ask --output-format text");
  });

  it('executes a custom AI delegation command template over SSH', async () => {
    const result = await delegateWorkspaceTask(
      {
        id: 'ws-1',
        name: 'Windsurf repo',
        rootPath: '/workspace/repo',
        provider: 'windsurf',
        sshTargetId: 'ssh-1',
        aiTaskCommandTemplate:
          'my-ide-cli chat --prompt {{prompt}} --mode {{mode}} --repo {{rootPath}}',
        enabled: true,
      },
      'Refactor the auth flow',
      {
        mode: 'plan',
        settings: { browserProviders, sshTargets },
      },
    );

    expect(mockExecuteSshCommand).toHaveBeenCalledWith(
      sshTargets[0],
      "my-ide-cli chat --prompt 'Refactor the auth flow' --mode 'plan' --repo '/workspace/repo'",
      '/workspace/repo',
    );
    expect(result).toEqual({
      targetId: 'ws-1',
      sshTargetId: 'ssh-1',
      providerLabel: 'Windsurf',
      mode: 'plan',
      command:
        "my-ide-cli chat --prompt 'Refactor the auth flow' --mode 'plan' --repo '/workspace/repo'",
      output: 'completed',
    });
  });
});
