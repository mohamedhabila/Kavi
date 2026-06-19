export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpOAuthConfig {
  clientId?: string;
  clientSecretRef?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scope?: string;
  projectNameForProxy?: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
}

export type McpAuthMode = 'none' | 'header' | 'variable' | 'mixed' | 'oauth';

export interface McpCapabilityMetadata {
  transport: 'auto' | 'streamable-http' | 'sse';
  authMode: McpAuthMode;
  requiresConfiguration: boolean;
  requiresSecrets: boolean;
  inputCount: number;
}

export interface McpTrustMetadata {
  source: 'manual' | 'official-registry';
  registryName?: string;
  websiteUrl?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  token?: string;
  tokenRef?: string;
  headers?: Record<string, string>;
  transport?: 'auto' | 'streamable-http' | 'sse';
  sseUrl?: string;
  timeoutMs?: number;
  oauth?: McpOAuthConfig;
  enabled: boolean;
  tools: McpToolSchema[];
  allowedTools: string[];
  autoApprovedTools?: string[];
  trust?: McpTrustMetadata;
  capabilities?: McpCapabilityMetadata;
}

export interface SshTargetConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  remoteRoot?: string;
  hostKeyPolicy?: 'strict' | 'trust-on-first-use';
  trustedHostFingerprint?: string;
  authMode?: 'password' | 'private-key';
  passwordRef?: string;
  privateKeyRef?: string;
  passphraseRef?: string;
  ptyType?: 'vanilla' | 'vt100' | 'vt102' | 'vt220' | 'ansi' | 'xterm';
  enabled: boolean;
}

export interface WorkspaceTargetConfig {
  id: string;
  name: string;
  rootPath: string;
  configRoots?: string[];
  provider?:
    | 'code-server'
    | 'openvscode-server'
    | 'vscode-web'
    | 'vscode-tunnel'
    | 'cursor'
    | 'windsurf'
    | 'antigravity'
    | 'generic-vscode'
    | 'custom';
  baseUrl?: string;
  authMode?: 'none' | 'bearer' | 'query-token';
  accessTokenRef?: string;
  queryTokenParam?: string;
  browserProviderId?: string;
  sshTargetId?: string;
  aiTaskCommandTemplate?: string;
  enabled: boolean;
}

export interface BrowserProviderConfig {
  id: string;
  name: string;
  provider?: 'browserbase' | 'browserless' | 'custom';
  baseUrl?: string;
  authMode?: 'none' | 'api-key-header' | 'bearer' | 'query-token';
  apiKeyRef?: string;
  queryTokenParam?: string;
  projectId?: string;
  enabled: boolean;
}

export interface ExpoAccountConfig {
  id: string;
  name: string;
  owner: string;
  accountType?: 'personal' | 'robot';
  tokenRef?: string;
  lastProjectSyncAt?: number;
  lastProjectSyncError?: string;
  syncedProjectCount?: number;
  enabled: boolean;
}

export interface ExpoProjectConfig {
  id: string;
  easProjectId?: string;
  name: string;
  accountId: string;
  owner: string;
  slug: string;
  source?: 'manual' | 'account-sync';
  lastSyncedAt?: number;
  enabled: boolean;
  mode: 'eas-workflow' | 'direct-ssh' | 'github-workflow';
  sshTargetId?: string;
  projectPath?: string;
  repoFullName?: string;
  repoDefaultBranch?: string;
  availableWorkflowFiles?: string[];
  workflowFile?: string;
  workflowRef?: string;
  /** SecureStorage key ref for the GitHub token (github-workflow mode) */
  githubTokenRef?: string;
  defaultBuildProfile?: string;
  defaultUpdateBranch?: string;
  updateChannel?: string;
  webUrl?: string;
  previewUrl?: string;
  customDomain?: string;
  platforms?: Array<'android' | 'ios' | 'web'>;
}

export type RemoteTargetKind =
  | 'mcp-server'
  | 'ssh-host'
  | 'workspace'
  | 'browser-provider'
  | 'expo-project';

export type RemoteSessionKind =
  | 'ssh-shell'
  | 'workspace-view'
  | 'browser-live'
  | 'mcp-operation-stream';

export type RemoteJobKind = 'browser-job' | 'agent-job' | 'mcp-job' | 'workspace-task' | 'expo-job';

export type RemoteReadinessState = 'ready' | 'setup-required' | 'disabled' | 'error';

export interface RemoteArtifact {
  id: string;
  kind: 'screenshot' | 'transcript-excerpt' | 'diff' | 'log-snippet' | 'export-bundle';
  title: string;
  value?: string;
  uri?: string;
  mimeType?: string;
  createdAt: number;
}

export interface RemoteApprovalRequest {
  id: string;
  targetId?: string;
  toolName?: string;
  scope?: 'ssh' | 'workspace' | 'browser' | 'expo' | 'native' | 'other';
  jobId?: string;
  title: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAt: number;
  expiresAt?: number;
  resolvedAt?: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  riskReasons?: string[];
}

export interface RemoteJobRecord {
  id: string;
  jobType: RemoteJobKind;
  targetId?: string;
  providerId?: string;
  externalId?: string;
  status: 'queued' | 'running' | 'waiting-approval' | 'completed' | 'failed' | 'cancelled';
  requestedBy: 'user' | 'agent' | 'system';
  executionSurface: 'mcp' | 'ssh' | 'workspace' | 'browser-job' | 'expo-eas';
  summary: string;
  progressText?: string;
  approvalState?: RemoteApprovalRequest['status'];
  artifacts: RemoteArtifact[];
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface RemoteSessionRecord {
  id: string;
  targetId: string;
  providerId?: string;
  externalId?: string;
  kind: RemoteSessionKind;
  status: 'connecting' | 'connected' | 'error' | 'closed';
  startedAt: number;
  lastActivityAt: number;
  summary: string;
  reconnectable: boolean;
  liveViewUrl?: string;
  error?: string;
}

export interface RemoteTargetRecord {
  id: string;
  name: string;
  kind: RemoteTargetKind;
  providerLabel?: string;
  authState?: 'authenticated' | 'unauthenticated' | 'pending';
  readiness: RemoteReadinessState;
  launchable: boolean;
  statusLabel: string;
  detail: string;
  lastCheckedAt?: number;
  error?: string;
  activitySummary?: string;
}
