// ---------------------------------------------------------------------------
// Settings Import/Export — tests
// ---------------------------------------------------------------------------

// Mock settings store
const mockReplaceAllSettings = jest.fn();
const mockSetLocale = jest.fn().mockResolvedValue(undefined);
const mockSettingsState = {
  providers: [
    {
      id: 'provider-1',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secret',
      apiKeyRef: 'provider_key_provider-1',
      model: 'gpt-5.4',
      enabled: true,
    },
  ],
  mcpServers: [
    {
      id: 'mcp-1',
      name: 'Test MCP',
      url: 'https://mcp.test',
      token: 'secret-token',
      tokenRef: 'mcp_token_mcp-1',
      headers: { Authorization: 'Bearer secret-token', 'X-Env': 'prod' },
      oauth: { clientId: 'client-id', clientSecretRef: 'mcp_oauth_client_secret_mcp-1' },
      enabled: true,
      tools: [],
      allowedTools: [],
    },
  ],
  sshTargets: [
    {
      id: 'ssh-1',
      name: 'Build box',
      host: 'ssh.example.com',
      port: 22,
      username: 'developer',
      passwordRef: 'ssh_password_ssh-1',
      privateKeyRef: 'ssh_private_key_ssh-1',
      passphraseRef: 'ssh_passphrase_ssh-1',
      enabled: true,
    },
  ],
  workspaceTargets: [
    {
      id: 'workspace-1',
      name: 'Main repo',
      rootPath: '/Users/username/project',
      accessTokenRef: 'workspace_access_token_workspace-1',
      enabled: true,
    },
  ],
  browserProviders: [
    {
      id: 'browser-1',
      name: 'Browserbase',
      apiKeyRef: 'browser_provider_api_key_browser-1',
      enabled: true,
    },
  ],
  expoAccounts: [
    {
      id: 'expo-account-1',
      name: 'Expo',
      owner: 'developer',
      tokenRef: 'expo_account_token_expo-account-1',
      enabled: true,
    },
  ],
  expoProjects: [
    {
      id: 'expo-project-1',
      name: 'Kavi',
      accountId: 'expo-account-1',
      owner: 'developer',
      slug: 'kavi',
      mode: 'eas-workflow',
      githubTokenRef: 'GITHUB_TOKEN',
      enabled: true,
    },
  ],
  activeProviderId: null,
  activeModel: null,
  theme: 'dark',
  systemPrompt: '',
  lastUsedModel: { providerId: 'provider-1', model: 'gpt-4o' },
  thinkingLevel: 'high',
  locale: 'fr',
  webSearchProvider: 'gemini',
  linkUnderstandingEnabled: true,
  mediaUnderstandingEnabled: false,
  maxLinks: 5,
  defaultConversationMode: 'agentic',
  replaceAllSettings: mockReplaceAllSettings,
};

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../../src/i18n/manager', () => ({
  i18n: {
    setLocale: (...args: any[]) => mockSetLocale(...args),
  },
}));

// Mock skills manager
jest.mock('../../src/services/skills/manager', () => ({
  useSkillsStore: {
    getState: () => ({
      entries: [],
      addEntry: jest.fn(),
    }),
  },
  getSkillToolDefinitions: jest.fn().mockReturnValue([]),
}));

// Mock hooks loader
jest.mock('../../src/services/hooks/loader', () => ({
  getLoadedHooks: jest.fn().mockReturnValue([]),
}));

import {
  exportSettings,
  exportSettingsToJson,
  importSettings,
  validateExportFile,
} from '../../src/services/settings/importExport';

describe('Settings Import/Export', () => {
  beforeEach(() => {
    mockReplaceAllSettings.mockClear();
    mockSetLocale.mockClear();
  });

  describe('exportSettings', () => {
    it('returns settings object', () => {
      const settings = exportSettings();
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty('version');
      expect(settings).toHaveProperty('exportedAt');
    });

    it('includes settings field', () => {
      const settings = exportSettings();
      expect(settings).toHaveProperty('settings');
    });

    it('strips secure refs and records omitted-sensitive warnings', () => {
      const exported = exportSettings();

      expect(exported.settings.providers?.[0].apiKey).toBe('');
      expect(exported.settings.providers?.[0].apiKeyRef).toBeUndefined();

      expect(exported.settings.mcpServers?.[0].token).toBe('');
      expect(exported.settings.mcpServers?.[0].tokenRef).toBeUndefined();
      expect(exported.settings.mcpServers?.[0].headers).toEqual({ Authorization: '', 'X-Env': '' });
      expect(exported.settings.mcpServers?.[0].oauth?.clientSecretRef).toBeUndefined();

      expect(exported.settings.sshTargets?.[0].passwordRef).toBeUndefined();
      expect(exported.settings.workspaceTargets?.[0].accessTokenRef).toBeUndefined();
      expect(exported.settings.browserProviders?.[0].apiKeyRef).toBeUndefined();
      expect(exported.settings.expoAccounts?.[0].tokenRef).toBeUndefined();
      expect(exported.settings.expoProjects?.[0].githubTokenRef).toBeUndefined();

      expect(exported.omittedSensitiveData).toEqual(
        expect.arrayContaining([
          expect.stringContaining('SSH credentials'),
          expect.stringContaining('Workspace access tokens'),
          expect.stringContaining('Browser provider API keys'),
          expect.stringContaining('Expo account tokens'),
          expect.stringContaining('Expo project GitHub tokens'),
        ]),
      );
    });
  });

  describe('exportSettingsToJson', () => {
    it('returns valid JSON string', () => {
      const json = exportSettingsToJson();
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('version');
    });
  });

  describe('validateExportFile', () => {
    it('validates correct export file', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        settings: {},
      });
      const result = validateExportFile(json);
      expect(result.valid).toBe(true);
    });

    it('rejects missing version', () => {
      const json = JSON.stringify({ exportedAt: Date.now(), settings: {} });
      const result = validateExportFile(json);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid JSON', () => {
      const result = validateExportFile('not json{{{');
      expect(result.valid).toBe(false);
    });

    it('rejects missing settings field', () => {
      const json = JSON.stringify({ version: 1, exportedAt: Date.now() });
      const result = validateExportFile(json);
      expect(result.valid).toBe(false);
    });
  });

  describe('importSettings', () => {
    it('imports valid settings object', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          systemPrompt: 'Custom prompt',
        },
      } as any);
      expect(result.success).toBe(true);
    });

    it('imports valid settings string', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          systemPrompt: 'Custom prompt',
        },
      });
      const result = importSettings(json);
      expect(result.success).toBe(true);
    });

    it('rejects null input', () => {
      const result = importSettings(null as any);
      expect(result.success).toBe(false);
    });

    it('rejects unsupported version', () => {
      const result = importSettings({
        version: 999,
        exportedAt: Date.now(),
        settings: {},
      } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported');
    });

    it('imports providers with API key warning', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          providers: [{ id: 'p1', name: 'Test', type: 'openai', apiKey: '' }],
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.providers).toBe(1);
      expect(result.warnings.some((w) => w.includes('API keys'))).toBe(true);
    });

    it('imports MCP servers with token warning', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          mcpServers: [{ url: 'http://test', token: '' }],
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.mcpServers).toBe(1);
      expect(result.warnings.some((w) => w.includes('tokens'))).toBe(true);
    });

    it('strips secure refs from imported targets and preserves warning metadata', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        omittedSensitiveData: [
          "SSH credentials were not exported — you'll need to re-enter passwords or private keys",
        ],
        settings: {
          providers: [
            {
              id: 'provider-2',
              name: 'Imported provider',
              baseUrl: 'https://api.example.com/v1',
              apiKey: 'secret',
              apiKeyRef: 'provider_key_provider-2',
              model: 'gpt-5-mini',
              enabled: true,
            },
          ],
          mcpServers: [
            {
              id: 'mcp-2',
              name: 'Imported MCP',
              url: 'https://mcp.example.com',
              token: 'secret-token',
              tokenRef: 'mcp_token_mcp-2',
              headers: { Authorization: 'Bearer secret-token' },
              oauth: { clientId: 'client', clientSecretRef: 'mcp_oauth_client_secret_mcp-2' },
              enabled: true,
              tools: [],
              allowedTools: [],
            },
          ],
          sshTargets: [
            {
              id: 'ssh-2',
              name: 'Imported SSH',
              host: 'ssh.example.com',
              port: 22,
              username: 'developer',
              passwordRef: 'ssh_password_ssh-2',
              enabled: true,
            },
          ],
          workspaceTargets: [
            {
              id: 'workspace-2',
              name: 'Imported workspace',
              rootPath: '/repo',
              accessTokenRef: 'workspace_access_token_workspace-2',
              enabled: true,
            },
          ],
          browserProviders: [
            {
              id: 'browser-2',
              name: 'Imported browser',
              apiKeyRef: 'browser_provider_api_key_browser-2',
              enabled: true,
            },
          ],
          expoAccounts: [
            {
              id: 'expo-account-2',
              name: 'Imported Expo',
              owner: 'developer',
              tokenRef: 'expo_account_token_expo-account-2',
              enabled: true,
            },
          ],
          expoProjects: [
            {
              id: 'expo-project-2',
              name: 'Imported project',
              accountId: 'expo-account-2',
              owner: 'developer',
              slug: 'kavi',
              mode: 'eas-workflow',
              githubTokenRef: 'GITHUB_TOKEN',
              enabled: true,
            },
          ],
        },
      } as any);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('API keys'),
          expect.stringContaining('MCP tokens'),
          expect.stringContaining('SSH credentials'),
        ]),
      );

      const arg = mockReplaceAllSettings.mock.calls[0][0];
      expect(arg.providers[0].apiKey).toBe('');
      expect(arg.providers[0].apiKeyRef).toBeUndefined();
      expect(arg.mcpServers[0].token).toBe('');
      expect(arg.mcpServers[0].tokenRef).toBeUndefined();
      expect(arg.mcpServers[0].headers).toEqual({ Authorization: '' });
      expect(arg.mcpServers[0].oauth.clientSecretRef).toBeUndefined();
      expect(arg.sshTargets[0].passwordRef).toBeUndefined();
      expect(arg.workspaceTargets[0].accessTokenRef).toBeUndefined();
      expect(arg.browserProviders[0].apiKeyRef).toBeUndefined();
      expect(arg.expoAccounts[0].tokenRef).toBeUndefined();
      expect(arg.expoProjects[0].githubTokenRef).toBeUndefined();
    });

    it('imports skills', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {},
        skills: [{ metadata: { name: 'Test Skill' }, source: 'package' }],
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.skills).toBe(1);
    });

    it('imports hooks with warning', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {},
        hooks: [{ id: 'h1', name: 'Hook', event: 'test' }],
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.hooks).toBe(1);
      expect(result.warnings.some((w) => w.includes('Hooks'))).toBe(true);
    });

    it('imports theme and systemPrompt', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          theme: 'light',
          systemPrompt: 'Custom prompt',
          activeProviderId: 'p1',
          activeModel: 'gpt-5.4',
        },
      } as any);
      expect(result.success).toBe(true);
    });
  });

  describe('validateExportFile', () => {
    it('rejects missing exportedAt', () => {
      const json = JSON.stringify({ version: 1, settings: {} });
      const result = validateExportFile(json);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exportedAt');
    });
  });

  describe('importSettings — array validation (Phase 26)', () => {
    it('ignores non-array providers', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          providers: 'not-an-array',
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.providers).toBe(0);
    });

    it('ignores non-array mcpServers', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          mcpServers: { url: 'http://evil' },
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.mcpServers).toBe(0);
    });

    it('ignores non-array skills', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {},
        skills: 'not-an-array',
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.skills).toBe(0);
    });

    it('ignores non-array hooks', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {},
        hooks: { id: 'h1' },
      } as any);
      expect(result.success).toBe(true);
      expect(result.imported.hooks).toBe(0);
    });

    it('ignores non-array sshTargets', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          sshTargets: 'string',
        },
      } as any);
      expect(result.success).toBe(true);
    });
  });

  describe('preference fields round-trip', () => {
    it('exportSettings includes all preference fields', () => {
      const exported = exportSettings();
      const s = exported.settings as any;
      expect(s.lastUsedModel).toEqual({ providerId: 'provider-1', model: 'gpt-4o' });
      expect(s.thinkingLevel).toBe('high');
      expect(s.locale).toBe('fr');
      expect(s.webSearchProvider).toBe('gemini');
      expect(s.linkUnderstandingEnabled).toBe(true);
      expect(s.mediaUnderstandingEnabled).toBe(false);
      expect(s.maxLinks).toBe(5);
      expect(s.defaultConversationMode).toBe('agentic');
    });

    it('importSettings forwards preference fields to replaceAllSettings', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          lastUsedModel: { providerId: 'provider-2', model: 'claude-4' },
          thinkingLevel: 'minimal',
          locale: 'ja',
          webSearchProvider: 'brave',
          linkUnderstandingEnabled: false,
          mediaUnderstandingEnabled: true,
          maxLinks: 10,
          defaultConversationMode: 'direct',
        },
      } as any);
      expect(result.success).toBe(true);
      expect(mockReplaceAllSettings).toHaveBeenCalledTimes(1);
      const arg = mockReplaceAllSettings.mock.calls[0][0];
      expect(arg.lastUsedModel).toEqual({ providerId: 'provider-2', model: 'claude-4' });
      expect(arg.thinkingLevel).toBe('minimal');
      expect(arg.locale).toBe('ja');
      expect(arg.webSearchProvider).toBe('brave');
      expect(arg.linkUnderstandingEnabled).toBe(false);
      expect(arg.mediaUnderstandingEnabled).toBe(true);
      expect(arg.maxLinks).toBe(10);
      expect(arg.defaultConversationMode).toBe('direct');
      expect(mockSetLocale).toHaveBeenCalledWith('ja');
    });

    it('importSettings preserves explicit null selections', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          activeProviderId: null,
          activeModel: null,
          lastUsedModel: null,
        },
      } as any);

      expect(result.success).toBe(true);
      const arg = mockReplaceAllSettings.mock.calls[0][0];
      expect(arg).toHaveProperty('activeProviderId', null);
      expect(arg).toHaveProperty('activeModel', null);
      expect(arg).toHaveProperty('lastUsedModel', null);
    });

    it('importSettings omits undefined preference fields', () => {
      const result = importSettings({
        version: 1,
        exportedAt: Date.now(),
        settings: {
          theme: 'light',
        },
      } as any);
      expect(result.success).toBe(true);
      const arg = mockReplaceAllSettings.mock.calls[0][0];
      expect(arg).not.toHaveProperty('lastUsedModel');
      expect(arg).not.toHaveProperty('thinkingLevel');
      expect(arg).not.toHaveProperty('defaultConversationMode');
    });
  });
});
