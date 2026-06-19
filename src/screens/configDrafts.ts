import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../types/remote';
import { generateId } from '../utils/id';

export type ExpoProjectPlatform = 'android' | 'ios' | 'web';

const DEFAULT_EXPO_PROJECT_PLATFORMS: ExpoProjectPlatform[] = ['android', 'ios', 'web'];

export function parsePathList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatPathList(value?: string[]): string {
  return (value || []).join('\n');
}

export function createWorkspaceDraft(
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig {
  return {
    id: generateId(),
    name: '',
    rootPath: '',
    configRoots: [],
    provider: 'code-server',
    baseUrl: '',
    authMode: 'none',
    queryTokenParam: 'token',
    enabled: true,
    ...overrides,
  };
}

export function prepareWorkspaceDraft(target: WorkspaceTargetConfig): WorkspaceTargetConfig {
  const draft = createWorkspaceDraft();

  return {
    ...draft,
    ...target,
    provider: target.provider ?? draft.provider,
    baseUrl: target.baseUrl ?? draft.baseUrl,
    authMode: target.authMode ?? draft.authMode,
    queryTokenParam: target.queryTokenParam ?? draft.queryTokenParam,
    enabled: target.enabled ?? draft.enabled,
  };
}

export function createSshDraft(overrides: Partial<SshTargetConfig> = {}): SshTargetConfig {
  return {
    id: generateId(),
    name: '',
    host: '',
    port: 22,
    username: '',
    remoteRoot: '',
    hostKeyPolicy: 'trust-on-first-use',
    authMode: 'password',
    ptyType: 'xterm',
    enabled: true,
    ...overrides,
  };
}

export function prepareSshDraft(target: SshTargetConfig): SshTargetConfig {
  const draft = createSshDraft();

  return {
    ...draft,
    ...target,
    hostKeyPolicy: target.hostKeyPolicy ?? draft.hostKeyPolicy,
    authMode: target.authMode ?? draft.authMode,
    ptyType: target.ptyType ?? draft.ptyType,
    enabled: target.enabled ?? draft.enabled,
    trustedHostFingerprint: target.trustedHostFingerprint?.trim() || undefined,
  };
}

export function createBrowserDraft(
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig {
  return {
    id: generateId(),
    name: '',
    provider: 'browserbase',
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header',
    queryTokenParam: 'token',
    enabled: true,
    ...overrides,
  };
}

export function prepareBrowserDraft(provider: BrowserProviderConfig): BrowserProviderConfig {
  const draft = createBrowserDraft();

  return {
    ...draft,
    ...provider,
    authMode:
      provider.authMode ?? (provider.provider === 'browserbase' ? 'api-key-header' : 'query-token'),
    queryTokenParam: provider.queryTokenParam ?? draft.queryTokenParam,
    enabled: provider.enabled ?? draft.enabled,
  };
}

export function createExpoAccountDraft(
  overrides: Partial<ExpoAccountConfig> = {},
): ExpoAccountConfig {
  return {
    id: generateId(),
    name: '',
    owner: '',
    accountType: 'personal',
    enabled: true,
    ...overrides,
  };
}

export function prepareExpoAccountDraft(account: ExpoAccountConfig): ExpoAccountConfig {
  const draft = createExpoAccountDraft();

  return {
    ...draft,
    ...account,
    accountType: account.accountType ?? draft.accountType,
    enabled: account.enabled ?? draft.enabled,
  };
}

export function getExpoProjectPlatforms(
  platforms?: ExpoProjectConfig['platforms'],
): ExpoProjectPlatform[] {
  return platforms?.length
    ? ([...platforms] as ExpoProjectPlatform[])
    : [...DEFAULT_EXPO_PROJECT_PLATFORMS];
}

export function createExpoProjectDraft(
  account?: ExpoAccountConfig,
  sshTargetId?: string,
  overrides: Partial<ExpoProjectConfig> = {},
): ExpoProjectConfig {
  return {
    id: generateId(),
    name: '',
    accountId: account?.id || '',
    owner: account?.owner || '',
    slug: '',
    enabled: true,
    mode: 'eas-workflow',
    sshTargetId,
    projectPath: '',
    repoFullName: '',
    workflowFile: '',
    workflowRef: '',
    defaultBuildProfile: 'production',
    defaultUpdateBranch: 'production',
    updateChannel: 'production',
    platforms: ['android', 'ios', 'web'],
    ...overrides,
  };
}

export function prepareExpoProjectDraft(project: ExpoProjectConfig): ExpoProjectConfig {
  const draft = createExpoProjectDraft();

  return {
    ...draft,
    ...project,
    mode: project.mode ?? draft.mode,
    workflowFile: project.workflowFile ?? draft.workflowFile,
    workflowRef: project.workflowRef ?? draft.workflowRef,
    defaultBuildProfile: project.defaultBuildProfile ?? draft.defaultBuildProfile,
    defaultUpdateBranch: project.defaultUpdateBranch ?? draft.defaultUpdateBranch,
    updateChannel: project.updateChannel ?? draft.updateChannel,
    platforms: getExpoProjectPlatforms(project.platforms),
    enabled: project.enabled ?? draft.enabled,
  };
}

export function toggleExpoProjectPlatform(
  platforms: ExpoProjectConfig['platforms'],
  platform: ExpoProjectPlatform,
): ExpoProjectPlatform[] {
  const nextPlatforms = new Set(getExpoProjectPlatforms(platforms));

  if (nextPlatforms.has(platform)) {
    nextPlatforms.delete(platform);
  } else {
    nextPlatforms.add(platform);
  }

  return Array.from(nextPlatforms) as ExpoProjectPlatform[];
}

export function createMcpServerDraft(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: generateId(),
    name: '',
    url: '',
    transport: 'auto',
    timeoutMs: 30000,
    enabled: true,
    tools: [],
    allowedTools: [],
    ...overrides,
  };
}

export function prepareMcpServerDraft(
  server: McpServerConfig,
  options?: { defaultTimeoutMs?: number },
): McpServerConfig {
  const draft = createMcpServerDraft({ timeoutMs: options?.defaultTimeoutMs || 30000 });

  return {
    ...draft,
    ...server,
    headers: server.headers ?? {},
    timeoutMs: server.timeoutMs ?? draft.timeoutMs,
    transport: server.transport ?? draft.transport,
    tools: server.tools ?? draft.tools,
    allowedTools: server.allowedTools ?? draft.allowedTools,
    enabled: server.enabled ?? draft.enabled,
  };
}
