import type { RemoteConfigSettingsSlice } from '../../features/remoteConfig/hooks/useRemoteConfigStore';

import { useRemoteWorkConfigStudioActions } from './useRemoteWorkConfigStudioActions';
import { useRemoteWorkConfigStudioControllers } from './useRemoteWorkConfigStudioControllers';

type TranslationFn = (key: string, params?: any) => string;

type UseRemoteWorkConfigStudioFlowParams = {
  settings: RemoteConfigSettingsSlice;
  t: TranslationFn;
  clearWorkspaceProbeResult: (id: string) => void;
};

export function useRemoteWorkConfigStudioFlow({
  settings,
  t,
  clearWorkspaceProbeResult,
}: UseRemoteWorkConfigStudioFlowParams) {
  const controllerState = useRemoteWorkConfigStudioControllers({
    settings,
    t,
    clearWorkspaceProbeResult,
  });
  const actionState = useRemoteWorkConfigStudioActions(controllerState);
  const browserProviders = settings.browserProviders ?? [];
  const sshTargets = settings.sshTargets ?? [];
  const expoAccounts = settings.expoAccounts ?? [];
  const expoProjects = settings.expoProjects ?? [];

  const modalGroups = {
    visibility: {
      showWorkspaceEditor: controllerState.isWorkspaceEditorVisible,
      showSshEditor: controllerState.isSshEditorVisible,
      showBrowserEditor: controllerState.isBrowserEditorVisible,
      showExpoEditor: controllerState.isExpoEditorVisible,
      showMcpEditor: controllerState.isMcpEditorVisible,
    },
    workspace: {
      workspaceDraft: controllerState.workspaceDraft,
      workspaceEditorIsExisting: controllerState.workspaceEditorIsExisting,
      browserProviders,
      sshTargets,
      workspaceAccessToken: controllerState.workspaceAccessToken,
      workspaceConfigRootsText: controllerState.workspaceConfigRootsText,
      closeWorkspaceEditor: actionState.closeWorkspaceEditor,
      setWorkspaceDraft: controllerState.setWorkspaceDraft,
      setWorkspaceAccessToken: controllerState.setWorkspaceAccessToken,
      setWorkspaceConfigRootsText: controllerState.setWorkspaceConfigRootsText,
      getLocalizedWorkspaceProviderLabel: controllerState.getLocalizedWorkspaceProviderLabel,
      getWorkspaceAuthModeLabel: controllerState.getWorkspaceAuthModeLabel,
      handleDeleteWorkspaceConfig: actionState.handleDeleteWorkspaceConfig,
      handleSaveWorkspaceConfig: actionState.handleSaveWorkspaceConfig,
    },
    ssh: {
      sshDraft: controllerState.sshDraft,
      sshEditorIsExisting: controllerState.sshEditorIsExisting,
      sshPortText: controllerState.sshPortText,
      sshPassword: controllerState.sshPassword,
      sshPrivateKey: controllerState.sshPrivateKey,
      sshPassphrase: controllerState.sshPassphrase,
      sshFingerprintPending: controllerState.sshFingerprintPending,
      closeSshEditor: actionState.closeSshEditor,
      setSshDraft: controllerState.setSshDraft,
      setSshPassphrase: controllerState.setSshPassphrase,
      setSshPassword: controllerState.setSshPassword,
      setSshPortText: controllerState.setSshPortText,
      setSshPrivateKey: controllerState.setSshPrivateKey,
      getLocalizedSshHostKeyPolicyOptionLabel:
        controllerState.getLocalizedSshHostKeyPolicyOptionLabel,
      handleDeleteSshConfig: actionState.handleDeleteSshConfig,
      handleFetchFingerprint: actionState.handleFetchFingerprint,
      handleSaveSshConfig: actionState.handleSaveSshConfig,
    },
    browser: {
      browserDraft: controllerState.browserDraft,
      browserEditorIsExisting: controllerState.browserEditorIsExisting,
      browserApiKey: controllerState.browserApiKey,
      closeBrowserEditor: actionState.closeBrowserEditor,
      setBrowserDraft: controllerState.setBrowserDraft,
      setBrowserApiKey: controllerState.setBrowserApiKey,
      getLocalizedBrowserAuthModeLabel: controllerState.getLocalizedBrowserAuthModeLabel,
      handleDeleteBrowserConfig: actionState.handleDeleteBrowserConfig,
      handleSaveBrowserConfig: actionState.handleSaveBrowserConfig,
    },
    expo: {
      expoAccountDraft: controllerState.expoAccountDraft,
      expoProjectDraft: controllerState.expoProjectDraft,
      expoAccountEditorIsExisting: controllerState.expoAccountEditorIsExisting,
      expoProjectEditorIsExisting: controllerState.expoProjectEditorIsExisting,
      expoAccountToken: controllerState.expoAccountToken,
      expoAccounts,
      expoProjects,
      closeExpoEditor: actionState.closeExpoEditor,
      setExpoAccountDraft: controllerState.setExpoAccountDraft,
      setExpoAccountToken: controllerState.setExpoAccountToken,
      setExpoProjectDraft: controllerState.setExpoProjectDraft,
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
      mcpDraft: controllerState.mcpDraft,
      mcpEditorIsExisting: controllerState.mcpEditorIsExisting,
      mcpToken: controllerState.mcpToken,
      mcpHeadersText: controllerState.mcpHeadersText,
      mcpTimeoutText: controllerState.mcpTimeoutText,
      mcpOauthClientSecret: controllerState.mcpOauthClientSecret,
      mcpMetadataChips: controllerState.mcpMetadataChips,
      hasStoredMcpOauthSession: controllerState.hasStoredMcpOauthSession,
      closeMcpEditor: actionState.closeMcpEditor,
      setMcpDraft: controllerState.setMcpDraft,
      setMcpToken: controllerState.setMcpToken,
      setMcpHeadersText: controllerState.setMcpHeadersText,
      setMcpTimeoutText: controllerState.setMcpTimeoutText,
      setMcpOauthClientSecret: controllerState.setMcpOauthClientSecret,
      getLocalizedMcpTransportLabel: controllerState.getLocalizedMcpTransportLabel,
      handleResetMcpOAuthSession: actionState.handleResetMcpOAuthSession,
      handleDeleteMcpConfig: actionState.handleDeleteMcpConfig,
      handleSaveMcpConfig: actionState.handleSaveMcpConfig,
    },
  };

  return {
    ...controllerState,
    ...actionState,
    modalGroups,
  };
}
