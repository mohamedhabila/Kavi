import type { McpServerStatus } from '../mcp/manager';
import { getBrowserProviderLabel, getBrowserProviderReadiness } from '../browser/providers';
import {
  getExpoProjectDisplayOwner,
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
} from '../expo/eas';
import { getSshTargetLabel, getSshTargetReadiness } from '../ssh/connector';
import type { SshShellSession } from '../ssh/sessionStore';
import { getWorkspaceProviderLabel, getWorkspaceTargetReadiness } from '../workspaces/connector';
import { getWorkspaceTargetControlStatus } from '../workspaces/control';
import type {
  AppSettings,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  RemoteJobRecord,
  RemoteSessionRecord,
  RemoteTargetRecord,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types';

export interface RemoteCommandCenterSnapshot {
  targets: RemoteTargetRecord[];
  sessions: RemoteSessionRecord[];
  jobs: RemoteJobRecord[];
  readyCounts: {
    workspace: number;
    ssh: number;
    mcp: number;
    browser: number;
    expo: number;
  };
  enabledCounts: {
    workspace: number;
    ssh: number;
    mcp: number;
    browser: number;
    expo: number;
  };
  activeCounts: {
    jobs: number;
    sessions: number;
  };
}

function getMcpTargetRecord(config: McpServerConfig, status?: McpServerStatus): RemoteTargetRecord {
  const authState =
    status?.authState ||
    (config.capabilities?.authMode === 'oauth' ? 'unauthenticated' : undefined);
  const state = status?.state;
  const enabled = config.enabled;
  const connected = state === 'connected';
  const readiness = !enabled
    ? 'disabled'
    : connected || authState === 'authenticated'
      ? 'ready'
      : !status
        ? 'setup-required'
        : state === 'error'
          ? 'error'
          : 'setup-required';

  const statusLabel = !enabled
    ? 'Disabled'
    : connected
      ? 'Connected'
      : authState === 'pending'
        ? 'Authentication pending'
        : authState === 'unauthenticated'
          ? 'Authentication required'
          : state === 'connecting'
            ? 'Connecting'
            : state === 'error'
              ? 'Attention required'
              : 'Configured';

  const detail = [
    config.url,
    config.capabilities?.transport || config.transport || 'auto',
    config.capabilities?.authMode || 'none',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: config.id,
    name: config.name,
    kind: 'mcp-server',
    providerLabel: 'MCP',
    authState,
    readiness,
    launchable: enabled,
    statusLabel,
    detail,
    lastCheckedAt: status?.lastConnected,
    error: status?.error,
    activitySummary: connected ? `${status?.tools.length || 0} tools online` : undefined,
  };
}

function getSshRecord(target: SshTargetConfig): RemoteTargetRecord {
  const readiness = getSshTargetReadiness(target);

  return {
    id: target.id,
    name: target.name,
    kind: 'ssh-host',
    providerLabel: getSshTargetLabel(target),
    authState: target.passwordRef || target.privateKeyRef ? 'authenticated' : 'unauthenticated',
    readiness:
      readiness.reason === 'ready'
        ? 'ready'
        : readiness.reason === 'disabled'
          ? 'disabled'
          : readiness.reason === 'platform-unsupported'
            ? 'error'
            : 'setup-required',
    launchable: readiness.launchable,
    statusLabel:
      readiness.reason === 'ready'
        ? 'Ready'
        : readiness.reason === 'platform-unsupported'
          ? 'Unavailable on this device'
          : readiness.reason === 'disabled'
            ? 'Disabled'
            : 'Setup required',
    detail: target.remoteRoot?.trim() || getSshTargetLabel(target),
    activitySummary: target.remoteRoot?.trim() ? `Root ${target.remoteRoot.trim()}` : undefined,
  };
}

function getWorkspaceRecord(
  target: WorkspaceTargetConfig,
  settings: Pick<AppSettings, 'browserProviders' | 'sshTargets'>,
): RemoteTargetRecord {
  const readiness = getWorkspaceTargetReadiness(target);
  const controlStatus = getWorkspaceTargetControlStatus(target, settings);
  const ready =
    controlStatus.fileAccessReady ||
    controlStatus.browserAutomationReady ||
    controlStatus.aiTaskReady ||
    readiness.launchable;

  return {
    id: target.id,
    name: target.name,
    kind: 'workspace',
    providerLabel: getWorkspaceProviderLabel(target.provider),
    authState:
      target.authMode && target.authMode !== 'none'
        ? target.accessTokenRef
          ? 'authenticated'
          : 'unauthenticated'
        : undefined,
    readiness: readiness.reason === 'disabled' ? 'disabled' : ready ? 'ready' : 'setup-required',
    launchable: ready,
    statusLabel:
      readiness.reason === 'disabled'
        ? 'Disabled'
        : controlStatus.aiTaskReady && !readiness.launchable
          ? 'AI handoff ready'
          : ready
            ? 'Ready'
            : 'Setup required',
    detail: target.baseUrl?.trim() || target.rootPath,
    activitySummary:
      controlStatus.aiTaskReady && target.sshTargetId
        ? `AI handoff via ${target.sshTargetId}`
        : (target.configRoots || []).length > 0
          ? `${target.configRoots?.length || 0} config roots`
          : undefined,
  };
}

function getBrowserRecord(
  config: NonNullable<AppSettings['browserProviders']>[number],
): RemoteTargetRecord {
  const readiness = getBrowserProviderReadiness(config);

  return {
    id: config.id,
    name: config.name,
    kind: 'browser-provider',
    providerLabel: getBrowserProviderLabel(config.provider),
    authState:
      config.authMode && config.authMode !== 'none'
        ? config.apiKeyRef
          ? 'authenticated'
          : 'unauthenticated'
        : undefined,
    readiness:
      readiness.reason === 'ready'
        ? 'ready'
        : readiness.reason === 'disabled'
          ? 'disabled'
          : 'setup-required',
    launchable: readiness.launchable,
    statusLabel:
      readiness.reason === 'ready'
        ? 'Ready'
        : readiness.reason === 'disabled'
          ? 'Disabled'
          : 'Setup required',
    detail: config.baseUrl?.trim() || getBrowserProviderLabel(config.provider),
    activitySummary: config.projectId?.trim() ? `Project ${config.projectId.trim()}` : undefined,
  };
}

function getExpoRecord(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig | undefined,
  settings: Pick<AppSettings, 'sshTargets'>,
): RemoteTargetRecord {
  const readiness = getExpoProjectReadiness(project, account, settings);
  const owner = getExpoProjectDisplayOwner(project, account);
  const mode = getExpoProjectExecutionMode(project, account);
  const modeLabel =
    mode === 'eas-workflow'
      ? 'Expo workflow'
      : mode === 'github-workflow'
        ? 'GitHub workflow'
        : 'Direct EAS CLI';
  const detail = `${owner}/${project.slug} · ${modeLabel}`;
  const platformLabel = project.platforms?.length
    ? `${project.platforms.join(', ')} targets`
    : undefined;

  return {
    id: project.id,
    name: project.name,
    kind: 'expo-project',
    providerLabel: 'Expo EAS',
    authState: account?.tokenRef ? 'authenticated' : 'unauthenticated',
    readiness:
      readiness.reason === 'ready'
        ? 'ready'
        : readiness.reason === 'disabled'
          ? 'disabled'
          : 'setup-required',
    launchable: readiness.launchable,
    statusLabel:
      readiness.reason === 'ready'
        ? 'Ready'
        : readiness.reason === 'disabled'
          ? 'Disabled'
          : 'Setup required',
    detail,
    activitySummary: platformLabel || project.webUrl || project.previewUrl || project.customDomain,
    error:
      readiness.reason === 'ready' || readiness.reason === 'disabled'
        ? undefined
        : readiness.reason,
  };
}

function mapSshSession(session: SshShellSession): RemoteSessionRecord {
  return {
    id: session.id,
    targetId: session.targetId,
    kind: 'ssh-shell',
    status: session.status,
    startedAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    summary: session.targetLabel,
    reconnectable: session.status !== 'closed',
    error: session.error,
  };
}

export function buildRemoteCommandCenterSnapshot(
  settings: Pick<
    AppSettings,
    | 'mcpServers'
    | 'sshTargets'
    | 'workspaceTargets'
    | 'browserProviders'
    | 'expoAccounts'
    | 'expoProjects'
  >,
  options?: {
    mcpStatuses?: McpServerStatus[];
    sshSessions?: SshShellSession[];
    remoteSessions?: RemoteSessionRecord[];
    remoteJobs?: RemoteJobRecord[];
  },
): RemoteCommandCenterSnapshot {
  const mcpStatusMap = new Map((options?.mcpStatuses || []).map((status) => [status.id, status]));
  const expoAccountMap = new Map(
    (settings.expoAccounts || []).map((account) => [account.id, account]),
  );
  const targets: RemoteTargetRecord[] = [
    ...(settings.mcpServers || []).map((server) =>
      getMcpTargetRecord(server, mcpStatusMap.get(server.id)),
    ),
    ...(settings.sshTargets || []).map(getSshRecord),
    ...(settings.workspaceTargets || []).map((target) => getWorkspaceRecord(target, settings)),
    ...(settings.browserProviders || []).map(getBrowserRecord),
    ...(settings.expoProjects || []).map((project) =>
      getExpoRecord(project, expoAccountMap.get(project.accountId), settings),
    ),
  ];

  // Merge SSH sessions (legacy format) with remote store sessions, deduplicate by id
  const sshSessionRecords = (options?.sshSessions || []).map(mapSshSession);
  const remoteStoreSessions = options?.remoteSessions || [];
  const seenSessionIds = new Set<string>();
  const sessions: RemoteSessionRecord[] = [];
  for (const session of [...sshSessionRecords, ...remoteStoreSessions]) {
    if (!seenSessionIds.has(session.id)) {
      seenSessionIds.add(session.id);
      sessions.push(session);
    }
  }

  const jobs = options?.remoteJobs || [];

  return {
    targets,
    sessions,
    jobs,
    readyCounts: {
      workspace: targets.filter(
        (target) => target.kind === 'workspace' && target.readiness === 'ready',
      ).length,
      ssh: targets.filter((target) => target.kind === 'ssh-host' && target.readiness === 'ready')
        .length,
      mcp: targets.filter((target) => target.kind === 'mcp-server' && target.readiness === 'ready')
        .length,
      browser: targets.filter(
        (target) => target.kind === 'browser-provider' && target.readiness === 'ready',
      ).length,
      expo: targets.filter(
        (target) => target.kind === 'expo-project' && target.readiness === 'ready',
      ).length,
    },
    enabledCounts: {
      workspace: (settings.workspaceTargets || []).filter((target) => target.enabled).length,
      ssh: (settings.sshTargets || []).filter((target) => target.enabled).length,
      mcp: (settings.mcpServers || []).filter((server) => server.enabled).length,
      browser: (settings.browserProviders || []).filter((provider) => provider.enabled).length,
      expo: (settings.expoProjects || []).filter((project) => project.enabled).length,
    },
    activeCounts: {
      jobs: jobs.filter((job) => job.status === 'running' || job.status === 'queued').length,
      sessions: sessions.filter((s) => s.status === 'connecting' || s.status === 'connected')
        .length,
    },
  };
}
