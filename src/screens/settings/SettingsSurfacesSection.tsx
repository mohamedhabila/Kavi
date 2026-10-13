import React from 'react';
import { Text, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { SettingsConnectionsSurfaces } from './SettingsConnectionsSurfaces';
import { SettingsExpoSurfaces } from './SettingsExpoSurfaces';
import { SettingsInfrastructureSurfaces } from './SettingsInfrastructureSurfaces';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsSurfacesSectionProps = {
  browserProviders: BrowserProviderConfig[];
  colors: AppPalette;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  getBrowserProviderAuthLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  getMcpMetadataChips: (server: McpServerConfig) => string[];
  getSshHostKeyPolicyLabel: (target: SshTargetConfig) => string;
  getSshTargetAuthModeLabel: (target: SshTargetConfig) => string;
  handleEditBrowserProvider: (provider: BrowserProviderConfig) => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
  handleEditMcp: (server: McpServerConfig) => void | Promise<void>;
  handleEditSsh: (target: SshTargetConfig) => void;
  handleEditWorkspace: (target: WorkspaceTargetConfig) => void;
  handleNewBrowserProvider: () => void;
  handleNewExpoAccount: () => void;
  handleNewMcp: () => void;
  handleNewSsh: () => void;
  handleNewWorkspace: () => void;
  handleSyncExpoAccount: () => void | Promise<void>;
  mcpServers: McpServerConfig[];
  mode: 'connections' | 'developer';
  onLayout?: (event: any) => void;
  sshTargets: SshTargetConfig[];
  styles: StyleMap;
  t: TranslationFn;
  workspaceTargets: WorkspaceTargetConfig[];
};

export const SettingsSurfacesSection: React.FC<SettingsSurfacesSectionProps> = ({
  browserProviders,
  colors,
  expoAccounts,
  expoProjects,
  getBrowserProviderAuthLabel,
  getMcpMetadataChips,
  getSshHostKeyPolicyLabel,
  getSshTargetAuthModeLabel,
  handleEditBrowserProvider,
  handleEditExpoAccount,
  handleEditExpoProject,
  handleEditMcp,
  handleEditSsh,
  handleEditWorkspace,
  handleNewBrowserProvider,
  handleNewExpoAccount,
  handleNewMcp,
  handleNewSsh,
  handleNewWorkspace,
  handleSyncExpoAccount,
  mcpServers,
  mode,
  onLayout,
  sshTargets,
  styles,
  t,
  workspaceTargets,
}) => {
  const isConnections = mode === 'connections';

  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>
          {t(
            isConnections
              ? 'settings.destinations.connections.title'
              : 'nav.developerAndRemoteWork',
          )}
        </Text>
        <Text style={styles.sectionCardHint}>
          {t(
            isConnections
              ? 'settings.destinations.connections.hint'
              : 'settings.home.developerRemoteHint',
          )}
        </Text>
      </View>

      {isConnections ? (
        <SettingsConnectionsSurfaces
          browserProviders={browserProviders}
          colors={colors}
          getBrowserProviderAuthLabel={getBrowserProviderAuthLabel}
          getMcpMetadataChips={getMcpMetadataChips}
          handleEditBrowserProvider={handleEditBrowserProvider}
          handleEditMcp={handleEditMcp}
          handleNewBrowserProvider={handleNewBrowserProvider}
          handleNewMcp={handleNewMcp}
          mcpServers={mcpServers}
          styles={styles}
          t={t}
        />
      ) : (
        <>
          <SettingsInfrastructureSurfaces
            browserProviders={browserProviders}
            colors={colors}
            getBrowserProviderAuthLabel={getBrowserProviderAuthLabel}
            getSshHostKeyPolicyLabel={getSshHostKeyPolicyLabel}
            getSshTargetAuthModeLabel={getSshTargetAuthModeLabel}
            handleEditBrowserProvider={handleEditBrowserProvider}
            handleEditSsh={handleEditSsh}
            handleEditWorkspace={handleEditWorkspace}
            handleNewBrowserProvider={handleNewBrowserProvider}
            handleNewSsh={handleNewSsh}
            handleNewWorkspace={handleNewWorkspace}
            showBrowserProviders={false}
            sshTargets={sshTargets}
            styles={styles}
            t={t}
            workspaceTargets={workspaceTargets}
          />
          <SettingsExpoSurfaces
            colors={colors}
            expoAccounts={expoAccounts}
            expoProjects={expoProjects}
            handleEditExpoAccount={handleEditExpoAccount}
            handleEditExpoProject={handleEditExpoProject}
            handleNewExpoAccount={handleNewExpoAccount}
            handleSyncExpoAccount={handleSyncExpoAccount}
            sshTargets={sshTargets}
            styles={styles}
            t={t}
          />
        </>
      )}
    </View>
  );
};
