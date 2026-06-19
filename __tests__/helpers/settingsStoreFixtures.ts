import { createDefaultSettingsDataState } from '../../src/store/settingsStoreTypes';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../src/types/remote';
import type { LlmProviderConfig } from '../../src/types/provider';

export const makeProvider = (
  overrides: Partial<LlmProviderConfig> = {},
): LlmProviderConfig => ({
  id: 'test-provider',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com/v1',
  apiKey: '',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

export const makeMcpServer = (
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig => ({
  id: 'test-mcp',
  name: 'Test MCP',
  url: 'https://mcp.test.com',
  enabled: true,
  tools: [],
  allowedTools: [],
  ...overrides,
});

export const makeSshTarget = (
  overrides: Partial<SshTargetConfig> = {},
): SshTargetConfig => ({
  id: 'ssh-1',
  name: 'Build box',
  host: 'ssh.example.com',
  port: 22,
  username: 'developer',
  enabled: true,
  ...overrides,
});

export const makeWorkspaceTarget = (
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig => ({
  id: 'workspace-1',
  name: 'Main repo',
  rootPath: '/workspace/project',
  configRoots: ['/workspace/.config'],
  enabled: true,
  ...overrides,
});

export const makeBrowserProvider = (
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig => ({
  id: 'browser-1',
  name: 'Browserbase',
  provider: 'browserbase',
  baseUrl: 'https://api.browserbase.com',
  authMode: 'api-key-header',
  projectId: 'bb_project_123',
  enabled: true,
  ...overrides,
});

export const makeExpoAccount = (
  overrides: Partial<ExpoAccountConfig> = {},
): ExpoAccountConfig => ({
  id: 'expo-account-1',
  name: 'Expo Production',
  owner: 'kavi',
  accountType: 'personal',
  enabled: true,
  ...overrides,
});

export const makeExpoProject = (
  overrides: Partial<ExpoProjectConfig> = {},
): ExpoProjectConfig => ({
  id: 'expo-project-1',
  name: 'Kavi Mobile',
  accountId: 'expo-account-1',
  owner: 'kavi',
  slug: 'openkavi-app',
  enabled: true,
  mode: 'eas-workflow',
  defaultBuildProfile: 'production',
  defaultUpdateBranch: 'production',
  updateChannel: 'production',
  platforms: ['android', 'ios'],
  ...overrides,
});

export function resetSettingsStore(): void {
  useSettingsStore.setState(createDefaultSettingsDataState());
}
