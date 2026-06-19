import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../src/types/remote';
import {
  createBrowserProvider,
  createExpoAccount,
  createExpoProject,
  createMcpServer,
  createSshTarget,
  createWorkspaceTarget,
} from './remoteConfigFixtures';

export type RemoteConfigCollections = {
  workspaceTargets: WorkspaceTargetConfig[];
  sshTargets: SshTargetConfig[];
  browserProviders: BrowserProviderConfig[];
  mcpServers: McpServerConfig[];
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
};

export function createDefaultRemoteConfigCollections(
  overrides: Partial<RemoteConfigCollections> = {},
): RemoteConfigCollections {
  return {
    workspaceTargets: [createWorkspaceTarget()],
    sshTargets: [createSshTarget()],
    browserProviders: [createBrowserProvider()],
    mcpServers: [createMcpServer()],
    expoAccounts: [createExpoAccount()],
    expoProjects: [createExpoProject()],
    ...overrides,
  };
}

export function createEmptyRemoteConfigCollections(
  overrides: Partial<RemoteConfigCollections> = {},
): RemoteConfigCollections {
  return {
    workspaceTargets: [],
    sshTargets: [],
    browserProviders: [],
    mcpServers: [],
    expoAccounts: [],
    expoProjects: [],
    ...overrides,
  };
}

export function assignRemoteConfigCollections(
  target: Partial<RemoteConfigCollections>,
  next: RemoteConfigCollections,
) {
  Object.assign(target, next);
}
