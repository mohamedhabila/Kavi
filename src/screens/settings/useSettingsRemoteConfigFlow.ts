import type { SettingsSection } from './settingsRemoteConfigTypes';
import { useSettingsRemoteConfigActions } from './useSettingsRemoteConfigActions';
import { useSettingsRemoteConfigControllers } from './useSettingsRemoteConfigControllers';

export type { SettingsSection } from './settingsRemoteConfigTypes';

type TranslationFn = (key: string, params?: any) => string;

type UseSettingsRemoteConfigFlowParams = {
  section: SettingsSection;
  setSection: React.Dispatch<React.SetStateAction<SettingsSection>>;
  routeParams?: { serverId?: string; section?: SettingsSection };
  t: TranslationFn;
};

export function useSettingsRemoteConfigFlow({
  section,
  setSection,
  routeParams,
  t,
}: UseSettingsRemoteConfigFlowParams) {
  const controllerState = useSettingsRemoteConfigControllers({ setSection, t });
  const actionState = useSettingsRemoteConfigActions({
    section,
    setSection,
    routeParams,
    t,
    mcpServers: controllerState.mcpServers,
    editingWorkspace: controllerState.editingWorkspace,
    editingSsh: controllerState.editingSsh,
    editingBrowser: controllerState.editingBrowser,
    editingExpoAccount: controllerState.editingExpoAccount,
    editingExpoProject: controllerState.editingExpoProject,
    editingMcp: controllerState.editingMcp,
    openNewMcpConfig: controllerState.openNewMcpConfig,
    openEditMcpConfig: controllerState.openEditMcpConfig,
    resetMcpEditor: controllerState.resetMcpEditor,
    resetMcpOauthSession: controllerState.resetMcpOauthSession,
    saveMcpConfig: controllerState.saveMcpConfig,
    removeMcpConfig: controllerState.removeMcpConfig,
    openNewSshConfig: controllerState.openNewSshConfig,
    openEditSshConfig: controllerState.openEditSshConfig,
    resetSshEditor: controllerState.resetSshEditor,
    fetchSshFingerprint: controllerState.fetchSshFingerprint,
    saveSshConfig: controllerState.saveSshConfig,
    removeSshConfig: controllerState.removeSshConfig,
    openNewWorkspaceConfig: controllerState.openNewWorkspaceConfig,
    openEditWorkspaceConfig: controllerState.openEditWorkspaceConfig,
    resetWorkspaceEditor: controllerState.resetWorkspaceEditor,
    saveWorkspaceConfig: controllerState.saveWorkspaceConfig,
    removeWorkspaceConfig: controllerState.removeWorkspaceConfig,
    openNewBrowserConfig: controllerState.openNewBrowserConfig,
    openEditBrowserConfig: controllerState.openEditBrowserConfig,
    resetBrowserEditor: controllerState.resetBrowserEditor,
    saveBrowserConfig: controllerState.saveBrowserConfig,
    removeBrowserConfig: controllerState.removeBrowserConfig,
    openNewExpoAccountConfig: controllerState.openNewExpoAccountConfig,
    openNewExpoProjectConfig: controllerState.openNewExpoProjectConfig,
    openEditExpoAccountConfig: controllerState.openEditExpoAccountConfig,
    openEditExpoProjectConfig: controllerState.openEditExpoProjectConfig,
    resetExpoEditor: controllerState.resetExpoEditor,
    toggleExpoProjectPlatformSelection: controllerState.toggleExpoProjectPlatformSelection,
    syncExpoAccountConfig: controllerState.syncExpoAccountConfig,
    saveExpoAccountConfig: controllerState.saveExpoAccountConfig,
    removeExpoAccountConfig: controllerState.removeExpoAccountConfig,
    saveExpoProjectConfig: controllerState.saveExpoProjectConfig,
    removeExpoProjectConfig: controllerState.removeExpoProjectConfig,
  });

  const modalGroups = {
    visibility: {
      showWorkspaceEditor: actionState.showWorkspaceEditor,
      showBrowserEditor: actionState.showBrowserEditor,
      showExpoEditor: actionState.showExpoEditor,
      showMcpEditor: actionState.showMcpEditor,
      showSshEditor: actionState.showSshEditor,
    },
    workspace: {
      editingWorkspace: controllerState.editingWorkspace,
      workspaceTargets: controllerState.workspaceTargets,
      browserProviders: controllerState.browserProviders,
      sshTargets: controllerState.sshTargets,
      workspaceAccessToken: controllerState.workspaceAccessToken,
      workspaceConfigRootsText: controllerState.workspaceConfigRootsText,
      closeWorkspaceEditor: actionState.closeWorkspaceEditor,
      setEditingWorkspace: controllerState.setEditingWorkspace,
      setWorkspaceAccessToken: controllerState.setWorkspaceAccessToken,
      setWorkspaceConfigRootsText: controllerState.setWorkspaceConfigRootsText,
      getLocalizedWorkspaceProviderLabel: controllerState.getLocalizedWorkspaceProviderLabel,
      getWorkspaceAuthModeLabel: controllerState.getWorkspaceAuthModeLabel,
      handleDeleteWorkspace: actionState.handleDeleteWorkspace,
      handleSaveWorkspace: actionState.handleSaveWorkspace,
    },
    ssh: {
      editingSsh: controllerState.editingSsh,
      sshTargets: controllerState.sshTargets,
      sshPortText: controllerState.sshPortText,
      sshPassword: controllerState.sshPassword,
      sshPrivateKey: controllerState.sshPrivateKey,
      sshPassphrase: controllerState.sshPassphrase,
      sshFingerprintPending: controllerState.sshFingerprintPending,
      closeSshEditor: actionState.closeSshEditor,
      setEditingSsh: controllerState.setEditingSsh,
      setSshPortText: controllerState.setSshPortText,
      setSshPassword: controllerState.setSshPassword,
      setSshPrivateKey: controllerState.setSshPrivateKey,
      setSshPassphrase: controllerState.setSshPassphrase,
      getLocalizedSshHostKeyPolicyOptionLabel:
        controllerState.getLocalizedSshHostKeyPolicyOptionLabel,
      handleDeleteSsh: actionState.handleDeleteSsh,
      handleFetchSshFingerprint: actionState.handleFetchSshFingerprint,
      handleSaveSsh: actionState.handleSaveSsh,
    },
    browser: {
      editingBrowser: controllerState.editingBrowser,
      browserProviders: controllerState.browserProviders,
      browserApiKey: controllerState.browserApiKey,
      closeBrowserEditor: actionState.closeBrowserEditor,
      setEditingBrowser: controllerState.setEditingBrowser,
      setBrowserApiKey: controllerState.setBrowserApiKey,
      getLocalizedBrowserAuthModeLabel: controllerState.getLocalizedBrowserAuthModeLabel,
      handleDeleteBrowserProvider: actionState.handleDeleteBrowserProvider,
      handleSaveBrowserProvider: actionState.handleSaveBrowserProvider,
    },
    expo: {
      editingExpoAccount: controllerState.editingExpoAccount,
      editingExpoProject: controllerState.editingExpoProject,
      expoAccounts: controllerState.expoAccounts,
      expoProjects: controllerState.expoProjects,
      expoAccountToken: controllerState.expoAccountToken,
      sshTargets: controllerState.sshTargets,
      closeExpoEditor: actionState.closeExpoEditor,
      setEditingExpoAccount: controllerState.setEditingExpoAccount,
      setExpoAccountToken: controllerState.setExpoAccountToken,
      setEditingExpoProject: controllerState.setEditingExpoProject,
      getLocalizedExpoModeLabel: controllerState.getLocalizedExpoModeLabel,
      handleDeleteExpoAccount: actionState.handleDeleteExpoAccount,
      handleDeleteExpoProject: actionState.handleDeleteExpoProject,
      handleEditExpoAccount: actionState.handleEditExpoAccount,
      handleEditExpoProject: actionState.handleEditExpoProject,
      handleSaveExpoAccount: actionState.handleSaveExpoAccount,
      handleSaveExpoProject: actionState.handleSaveExpoProject,
      handleSyncExpoAccount: actionState.handleSyncExpoAccount,
      toggleExpoPlatform: actionState.toggleExpoPlatform,
    },
    mcp: {
      editingMcp: controllerState.editingMcp,
      mcpServers: controllerState.mcpServers,
      mcpHeadersText: controllerState.mcpHeadersText,
      mcpOauthClientSecret: controllerState.mcpOauthClientSecret,
      mcpTimeoutText: controllerState.mcpTimeoutText,
      hasStoredMcpOauthSession: controllerState.hasStoredMcpOauthSession,
      mcpMetadataChips: controllerState.mcpMetadataChips,
      closeMcpEditor: actionState.closeMcpEditor,
      setEditingMcp: controllerState.setEditingMcp,
      setMcpHeadersText: controllerState.setMcpHeadersText,
      setMcpOauthClientSecret: controllerState.setMcpOauthClientSecret,
      setMcpTimeoutText: controllerState.setMcpTimeoutText,
      getLocalizedMcpTransportLabel: controllerState.getLocalizedMcpTransportLabel,
      handleDeleteMcp: actionState.handleDeleteMcp,
      handleSaveMcp: actionState.handleSaveMcp,
      handleResetMcpOAuthSession: actionState.handleResetMcpOAuthSession,
    },
  } as const;

  return {
    ...controllerState,
    ...actionState,
    modalGroups,
  };
}
