import { Alert } from 'react-native';

import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../src/types/remote';

export function createWorkspaceTarget(
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig {
  return {
    id: 'ws-1',
    name: 'Main Repo',
    rootPath: '/workspace/repo',
    baseUrl: 'https://code.example.com',
    provider: 'code-server',
    enabled: true,
    ...overrides,
  } as WorkspaceTargetConfig;
}

export function createSshTarget(overrides: Partial<SshTargetConfig> = {}): SshTargetConfig {
  return {
    id: 'ssh-1',
    name: 'Build box',
    host: 'ssh.example.com',
    port: 22,
    username: 'developer',
    authMode: 'password',
    passwordRef: 'ssh_password_ssh-1',
    enabled: true,
    ...overrides,
  } as SshTargetConfig;
}

export function createBrowserProvider(
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig {
  return {
    id: 'browser-1',
    name: 'Primary Browserbase',
    provider: 'browserbase',
    baseUrl: 'https://api.browserbase.com',
    projectId: 'proj_123',
    authMode: 'api-key-header',
    apiKeyRef: 'browser_provider_api_key_browser-1',
    enabled: true,
    ...overrides,
  } as BrowserProviderConfig;
}

export function createMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-1',
    name: 'Tool Server',
    url: 'https://mcp.example.com',
    transport: 'auto',
    enabled: true,
    tools: [],
    allowedTools: [],
    ...overrides,
  } as McpServerConfig;
}

export function createExpoAccount(overrides: Partial<ExpoAccountConfig> = {}): ExpoAccountConfig {
  return {
    id: 'expo-account-1',
    name: 'Expo Prod',
    owner: 'kavi',
    tokenRef: 'expo_account_token_expo-account-1',
    enabled: true,
    ...overrides,
  } as ExpoAccountConfig;
}

export function createExpoProject(overrides: Partial<ExpoProjectConfig> = {}): ExpoProjectConfig {
  return {
    id: 'expo-project-1',
    easProjectId: 'eas-project-1',
    name: 'Kavi',
    accountId: 'expo-account-1',
    owner: 'kavi',
    slug: 'kavi-app',
    enabled: true,
    mode: 'direct-ssh',
    sshTargetId: 'ssh-1',
    projectPath: '/srv/kavi-app',
    defaultBuildProfile: 'production',
    defaultUpdateBranch: 'production',
    updateChannel: 'production',
    platforms: ['android', 'ios', 'web'],
    webUrl: 'https://app.example.com',
    ...overrides,
  } as ExpoProjectConfig;
}

export const confirmDestructiveAlert = () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: any) => {
    const destructive = buttons?.find((button: any) => button.style === 'destructive');
    destructive?.onPress?.();
  });
};
