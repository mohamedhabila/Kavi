import {
  buildWorkspaceLaunchUrl,
  getWorkspaceTargetCapabilities,
  getWorkspaceTargetReadiness,
  probeWorkspaceTarget,
  resolveWorkspaceTargetLaunch,
} from '../../src/services/workspaces/connector';

const mockGetSecure = jest.fn();

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

describe('workspace connector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue(null);
    (global as any).fetch = jest.fn();
  });

  it('builds a code-server launch URL with folder query', () => {
    expect(
      buildWorkspaceLaunchUrl({
        id: 'ws-1',
        name: 'Repo',
        rootPath: '/workspace/repo',
        baseUrl: 'https://code.example.com/',
        provider: 'code-server',
        enabled: true,
      }),
    ).toBe('https://code.example.com/?folder=%2Fworkspace%2Frepo');
  });

  it('injects query token auth when configured', () => {
    expect(
      buildWorkspaceLaunchUrl(
        {
          id: 'ws-1',
          name: 'Repo',
          rootPath: '/workspace/repo',
          baseUrl: 'https://code.example.com',
          authMode: 'query-token',
          queryTokenParam: 'tkn',
          enabled: true,
        },
        'secret',
      ),
    ).toBe('https://code.example.com/?folder=%2Fworkspace%2Frepo&tkn=secret');
  });

  it('does not force a folder query onto VS Code web-style URLs', () => {
    expect(
      buildWorkspaceLaunchUrl({
        id: 'ws-1',
        name: 'Repo',
        rootPath: '/workspace/repo',
        baseUrl: 'https://vscode.dev/tunnel/devbox/repo',
        provider: 'vscode-tunnel',
        enabled: true,
      }),
    ).toBe('https://vscode.dev/tunnel/devbox/repo');
  });

  it('marks a target unlaunchable when bearer auth has no token configured', () => {
    expect(
      getWorkspaceTargetReadiness({
        id: 'ws-1',
        name: 'Repo',
        rootPath: '/workspace/repo',
        baseUrl: 'https://code.example.com',
        authMode: 'bearer',
        enabled: true,
      }),
    ).toEqual({ launchable: false, reason: 'missing-token' });
  });

  it('reports provider capabilities for browser automation and AI task delegation', () => {
    expect(
      getWorkspaceTargetCapabilities({
        id: 'ws-1',
        name: 'Cursor repo',
        rootPath: '/workspace/repo',
        provider: 'cursor',
        sshTargetId: 'ssh-1',
        enabled: true,
      }),
    ).toEqual({
      fileAccessMode: 'none',
      supportsFileAccess: false,
      supportsBrowserAutomation: false,
      supportsAiTaskDelegation: true,
    });
  });

  it('resolves bearer launch requests with authorization header', async () => {
    mockGetSecure.mockResolvedValue('token-123');

    const request = await resolveWorkspaceTargetLaunch({
      id: 'ws-1',
      name: 'Repo',
      rootPath: '/workspace/repo',
      baseUrl: 'https://code.example.com',
      authMode: 'bearer',
      accessTokenRef: 'workspace_access_token_ws-1',
      enabled: true,
    });

    expect(request).toEqual({
      uri: 'https://code.example.com/?folder=%2Fworkspace%2Frepo',
      headers: { Authorization: 'Bearer token-123' },
      provider: 'code-server',
    });
  });

  it('probes a workspace target with the resolved launch request', async () => {
    mockGetSecure.mockResolvedValue('token-123');
    ((global as any).fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    const result = await probeWorkspaceTarget({
      id: 'ws-1',
      name: 'Repo',
      rootPath: '/workspace/repo',
      baseUrl: 'https://code.example.com',
      authMode: 'bearer',
      accessTokenRef: 'workspace_access_token_ws-1',
      enabled: true,
    });

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://code.example.com/?folder=%2Fworkspace%2Frepo',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Ready (200)');
  });
});
