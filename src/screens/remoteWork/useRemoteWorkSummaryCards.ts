import { CloudSun, Cpu, Server, ShieldCheck, TerminalSquare } from 'lucide-react-native';
import { useMemo } from 'react';

import { buildRemoteCommandCenterSnapshot } from '../../services/remote/commandCenter';
import type { ConfigSurface } from './remoteWorkConfigStudioTypes';

type TranslationFn = (key: string, params?: any) => string;
type CommandCenterSnapshot = ReturnType<typeof buildRemoteCommandCenterSnapshot>;

type UseRemoteWorkSummaryCardsParams = {
  activeConfigSurface: ConfigSurface;
  t: TranslationFn;
  commandCenter: CommandCenterSnapshot;
  workspaceCount: number;
  sshCount: number;
  mcpCount: number;
  browserCount: number;
  expoProjectCount: number;
  expoAccountCount: number;
  handleCreateWorkspace: () => void;
  handleCreateSsh: () => void;
  handleCreateBrowser: () => void;
  handleCreateExpo: () => void;
  handleCreateMcp: () => void;
};

export function useRemoteWorkSummaryCards({
  activeConfigSurface,
  t,
  commandCenter,
  workspaceCount,
  sshCount,
  mcpCount,
  browserCount,
  expoProjectCount,
  expoAccountCount,
  handleCreateWorkspace,
  handleCreateSsh,
  handleCreateBrowser,
  handleCreateExpo,
  handleCreateMcp,
}: UseRemoteWorkSummaryCardsParams) {
  const summaryCards = useMemo(
    () => [
      {
        key: 'workspace',
        title: t('remoteWork.launchableTargets'),
        value: `${commandCenter.readyCounts.workspace}/${commandCenter.enabledCounts.workspace || workspaceCount || 0}`,
        icon: Cpu,
      },
      {
        key: 'ssh',
        title: t('remoteWork.sshSummary'),
        value: `${commandCenter.readyCounts.ssh}/${commandCenter.enabledCounts.ssh || sshCount || 0}`,
        icon: TerminalSquare,
      },
      {
        key: 'mcp',
        title: t('remoteWork.mcpSummary'),
        value: `${commandCenter.readyCounts.mcp}/${commandCenter.enabledCounts.mcp || mcpCount || 0}`,
        icon: Server,
      },
      {
        key: 'browser',
        title: t('remoteWork.browserSummary'),
        value: `${commandCenter.readyCounts.browser}/${commandCenter.enabledCounts.browser || browserCount || 0}`,
        icon: ShieldCheck,
      },
      {
        key: 'expo',
        title: t('remoteWork.expoSummary'),
        value: `${commandCenter.readyCounts.expo}/${commandCenter.enabledCounts.expo || expoProjectCount || 0}`,
        icon: CloudSun,
      },
    ],
    [
      browserCount,
      commandCenter.enabledCounts.browser,
      commandCenter.enabledCounts.expo,
      commandCenter.enabledCounts.mcp,
      commandCenter.enabledCounts.ssh,
      commandCenter.enabledCounts.workspace,
      commandCenter.readyCounts.browser,
      commandCenter.readyCounts.expo,
      commandCenter.readyCounts.mcp,
      commandCenter.readyCounts.ssh,
      commandCenter.readyCounts.workspace,
      expoProjectCount,
      mcpCount,
      sshCount,
      t,
      workspaceCount,
    ],
  );

  const activeConfigSurfaceCard = useMemo(() => {
    switch (activeConfigSurface) {
      case 'ssh':
        return {
          title: t('remoteWork.sshTargetsTitle'),
          hint: t('remoteWork.sshManageHint'),
          value: `${commandCenter.readyCounts.ssh}/${commandCenter.enabledCounts.ssh || sshCount || 0}`,
          actionLabel: t('settings.addSshTarget'),
          onPress: handleCreateSsh,
        };
      case 'browser':
        return {
          title: t('remoteWork.browserTargetsTitle'),
          hint: t('remoteWork.browserManageHint'),
          value: `${commandCenter.readyCounts.browser}/${commandCenter.enabledCounts.browser || browserCount || 0}`,
          actionLabel: t('settings.addBrowserProvider'),
          onPress: handleCreateBrowser,
        };
      case 'expo':
        return {
          title: t('remoteWork.expoTargetsTitle'),
          hint: t('remoteWork.expoManageHint'),
          value: `${commandCenter.readyCounts.expo}/${commandCenter.enabledCounts.expo || expoProjectCount || 0}`,
          actionLabel:
            expoAccountCount > 0 ? t('settings.addExpoProject') : t('settings.addExpoAccount'),
          onPress: handleCreateExpo,
        };
      case 'mcp':
        return {
          title: t('remoteWork.mcpTargetsTitle'),
          hint: t('remoteWork.mcpManageHint'),
          value: `${commandCenter.readyCounts.mcp}/${commandCenter.enabledCounts.mcp || mcpCount || 0}`,
          actionLabel: t('settings.addMcpServer'),
          onPress: handleCreateMcp,
        };
      case 'workspace':
      default:
        return {
          title: t('remoteWork.configuredTargets'),
          hint: t('remoteWork.workspaceManageFromHubHint'),
          value: `${commandCenter.readyCounts.workspace}/${commandCenter.enabledCounts.workspace || workspaceCount || 0}`,
          actionLabel: t('settings.addWorkspaceTarget'),
          onPress: handleCreateWorkspace,
        };
    }
  }, [
    activeConfigSurface,
    browserCount,
    commandCenter.enabledCounts.browser,
    commandCenter.enabledCounts.expo,
    commandCenter.enabledCounts.mcp,
    commandCenter.enabledCounts.ssh,
    commandCenter.enabledCounts.workspace,
    commandCenter.readyCounts.browser,
    commandCenter.readyCounts.expo,
    commandCenter.readyCounts.mcp,
    commandCenter.readyCounts.ssh,
    commandCenter.readyCounts.workspace,
    expoAccountCount,
    expoProjectCount,
    handleCreateBrowser,
    handleCreateExpo,
    handleCreateMcp,
    handleCreateSsh,
    handleCreateWorkspace,
    mcpCount,
    sshCount,
    t,
    workspaceCount,
  ]);

  return {
    summaryCards,
    activeConfigSurfaceCard,
  };
}
