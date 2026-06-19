import { useCallback, useEffect, useMemo, useState } from 'react';

import { useBrowserConfigController } from '../../features/remoteConfig/hooks/useBrowserConfigController';
import type { TranslationFn as RemoteConfigTranslationFn } from '../../features/remoteConfig/hooks/useRemoteConfigControllerShared';
import { useExpoConfigController } from '../../features/remoteConfig/hooks/useExpoConfigController';
import { useMcpConfigController } from '../../features/remoteConfig/hooks/useMcpConfigController';
import type { RemoteConfigSettingsSlice } from '../../features/remoteConfig/hooks/useRemoteConfigStore';
import { useSshConfigController } from '../../features/remoteConfig/hooks/useSshConfigController';
import { useWorkspaceConfigController } from '../../features/remoteConfig/hooks/useWorkspaceConfigController';
import { createRemoteConfigPresentation } from '../../features/remoteConfig/presentation';
import { normalizeMcpServerConfigMetadata } from '../../services/mcp/metadata';
import { resolveDefaultWorkspaceTargetId } from '../../services/workspaces/config';
import { useSecureDraftValue } from '../useSecureDraftValue';
import type { ConfigSurface } from './remoteWorkConfigStudioTypes';

type TranslationFn = (key: string, params?: any) => string;

type UseRemoteWorkConfigStudioControllersParams = {
  settings: RemoteConfigSettingsSlice;
  t: TranslationFn;
  clearWorkspaceProbeResult: (id: string) => void;
};

export function useRemoteWorkConfigStudioControllers({
  settings,
  t,
  clearWorkspaceProbeResult,
}: UseRemoteWorkConfigStudioControllersParams) {
  const translateRemoteConfig: RemoteConfigTranslationFn = useCallback(
    (key: string, params?: Record<string, unknown>) =>
      t(key, params as Record<string, string | number> | undefined),
    [t],
  );
  const workspaceTargets = useMemo(
    () => settings.workspaceTargets ?? [],
    [settings.workspaceTargets],
  );
  const resolvedDefaultWorkspaceTargetId = resolveDefaultWorkspaceTargetId({
    defaultWorkspaceTargetId: settings.defaultWorkspaceTargetId,
    workspaceTargets,
  });

  const [activeConfigSurface, setActiveConfigSurface] = useState<ConfigSurface>('workspace');
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState<string | null>(
    resolvedDefaultWorkspaceTargetId,
  );
  const [isWorkspaceEditorVisible, setIsWorkspaceEditorVisible] = useState(false);
  const [isSshEditorVisible, setIsSshEditorVisible] = useState(false);
  const [isBrowserEditorVisible, setIsBrowserEditorVisible] = useState(false);
  const [isExpoEditorVisible, setIsExpoEditorVisible] = useState(false);
  const [isMcpEditorVisible, setIsMcpEditorVisible] = useState(false);

  const setSelectedWorkspaceId = useCallback(
    (id: string | null) => {
      setSelectedWorkspaceIdState(id);
      if (id !== null) {
        settings.setDefaultWorkspaceTargetId(id);
      }
    },
    [settings],
  );

  const workspaceController = useWorkspaceConfigController({
    settings,
    t: translateRemoteConfig,
    onSaved: (target) => {
      setSelectedWorkspaceId(target.id);
      clearWorkspaceProbeResult(target.id);
      setIsWorkspaceEditorVisible(false);
    },
    onDeleted: (id) => {
      setSelectedWorkspaceIdState((current) => (current === id ? null : current));
      clearWorkspaceProbeResult(id);
      setIsWorkspaceEditorVisible(false);
    },
  });
  const sshController = useSshConfigController({
    settings,
    t: translateRemoteConfig,
    onSaved: () => setIsSshEditorVisible(false),
    onDeleted: () => setIsSshEditorVisible(false),
  });
  const browserController = useBrowserConfigController({
    settings,
    t: translateRemoteConfig,
    onSaved: () => setIsBrowserEditorVisible(false),
    onDeleted: () => setIsBrowserEditorVisible(false),
  });
  const expoController = useExpoConfigController({
    settings,
    t: translateRemoteConfig,
    projectEditorShowsAccount: true,
    refreshDraftsAfterSync: true,
    onAccountSaved: () => setIsExpoEditorVisible(false),
    onAccountDeleted: () => setIsExpoEditorVisible(false),
    onProjectSaved: () => setIsExpoEditorVisible(false),
    onProjectDeleted: () => setIsExpoEditorVisible(false),
  });
  const mcpController = useMcpConfigController({
    settings,
    t: translateRemoteConfig,
    requireUrl: true,
    onSaved: () => setIsMcpEditorVisible(false),
    onDeleted: () => setIsMcpEditorVisible(false),
  });

  useSecureDraftValue({
    enabled: isWorkspaceEditorVisible && workspaceController.draft?.authMode !== 'none',
    secureRef: workspaceController.draft?.accessTokenRef,
    setValue: workspaceController.setWorkspaceAccessToken,
  });
  useSecureDraftValue({
    enabled: isBrowserEditorVisible && browserController.draft?.authMode !== 'none',
    secureRef: browserController.draft?.apiKeyRef,
    setValue: browserController.setBrowserApiKey,
  });
  useSecureDraftValue({
    enabled: Boolean(expoController.expoAccountDraft),
    secureRef: expoController.expoAccountDraft?.tokenRef,
    setValue: expoController.setExpoAccountToken,
  });

  useEffect(() => {
    if (workspaceTargets.length === 0) {
      if (selectedWorkspaceId !== null) {
        setSelectedWorkspaceIdState(null);
      }
      return;
    }

    const nextSelectedWorkspaceId =
      resolvedDefaultWorkspaceTargetId &&
      workspaceTargets.some((target) => target.id === resolvedDefaultWorkspaceTargetId)
        ? resolvedDefaultWorkspaceTargetId
        : selectedWorkspaceId && workspaceTargets.some((target) => target.id === selectedWorkspaceId)
          ? selectedWorkspaceId
          : workspaceTargets[0].id;

    if (nextSelectedWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceIdState(nextSelectedWorkspaceId);
    }
  }, [resolvedDefaultWorkspaceTargetId, selectedWorkspaceId, workspaceTargets]);

  const normalizedEditingMcp = useMemo(
    () => (mcpController.draft ? normalizeMcpServerConfigMetadata(mcpController.draft) : null),
    [mcpController.draft],
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
    activeConfigSurface,
    setActiveConfigSurface,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    isWorkspaceEditorVisible,
    setIsWorkspaceEditorVisible,
    isSshEditorVisible,
    setIsSshEditorVisible,
    isBrowserEditorVisible,
    setIsBrowserEditorVisible,
    isExpoEditorVisible,
    setIsExpoEditorVisible,
    isMcpEditorVisible,
    setIsMcpEditorVisible,
    workspaceDraft: workspaceController.draft,
    setWorkspaceDraft: workspaceController.setDraft,
    workspaceConfigRootsText: workspaceController.workspaceConfigRootsText,
    setWorkspaceConfigRootsText: workspaceController.setWorkspaceConfigRootsText,
    workspaceAccessToken: workspaceController.workspaceAccessToken,
    setWorkspaceAccessToken: workspaceController.setWorkspaceAccessToken,
    workspaceEditorIsExisting: workspaceController.isExisting,
    openNewWorkspaceConfig: workspaceController.openNew,
    openEditWorkspaceConfig: workspaceController.openEdit,
    clearWorkspaceEditorState: workspaceController.close,
    saveWorkspaceConfig: workspaceController.save,
    removeWorkspaceConfig: workspaceController.remove,
    sshDraft: sshController.draft,
    setSshDraft: sshController.setDraft,
    sshPortText: sshController.sshPortText,
    setSshPortText: sshController.setSshPortText,
    sshPassword: sshController.sshPassword,
    setSshPassword: sshController.setSshPassword,
    sshPrivateKey: sshController.sshPrivateKey,
    setSshPrivateKey: sshController.setSshPrivateKey,
    sshPassphrase: sshController.sshPassphrase,
    setSshPassphrase: sshController.setSshPassphrase,
    sshFingerprintPending: sshController.sshFingerprintPending,
    sshEditorIsExisting: sshController.isExisting,
    openNewSshConfig: sshController.openNew,
    openEditSshConfig: sshController.openEdit,
    clearSshEditorState: sshController.close,
    fetchSshFingerprint: sshController.fetchFingerprint,
    saveSshConfig: sshController.save,
    removeSshConfig: sshController.remove,
    browserDraft: browserController.draft,
    setBrowserDraft: browserController.setDraft,
    browserApiKey: browserController.browserApiKey,
    setBrowserApiKey: browserController.setBrowserApiKey,
    browserEditorIsExisting: browserController.isExisting,
    openNewBrowserConfig: browserController.openNew,
    openEditBrowserConfig: browserController.openEdit,
    clearBrowserEditorState: browserController.close,
    saveBrowserConfig: browserController.save,
    removeBrowserConfig: browserController.remove,
    expoAccountDraft: expoController.expoAccountDraft,
    setExpoAccountDraft: expoController.setExpoAccountDraft,
    expoAccountToken: expoController.expoAccountToken,
    setExpoAccountToken: expoController.setExpoAccountToken,
    expoProjectDraft: expoController.expoProjectDraft,
    setExpoProjectDraft: expoController.setExpoProjectDraft,
    expoAccountEditorIsExisting: expoController.accountIsExisting,
    expoProjectEditorIsExisting: expoController.projectIsExisting,
    openExpoStudio: expoController.openNew,
    openEditExpoAccountConfig: expoController.openEditAccount,
    openEditExpoProjectConfig: expoController.openEditProject,
    clearExpoEditorState: expoController.close,
    toggleExpoProjectPlatformSelection: expoController.togglePlatform,
    syncExpoAccountConfig: expoController.syncAccount,
    saveExpoAccountConfig: expoController.saveAccount,
    removeExpoAccountConfig: expoController.removeAccount,
    saveExpoProjectConfig: expoController.saveProject,
    removeExpoProjectConfig: expoController.removeProject,
    mcpDraft: mcpController.draft,
    setMcpDraft: mcpController.setDraft,
    mcpToken: mcpController.mcpToken,
    setMcpToken: mcpController.setMcpToken,
    mcpHeadersText: mcpController.mcpHeadersText,
    setMcpHeadersText: mcpController.setMcpHeadersText,
    mcpTimeoutText: mcpController.mcpTimeoutText,
    setMcpTimeoutText: mcpController.setMcpTimeoutText,
    mcpOauthClientSecret: mcpController.mcpOauthClientSecret,
    setMcpOauthClientSecret: mcpController.setMcpOauthClientSecret,
    hasStoredMcpOauthSession: mcpController.hasStoredMcpOauthSession,
    mcpEditorIsExisting: mcpController.isExisting,
    openNewMcpConfig: mcpController.openNew,
    openEditMcpConfig: mcpController.openEdit,
    clearMcpEditorState: mcpController.close,
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

export type RemoteWorkConfigStudioControllerState = ReturnType<
  typeof useRemoteWorkConfigStudioControllers
>;
