import React from 'react';
import { Text, View } from 'react-native';

import type { LlmProviderPreset } from '../../constants/api';
import type { AppPalette } from '../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import type { LlmProviderConfig } from '../../types/provider';
import { SettingsExpoSurfaces } from './SettingsExpoSurfaces';
import { SettingsInfrastructureSurfaces } from './SettingsInfrastructureSurfaces';
import { SettingsMcpSurfaces } from './SettingsMcpSurfaces';
import { SettingsProviderSurfaces } from './SettingsProviderSurfaces';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;
type CollapsibleSectionComponentType = React.ComponentType<{
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  colors: AppPalette;
}>;

type SettingsSurfacesSectionProps = {
  CollapsibleSectionComponent: CollapsibleSectionComponentType;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  expandedExecutionSurfaces: boolean;
  onToggleExecutionSurfaces: () => void;
  onLayout: (event: any) => void;
  sshTargets: SshTargetConfig[];
  workspaceTargets: WorkspaceTargetConfig[];
  browserProviders: BrowserProviderConfig[];
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  providers: LlmProviderConfig[];
  mcpServers: McpServerConfig[];
  localRuntimeStatusesByProviderId: Record<string, any>;
  getSshTargetAuthModeLabel: (target: SshTargetConfig) => string;
  getSshHostKeyPolicyLabel: (target: SshTargetConfig) => string;
  getBrowserProviderAuthLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  getMcpMetadataChips: (server: McpServerConfig) => string[];
  isOnDeviceLlmProvider: (provider: LlmProviderConfig) => boolean;
  getLocalLlmModelDisplayName: (modelId: string) => string;
  formatLocalLlmRuntimeStatusLabel: (status: any) => string;
  handleNewSsh: () => void;
  handleEditSsh: (target: SshTargetConfig) => void;
  handleNewWorkspace: () => void;
  handleEditWorkspace: (target: WorkspaceTargetConfig) => void;
  handleNewBrowserProvider: () => void;
  handleEditBrowserProvider: (provider: BrowserProviderConfig) => void;
  handleNewExpoAccount: () => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleSyncExpoAccount: () => void | Promise<void>;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
  handleNewProvider: (preset?: LlmProviderPreset) => void;
  handleEditProvider: (provider: LlmProviderConfig) => void;
  handleNewMcp: () => void;
  handleEditMcp: (server: McpServerConfig) => void | Promise<void>;
};

export const SettingsSurfacesSection: React.FC<SettingsSurfacesSectionProps> = ({
  CollapsibleSectionComponent,
  colors,
  styles,
  t,
  expandedExecutionSurfaces,
  onToggleExecutionSurfaces,
  onLayout,
  sshTargets,
  workspaceTargets,
  browserProviders,
  expoAccounts,
  expoProjects,
  providers,
  mcpServers,
  localRuntimeStatusesByProviderId,
  getSshTargetAuthModeLabel,
  getSshHostKeyPolicyLabel,
  getBrowserProviderAuthLabel,
  getMcpMetadataChips,
  isOnDeviceLlmProvider,
  getLocalLlmModelDisplayName,
  formatLocalLlmRuntimeStatusLabel,
  handleNewSsh,
  handleEditSsh,
  handleNewWorkspace,
  handleEditWorkspace,
  handleNewBrowserProvider,
  handleEditBrowserProvider,
  handleNewExpoAccount,
  handleEditExpoAccount,
  handleSyncExpoAccount,
  handleEditExpoProject,
  handleNewProvider,
  handleEditProvider,
  handleNewMcp,
  handleEditMcp,
}) => {
  return (
    <View style={styles.sectionCard} onLayout={onLayout}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.sectionCardTitle}>{t('settings.mainSections.surfaces.title')}</Text>
        <Text style={styles.sectionCardHint}>{t('settings.mainSections.surfaces.hint')}</Text>
      </View>

      <CollapsibleSectionComponent
        title={t('settings.executionSurfaces')}
        open={expandedExecutionSurfaces}
        onToggle={onToggleExecutionSurfaces}
        colors={colors}
      >
        <Text style={styles.listItemSubtitle}>{t('settings.executionSurfacesHint')}</Text>

        <SettingsInfrastructureSurfaces
          colors={colors}
          styles={styles}
          t={t}
          sshTargets={sshTargets}
          workspaceTargets={workspaceTargets}
          browserProviders={browserProviders}
          getSshTargetAuthModeLabel={getSshTargetAuthModeLabel}
          getSshHostKeyPolicyLabel={getSshHostKeyPolicyLabel}
          getBrowserProviderAuthLabel={getBrowserProviderAuthLabel}
          handleNewSsh={handleNewSsh}
          handleEditSsh={handleEditSsh}
          handleNewWorkspace={handleNewWorkspace}
          handleEditWorkspace={handleEditWorkspace}
          handleNewBrowserProvider={handleNewBrowserProvider}
          handleEditBrowserProvider={handleEditBrowserProvider}
        />

        <SettingsExpoSurfaces
          colors={colors}
          styles={styles}
          t={t}
          expoAccounts={expoAccounts}
          expoProjects={expoProjects}
          sshTargets={sshTargets}
          handleNewExpoAccount={handleNewExpoAccount}
          handleEditExpoAccount={handleEditExpoAccount}
          handleSyncExpoAccount={handleSyncExpoAccount}
          handleEditExpoProject={handleEditExpoProject}
        />

        <SettingsProviderSurfaces
          colors={colors}
          styles={styles}
          t={t}
          providers={providers}
          localRuntimeStatusesByProviderId={localRuntimeStatusesByProviderId}
          isOnDeviceLlmProvider={isOnDeviceLlmProvider}
          getLocalLlmModelDisplayName={getLocalLlmModelDisplayName}
          formatLocalLlmRuntimeStatusLabel={formatLocalLlmRuntimeStatusLabel}
          handleNewProvider={handleNewProvider}
          handleEditProvider={handleEditProvider}
        />

        <SettingsMcpSurfaces
          colors={colors}
          styles={styles}
          t={t}
          mcpServers={mcpServers}
          getMcpMetadataChips={getMcpMetadataChips}
          handleNewMcp={handleNewMcp}
          handleEditMcp={handleEditMcp}
        />
      </CollapsibleSectionComponent>
    </View>
  );
};
