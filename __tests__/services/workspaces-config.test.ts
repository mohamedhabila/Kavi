import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
} from '../../src/services/workspaces/config';

describe('workspace config helpers', () => {
  it('falls back to the workspace root basename when the explicit name is blank', () => {
    expect(
      getWorkspaceTargetDisplayName({
        name: '   ',
        rootPath: '/Users/username/project-root',
        provider: 'code-server',
      }),
    ).toBe('project-root');
  });

  it('falls back to the provider label when no name or root path is available', () => {
    expect(
      getWorkspaceTargetDisplayName({
        name: '',
        rootPath: '',
        provider: 'cursor',
      }),
    ).toBe('Cursor');
  });

  it('drops linked browser and SSH ids that no longer exist', () => {
    expect(
      normalizeWorkspaceTargetLinks(
        {
          id: 'ws-1',
          name: 'Repo',
          rootPath: '/workspace/repo',
          provider: 'cursor',
          browserProviderId: 'missing-browser',
          sshTargetId: 'missing-ssh',
          enabled: true,
        },
        {
          browserProviders: [
            {
              id: 'browser-1',
              name: 'Browser',
              provider: 'browserbase',
              baseUrl: 'https://api.browserbase.com',
              authMode: 'api-key-header',
              projectId: 'proj_123',
              enabled: true,
            },
          ],
          sshTargets: [
            {
              id: 'ssh-1',
              name: 'Host',
              host: 'ssh.example.com',
              port: 22,
              username: 'developer',
              enabled: true,
            },
          ],
        },
      ),
    ).toEqual(
      expect.objectContaining({
        browserProviderId: undefined,
        sshTargetId: undefined,
      }),
    );
  });
});
