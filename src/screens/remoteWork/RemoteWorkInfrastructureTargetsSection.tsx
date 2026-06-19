import React from 'react';
import { View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { BrowserProviderConfig, SshTargetConfig } from '../../types/remote';
import { RemoteWorkBrowserTargetsGroup } from './RemoteWorkBrowserTargetsGroup';
import { RemoteWorkMcpTargetsGroup } from './RemoteWorkMcpTargetsGroup';
import { RemoteWorkSshTargetsGroup } from './RemoteWorkSshTargetsGroup';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkInfrastructureTargetsSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  mcpTargets: any[];
  mcpServers: any[];
  sshTargets: SshTargetConfig[];
  sshSessions: any[];
  browserProviders: BrowserProviderConfig[];
  trackedRemoteSessions: any[];
  sshProbeResults: Record<string, any>;
  browserProbeResults: Record<string, any>;
  pendingSshChecks: Record<string, boolean | undefined>;
  pendingBrowserChecks: Record<string, boolean | undefined>;
  pendingBrowserLaunches: Record<string, boolean | undefined>;
  activeSshSessionId?: string | null;
  openingShellTargetId?: string | null;
  activeBrowserSession?: any;
  getSshTargetReadiness: (target: SshTargetConfig) => { launchable: boolean };
  getSshTargetLabel: (target: SshTargetConfig) => string;
  getSshReadinessLabel: (target: SshTargetConfig) => string;
  getSshTargetAuthModeLabel: (target: SshTargetConfig) => string;
  getSshHostKeyPolicyLabel: (target: SshTargetConfig) => string;
  getBrowserProviderReadiness: (provider: BrowserProviderConfig) => { launchable: boolean };
  getBrowserProviderLabel: (provider: BrowserProviderConfig['provider']) => string;
  getBrowserReadinessLabel: (provider: BrowserProviderConfig) => string;
  handleCreateMcp: () => void;
  handleEditMcpConfig: (server: any) => void;
  handleCreateSsh: () => void;
  handleOpenShell: (target: SshTargetConfig) => void | Promise<void>;
  handleProbeSsh: (target: SshTargetConfig) => void | Promise<void>;
  handleEditSshConfig: (target: SshTargetConfig) => void;
  handleCreateBrowser: () => void;
  handleLaunchBrowser: (provider: BrowserProviderConfig) => void | Promise<void>;
  handleProbeBrowser: (provider: BrowserProviderConfig) => void | Promise<void>;
  handleEditBrowserConfig: (provider: BrowserProviderConfig) => void;
};

export const RemoteWorkInfrastructureTargetsSection: React.FC<
  RemoteWorkInfrastructureTargetsSectionProps
> = ({
  colors,
  styles,
  t,
  mcpTargets,
  mcpServers,
  sshTargets,
  sshSessions,
  browserProviders,
  trackedRemoteSessions,
  sshProbeResults,
  browserProbeResults,
  pendingSshChecks,
  pendingBrowserChecks,
  pendingBrowserLaunches,
  activeSshSessionId,
  openingShellTargetId,
  activeBrowserSession,
  getSshTargetReadiness,
  getSshTargetLabel,
  getSshReadinessLabel,
  getSshTargetAuthModeLabel,
  getSshHostKeyPolicyLabel,
  getBrowserProviderReadiness,
  getBrowserProviderLabel,
  getBrowserReadinessLabel,
  handleCreateMcp,
  handleEditMcpConfig,
  handleCreateSsh,
  handleOpenShell,
  handleProbeSsh,
  handleEditSshConfig,
  handleCreateBrowser,
  handleLaunchBrowser,
  handleProbeBrowser,
  handleEditBrowserConfig,
}) => {
  return (
    <View>
      <RemoteWorkMcpTargetsGroup
        colors={colors}
        styles={styles}
        t={t}
        mcpTargets={mcpTargets}
        mcpServers={mcpServers}
        handleCreateMcp={handleCreateMcp}
        handleEditMcpConfig={handleEditMcpConfig}
      />

      <RemoteWorkSshTargetsGroup
        colors={colors}
        styles={styles}
        t={t}
        sshTargets={sshTargets}
        sshSessions={sshSessions}
        sshProbeResults={sshProbeResults}
        pendingSshChecks={pendingSshChecks}
        activeSshSessionId={activeSshSessionId}
        openingShellTargetId={openingShellTargetId}
        getSshTargetReadiness={getSshTargetReadiness}
        getSshTargetLabel={getSshTargetLabel}
        getSshReadinessLabel={getSshReadinessLabel}
        getSshTargetAuthModeLabel={getSshTargetAuthModeLabel}
        getSshHostKeyPolicyLabel={getSshHostKeyPolicyLabel}
        handleCreateSsh={handleCreateSsh}
        handleOpenShell={handleOpenShell}
        handleProbeSsh={handleProbeSsh}
        handleEditSshConfig={handleEditSshConfig}
      />

      <RemoteWorkBrowserTargetsGroup
        colors={colors}
        styles={styles}
        t={t}
        browserProviders={browserProviders}
        trackedRemoteSessions={trackedRemoteSessions}
        browserProbeResults={browserProbeResults}
        pendingBrowserChecks={pendingBrowserChecks}
        pendingBrowserLaunches={pendingBrowserLaunches}
        activeBrowserSession={activeBrowserSession}
        getBrowserProviderReadiness={getBrowserProviderReadiness}
        getBrowserProviderLabel={getBrowserProviderLabel}
        getBrowserReadinessLabel={getBrowserReadinessLabel}
        handleCreateBrowser={handleCreateBrowser}
        handleLaunchBrowser={handleLaunchBrowser}
        handleProbeBrowser={handleProbeBrowser}
        handleEditBrowserConfig={handleEditBrowserConfig}
      />
    </View>
  );
};
