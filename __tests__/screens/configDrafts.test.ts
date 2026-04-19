import {
  formatPathList,
  getExpoProjectPlatforms,
  parsePathList,
  prepareBrowserDraft,
  prepareExpoProjectDraft,
  prepareMcpServerDraft,
  prepareSshDraft,
  toggleExpoProjectPlatform,
} from '../../src/screens/configDrafts';

describe('configDrafts helpers', () => {
  it('parses and formats config root lists consistently', () => {
    const parsed = parsePathList(' ~/code ,\n~/dotfiles\n, /tmp/work ');

    expect(parsed).toEqual(['~/code', '~/dotfiles', '/tmp/work']);
    expect(formatPathList(parsed)).toBe('~/code\n~/dotfiles\n/tmp/work');
  });

  it('prepares browser drafts with provider-specific auth defaults', () => {
    const prepared = prepareBrowserDraft({
      id: 'browser-1',
      name: 'Steel',
      provider: 'steel-dev',
      baseUrl: 'https://steel.dev',
      enabled: true,
    } as any);

    expect(prepared.authMode).toBe('query-token');
    expect(prepared.queryTokenParam).toBe('token');
  });

  it('normalizes ssh drafts for editing', () => {
    const prepared = prepareSshDraft({
      id: 'ssh-1',
      name: 'Prod',
      host: 'example.com',
      port: 2222,
      username: 'deploy',
      authMode: undefined,
      ptyType: undefined,
      hostKeyPolicy: undefined,
      trustedHostFingerprint: '  aa:bb  ',
      enabled: true,
    } as any);

    expect(prepared.authMode).toBe('password');
    expect(prepared.ptyType).toBe('xterm');
    expect(prepared.hostKeyPolicy).toBe('trust-on-first-use');
    expect(prepared.trustedHostFingerprint).toBe('aa:bb');
  });

  it('fills Expo project editor defaults and platform fallback', () => {
    const prepared = prepareExpoProjectDraft({
      id: 'expo-1',
      name: 'Mobile',
      accountId: 'account-1',
      owner: 'kavi',
      slug: 'mobile',
      enabled: true,
    } as any);

    expect(prepared.mode).toBe('eas-workflow');
    expect(prepared.defaultBuildProfile).toBe('production');
    expect(prepared.platforms).toEqual(['android', 'ios', 'web']);
    expect(getExpoProjectPlatforms(undefined)).toEqual(['android', 'ios', 'web']);
  });

  it('toggles Expo platforms from the shared fallback set', () => {
    expect(toggleExpoProjectPlatform(undefined, 'web')).toEqual(['android', 'ios']);
    expect(toggleExpoProjectPlatform(['android', 'ios'], 'web')).toEqual(['android', 'ios', 'web']);
  });

  it('prepares MCP drafts with defaults for edit flows', () => {
    const prepared = prepareMcpServerDraft(
      {
        id: 'mcp-1',
        name: 'Registry',
        url: 'https://mcp.example.com',
        enabled: true,
      } as any,
      { defaultTimeoutMs: 20000 },
    );

    expect(prepared.transport).toBe('auto');
    expect(prepared.timeoutMs).toBe(20000);
    expect(prepared.headers).toEqual({});
  });
});
