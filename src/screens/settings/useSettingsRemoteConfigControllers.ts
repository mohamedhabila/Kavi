import { useCallback, useMemo } from 'react';

import { useBrowserConfigController } from '../../features/remoteConfig/hooks/useBrowserConfigController';
import type { TranslationFn as RemoteConfigTranslationFn } from '../../features/remoteConfig/hooks/useRemoteConfigControllerShared';
import { useExpoConfigController } from '../../features/remoteConfig/hooks/useExpoConfigController';
import { useMcpConfigController } from '../../features/remoteConfig/hooks/useMcpConfigController';
import { useRemoteConfigSettingsSlice } from '../../features/remoteConfig/hooks/useRemoteConfigStore';
import { useSshConfigController } from '../../features/remoteConfig/hooks/useSshConfigController';
import { useWorkspaceConfigController } from '../../features/remoteConfig/hooks/useWorkspaceConfigController';
import { createRemoteConfigPresentation } from '../../features/remoteConfig/presentation';
import { normalizeMcpServerConfigMetadata } from '../../services/mcp/metadata';
import { useSecureFieldDraft } from './shared/useSecureFieldDraft';
import type { SettingsSection } from './settingsRemoteConfigTypes';

type TranslationFn = (key: string, params?: any) => string;

type UseSettingsRemoteConfigControllersParams = {
  setSection: React.Dispatch<React.SetStateAction<SettingsSection>>;
  t: TranslationFn;
};

export function useSettingsRemoteConfigControllers({
  setSection,
  t,
}: UseSettingsRemoteConfigControllersParams) {
  const remoteConfigSettings = useRemoteConfigSettingsSlice();
  const translateRemoteConfig: RemoteConfigTranslationFn = useCallback(
    (key: string, params?: Record<string, unknown>) =>
      t(key, params as Record<string, string | number> | undefined),
    [t],
  );
  const {
    browserProviders = [],
    expoAccounts = [],
    expoProjects = [],
    mcpServers = [],
    sshTargets = [],
    workspaceTargets = [],
  } = remoteConfigSettings;

  const workspaceController = useWorkspaceConfigController({
    settings: remoteConfigSettings,
    t: translateRemoteConfig,
    onSaved: () => setSection('main'),
    onDeleted: () => setSection('main'),
  });
  const sshController = useSshConfigController({
    settings: remoteConfigSettings,
    t: translateRemoteConfig,
    onSaved: () => setSection('main'),
    onDeleted: () => setSection('main'),
  });
  const browserController = useBrowserConfigController({
    settings: remoteConfigSettings,
    t: translateRemoteConfig,
    onSaved: () => setSection('main'),
    onDeleted: () => setSection('main'),
  });
  const expoController = useExpoConfigController({
    settings: remoteConfigSettings,
    t: translateRemoteConfig,
    onAccountSaved: () => setSection('main'),
    onAccountDeleted: () => setSection('main'),
    onProjectSaved: () => setSection('main'),
    onProjectDeleted: () => setSection('main'),
  });
  const mcpController = useMcpConfigController({
    settings: remoteConfigSettings,
    t: translateRemoteConfig,
    onSaved: () => setSection('main'),
    onDeleted: () => setSection('main'),
  });

  const normalizedEditingMcp = useMemo(
    () => (mcpController.draft ? normalizeMcpServerConfigMetadata(mcpController.draft) : null),
    [mcpController.draft],
  );
  const workspaceAccessTokenDraft = useSecureFieldDraft(
    workspaceController.workspaceAccessToken,
    workspaceController.setWorkspaceAccessToken,
  );
  const sshPasswordDraft = useSecureFieldDraft(
    sshController.sshPassword,
    sshController.setSshPassword,
  );
  const sshPrivateKeyDraft = useSecureFieldDraft(
    sshController.sshPrivateKey,
    sshController.setSshPrivateKey,
  );
  const sshPassphraseDraft = useSecureFieldDraft(
    sshController.sshPassphrase,
    sshController.setSshPassphrase,
  );
  const browserApiKeyDraft = useSecureFieldDraft(
    browserController.browserApiKey,
    browserController.setBrowserApiKey,
  );
  const expoAccountTokenDraft = useSecureFieldDraft(
    expoController.expoAccountToken,
    expoController.setExpoAccountToken,
  );
  const mcpOauthClientSecretDraft = useSecureFieldDraft(
    mcpController.mcpOauthClientSecret,
    mcpController.setMcpOauthClientSecret,
  );
  const {
    getLocalizedWorkspaceProviderLabel,
    getWorkspaceAuthModeLabel,
    getLocalizedBrowserAuthModeLabel,
    getLocalizedSshHostKeyPolicyOptionLabel,
    getLocalizedMcpTransportLabel,
    getLocalizedExpoModeLabel,
    getMcpMetadataChips,
  } = useMemo(() => createRemoteConfigPresentation(translateRemoteConfig), [translateRemoteConfig]);

  return {
    browserProviders,
    expoAccounts,
    expoProjects,
    mcpServers,
    sshTargets,
    workspaceTargets,
    editingWorkspace: workspaceController.draft,
    setEditingWorkspace: workspaceController.setDraft,
    workspaceAccessToken: workspaceAccessTokenDraft.value,
    setWorkspaceAccessToken: workspaceAccessTokenDraft.setValue,
    workspaceConfigRootsText: workspaceController.workspaceConfigRootsText,
    setWorkspaceConfigRootsText: workspaceController.setWorkspaceConfigRootsText,
    openNewWorkspaceConfig: workspaceController.openNew,
    openEditWorkspaceConfig: workspaceController.openEdit,
    resetWorkspaceEditor: workspaceController.close,
    saveWorkspaceConfig: workspaceController.save,
    removeWorkspaceConfig: workspaceController.remove,
    editingSsh: sshController.draft,
    setEditingSsh: sshController.setDraft,
    sshPortText: sshController.sshPortText,
    setSshPortText: sshController.setSshPortText,
    sshPassword: sshPasswordDraft.value,
    setSshPassword: sshPasswordDraft.setValue,
    sshPrivateKey: sshPrivateKeyDraft.value,
    setSshPrivateKey: sshPrivateKeyDraft.setValue,
    sshPassphrase: sshPassphraseDraft.value,
    setSshPassphrase: sshPassphraseDraft.setValue,
    sshFingerprintPending: sshController.sshFingerprintPending,
    openNewSshConfig: sshController.openNew,
    openEditSshConfig: sshController.openEdit,
    resetSshEditor: sshController.close,
    fetchSshFingerprint: sshController.fetchFingerprint,
    saveSshConfig: sshController.save,
    removeSshConfig: sshController.remove,
    editingBrowser: browserController.draft,
    setEditingBrowser: browserController.setDraft,
    browserApiKey: browserApiKeyDraft.value,
    setBrowserApiKey: browserApiKeyDraft.setValue,
    openNewBrowserConfig: browserController.openNew,
    openEditBrowserConfig: browserController.openEdit,
    resetBrowserEditor: browserController.close,
    saveBrowserConfig: browserController.save,
    removeBrowserConfig: browserController.remove,
    editingExpoAccount: expoController.expoAccountDraft,
    setEditingExpoAccount: expoController.setExpoAccountDraft,
    editingExpoProject: expoController.expoProjectDraft,
    setEditingExpoProject: expoController.setExpoProjectDraft,
    expoAccountToken: expoAccountTokenDraft.value,
    setExpoAccountToken: expoAccountTokenDraft.setValue,
    openNewExpoAccountConfig: expoController.openNewAccount,
    openNewExpoProjectConfig: expoController.openNewProject,
    openEditExpoAccountConfig: expoController.openEditAccount,
    openEditExpoProjectConfig: expoController.openEditProject,
    resetExpoEditor: expoController.close,
    toggleExpoProjectPlatformSelection: expoController.togglePlatform,
    syncExpoAccountConfig: expoController.syncAccount,
    saveExpoAccountConfig: expoController.saveAccount,
    removeExpoAccountConfig: expoController.removeAccount,
    saveExpoProjectConfig: expoController.saveProject,
    removeExpoProjectConfig: expoController.removeProject,
    editingMcp: mcpController.draft,
    setEditingMcp: mcpController.setDraft,
    mcpHeadersText: mcpController.mcpHeadersText,
    setMcpHeadersText: mcpController.setMcpHeadersText,
    mcpTimeoutText: mcpController.mcpTimeoutText,
    setMcpTimeoutText: mcpController.setMcpTimeoutText,
    mcpOauthClientSecret: mcpOauthClientSecretDraft.value,
    setMcpOauthClientSecret: mcpOauthClientSecretDraft.setValue,
    hasStoredMcpOauthSession: mcpController.hasStoredMcpOauthSession,
    openNewMcpConfig: mcpController.openNew,
    openEditMcpConfig: mcpController.openEdit,
    resetMcpEditor: mcpController.close,
    resetMcpOauthSession: mcpController.resetOauthSession,
    saveMcpConfig: mcpController.save,
    removeMcpConfig: mcpController.remove,
    normalizedEditingMcp,
    mcpMetadataChips: normalizedEditingMcp ? getMcpMetadataChips(normalizedEditingMcp) : [],
    getLocalizedWorkspaceProviderLabel,
    getWorkspaceAuthModeLabel,
    getLocalizedBrowserAuthModeLabel,
    getLocalizedSshHostKeyPolicyOptionLabel,
    getLocalizedMcpTransportLabel,
    getLocalizedExpoModeLabel,
    getMcpMetadataChips,
  };
}
