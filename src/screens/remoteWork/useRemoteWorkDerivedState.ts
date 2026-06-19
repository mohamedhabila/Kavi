import { useCallback, useMemo } from 'react';

import { getBrowserProviderReadiness } from '../../services/browser/providers/readiness';
import type { McpServerStatus } from '../../services/mcp/manager';
import { buildRemoteCommandCenterSnapshot } from '../../services/remote/commandCenter';
import { getSshTargetReadiness } from '../../services/ssh/connector';
import type { WorkspaceProbeResult } from '../../services/workspaces/connector';
import { getWorkspaceTargetReadiness } from '../../services/workspaces/connector';
import { getWorkspaceTargetControlStatus } from '../../services/workspaces/control';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  RemoteJobRecord,
  RemoteSessionRecord,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type PendingMap = Record<string, boolean | undefined>;
type WorkspaceProbeMap = Record<string, WorkspaceProbeResult | undefined>;
type CommandCenterSession = NonNullable<
  NonNullable<Parameters<typeof buildRemoteCommandCenterSnapshot>[1]>['sshSessions']
>[number];

type UseRemoteWorkDerivedStateParams = {
  t: TranslationFn;
  width: number;
  summaryColumns: number;
  workspaceTargets: WorkspaceTargetConfig[];
  sshTargets: SshTargetConfig[];
  browserProviders: BrowserProviderConfig[];
  mcpServers: McpServerConfig[];
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  mcpStatuses: McpServerStatus[];
  sshSessions: CommandCenterSession[];
  remoteSessions: RemoteSessionRecord[];
  remoteJobs: RemoteJobRecord[];
  selectedWorkspaceId: string | null;
  workspaceProbeResults: WorkspaceProbeMap;
  pendingWorkspaceChecks: PendingMap;
};

export function useRemoteWorkDerivedState({
  t,
  width,
  summaryColumns,
  workspaceTargets,
  sshTargets,
  browserProviders,
  mcpServers,
  expoAccounts,
  expoProjects,
  mcpStatuses,
  sshSessions,
  remoteSessions,
  remoteJobs,
  selectedWorkspaceId,
  workspaceProbeResults,
  pendingWorkspaceChecks,
}: UseRemoteWorkDerivedStateParams) {
  const commandCenter = useMemo(
    () =>
      buildRemoteCommandCenterSnapshot(
        {
          mcpServers,
          sshTargets,
          workspaceTargets,
          browserProviders,
          expoAccounts,
          expoProjects,
        },
        {
          mcpStatuses,
          sshSessions,
          remoteSessions,
          remoteJobs,
        },
      ),
    [
      browserProviders,
      expoAccounts,
      expoProjects,
      mcpServers,
      mcpStatuses,
      remoteJobs,
      remoteSessions,
      sshSessions,
      sshTargets,
      workspaceTargets,
    ],
  );

  const mcpTargets = useMemo(
    () => commandCenter.targets.filter((target) => target.kind === 'mcp-server'),
    [commandCenter.targets],
  );
  const expoTargets = useMemo(
    () => commandCenter.targets.filter((target) => target.kind === 'expo-project'),
    [commandCenter.targets],
  );
  const trackedRemoteSessions = useMemo(
    () => [...remoteSessions].sort((left, right) => right.lastActivityAt - left.lastActivityAt),
    [remoteSessions],
  );
  const trackedRemoteJobs = useMemo(
    () => [...remoteJobs].sort((left, right) => right.updatedAt - left.updatedAt),
    [remoteJobs],
  );

  const workspaceControlStatuses = useMemo(
    () =>
      new Map(
        workspaceTargets.map((target) => [
          target.id,
          getWorkspaceTargetControlStatus(target, { browserProviders, sshTargets }),
        ]),
      ),
    [browserProviders, sshTargets, workspaceTargets],
  );

  const getWorkspaceControlStatus = useCallback(
    (target: WorkspaceTargetConfig) => {
      return (
        workspaceControlStatuses.get(target.id) ||
        getWorkspaceTargetControlStatus(target, { browserProviders, sshTargets })
      );
    },
    [browserProviders, sshTargets, workspaceControlStatuses],
  );

  const isWorkspaceControlReady = useCallback(
    (target: WorkspaceTargetConfig) => {
      const status = getWorkspaceControlStatus(target);
      return (
        status.launchable ||
        status.fileAccessReady ||
        status.browserAutomationReady ||
        status.aiTaskReady
      );
    },
    [getWorkspaceControlStatus],
  );

  const workspaceReadyCount = useMemo(
    () => commandCenter.readyCounts.workspace,
    [commandCenter.readyCounts.workspace],
  );
  const workspaceNeedsSetupCount = useMemo(
    () => Math.max(0, commandCenter.enabledCounts.workspace - commandCenter.readyCounts.workspace),
    [commandCenter.enabledCounts.workspace, commandCenter.readyCounts.workspace],
  );
  const workspaceDisabledCount = useMemo(
    () => workspaceTargets.filter((target) => !target.enabled).length,
    [workspaceTargets],
  );

  const selectedWorkspaceTarget = useMemo(() => {
    if (!workspaceTargets.length) {
      return null;
    }

    return (
      workspaceTargets.find((target) => target.id === selectedWorkspaceId) || workspaceTargets[0]
    );
  }, [selectedWorkspaceId, workspaceTargets]);

  const selectedWorkspaceReadiness = selectedWorkspaceTarget
    ? getWorkspaceTargetReadiness(selectedWorkspaceTarget)
    : null;
  const selectedWorkspaceControlStatus = selectedWorkspaceTarget
    ? getWorkspaceControlStatus(selectedWorkspaceTarget)
    : null;
  const selectedWorkspaceProbe = selectedWorkspaceTarget
    ? workspaceProbeResults[selectedWorkspaceTarget.id]
    : undefined;
  const selectedWorkspaceCheckPending = selectedWorkspaceTarget
    ? Boolean(pendingWorkspaceChecks[selectedWorkspaceTarget.id])
    : false;

  const summaryCardWidth = useMemo(() => {
    const horizontalPadding = 32;
    const gap = 12 * (summaryColumns - 1);
    return Math.max(150, (width - horizontalPadding - gap) / summaryColumns);
  }, [summaryColumns, width]);

  const getWorkspaceReadinessLabel = useCallback(
    (target: WorkspaceTargetConfig) => {
      const readiness = getWorkspaceTargetReadiness(target);
      const controlStatus = getWorkspaceControlStatus(target);
      if (readiness.reason === 'disabled') {
        return t('remoteWork.disabledTarget');
      }
      if (controlStatus.aiTaskReady && !controlStatus.launchable) {
        return t('remoteWork.workspaceAiHandoffReady');
      }
      if (isWorkspaceControlReady(target)) {
        return t('remoteWork.statusReady');
      }

      switch (readiness.reason) {
        case 'missing-base-url':
          return t('remoteWork.missingConnectionConfig');
        case 'invalid-base-url':
          return t('remoteWork.invalidBaseUrl');
        case 'missing-token':
          return t('remoteWork.missingToken');
        case 'missing-query-token-param':
          return t('remoteWork.missingQueryTokenParam');
        case 'missing-root-path':
        default:
          return t('remoteWork.missingRootPath');
      }
    },
    [getWorkspaceControlStatus, isWorkspaceControlReady, t],
  );

  const getWorkspaceBrowserProviderName = useCallback(
    (browserProviderId?: string) => {
      if (!browserProviderId) {
        return t('remoteWork.workspaceBrowserProviderAutoSelect');
      }

      return (
        browserProviders.find((provider) => provider.id === browserProviderId)?.name ||
        t('common.none')
      );
    },
    [browserProviders, t],
  );

  const getWorkspaceSshTargetName = useCallback(
    (sshTargetId?: string) => {
      if (!sshTargetId) {
        return t('common.none');
      }

      return sshTargets.find((target) => target.id === sshTargetId)?.name || t('common.none');
    },
    [sshTargets, t],
  );

  const getWorkspaceAiHandoffSummary = useCallback(
    (target: WorkspaceTargetConfig) => {
      const controlStatus = getWorkspaceControlStatus(target);
      if (target.provider === 'cursor') {
        return controlStatus.aiTaskReady && target.sshTargetId
          ? t('remoteWork.workspaceAiHandoffCursorConnected', {
              targetName: getWorkspaceSshTargetName(target.sshTargetId),
            })
          : t('remoteWork.workspaceAiHandoffCursorNeedsTarget');
      }

      if (target.aiTaskCommandTemplate && controlStatus.aiTaskReady && target.sshTargetId) {
        return t('remoteWork.workspaceAiHandoffCustomConnected', {
          targetName: getWorkspaceSshTargetName(target.sshTargetId),
        });
      }

      return t('remoteWork.notConfigured');
    },
    [getWorkspaceControlStatus, getWorkspaceSshTargetName, t],
  );

  const getSshReadinessLabel = useCallback(
    (target: SshTargetConfig) => {
      const readiness = getSshTargetReadiness(target);
      switch (readiness.reason) {
        case 'disabled':
          return t('remoteWork.disabledTarget');
        case 'platform-unsupported':
          return t('remoteWork.sshUnsupported');
        case 'missing-verified-transport':
          return t('remoteWork.sshVerificationUnavailable');
        case 'missing-host':
          return t('remoteWork.missingSshHost');
        case 'missing-host-fingerprint':
          return t('remoteWork.missingSshFingerprint');
        case 'missing-username':
          return t('remoteWork.missingSshUsername');
        case 'missing-auth-secret':
          return t('remoteWork.missingSshAuth');
        case 'ready':
        default:
          return t('remoteWork.statusReady');
      }
    },
    [t],
  );

  const getBrowserReadinessLabel = useCallback(
    (provider: BrowserProviderConfig) => {
      const readiness = getBrowserProviderReadiness(provider);
      switch (readiness.reason) {
        case 'disabled':
          return t('remoteWork.disabledTarget');
        case 'missing-base-url':
          return t('remoteWork.missingConnectionConfig');
        case 'invalid-base-url':
          return t('remoteWork.invalidBaseUrl');
        case 'missing-api-key':
          return t('remoteWork.missingToken');
        case 'missing-project-id':
          return t('remoteWork.browserProjectRequired');
        case 'ready':
        default:
          return t('remoteWork.statusReady');
      }
    },
    [t],
  );

  return {
    commandCenter,
    mcpTargets,
    expoTargets,
    trackedRemoteSessions,
    trackedRemoteJobs,
    isWorkspaceControlReady,
    workspaceReadyCount,
    workspaceNeedsSetupCount,
    workspaceDisabledCount,
    selectedWorkspaceTarget,
    selectedWorkspaceReadiness,
    selectedWorkspaceControlStatus,
    selectedWorkspaceProbe,
    selectedWorkspaceCheckPending,
    summaryCardWidth,
    getWorkspaceReadinessLabel,
    getWorkspaceBrowserProviderName,
    getWorkspaceAiHandoffSummary,
    getSshReadinessLabel,
    getBrowserReadinessLabel,
  };
}
