import React from 'react';

import { RemoteConfigWorkspaceModal } from '../../features/remoteConfig/components/RemoteConfigWorkspaceModal';
import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import type { SettingsRemoteConfigModalSharedProps } from './settingsRemoteConfigModalShared';

type SettingsWorkspaceModalAdapterProps = SettingsRemoteConfigModalSharedProps & {
  showWorkspaceEditor: boolean;
  editingWorkspace: WorkspaceTargetConfig | null;
  workspaceTargets: WorkspaceTargetConfig[];
  browserProviders: BrowserProviderConfig[];
  sshTargets: SshTargetConfig[];
  workspaceAccessToken: string;
  workspaceConfigRootsText: string;
  closeWorkspaceEditor: () => void;
  setEditingWorkspace: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
  setWorkspaceAccessToken: (value: string) => void;
  setWorkspaceConfigRootsText: (value: string) => void;
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
  handleDeleteWorkspace: (id: string) => void;
  handleSaveWorkspace: () => void | Promise<void>;
};

export const SettingsWorkspaceModalAdapter: React.FC<SettingsWorkspaceModalAdapterProps> = ({
  showWorkspaceEditor,
  editingWorkspace,
  workspaceTargets,
  browserProviders,
  sshTargets,
  workspaceAccessToken,
  workspaceConfigRootsText,
  closeWorkspaceEditor,
  setEditingWorkspace,
  setWorkspaceAccessToken,
  setWorkspaceConfigRootsText,
  getLocalizedWorkspaceProviderLabel,
  getWorkspaceAuthModeLabel,
  handleDeleteWorkspace,
  handleSaveWorkspace,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  const isExisting = Boolean(
    editingWorkspace && workspaceTargets.some((target) => target.id === editingWorkspace.id),
  );

  return (
    <RemoteConfigWorkspaceModal
      showWorkspaceEditor={showWorkspaceEditor}
      workspaceDraft={editingWorkspace}
      workspaceEditorIsExisting={isExisting}
      workspaceTitleOverride={
        isExisting ? t('settings.editWorkspaceTarget') : t('settings.addWorkspaceTarget')
      }
      browserProviders={browserProviders}
      sshTargets={sshTargets}
      workspaceAccessToken={workspaceAccessToken}
      workspaceConfigRootsText={workspaceConfigRootsText}
      closeWorkspaceEditor={closeWorkspaceEditor}
      setWorkspaceDraft={setEditingWorkspace}
      setWorkspaceAccessToken={setWorkspaceAccessToken}
      setWorkspaceConfigRootsText={setWorkspaceConfigRootsText}
      getLocalizedWorkspaceProviderLabel={getLocalizedWorkspaceProviderLabel}
      getWorkspaceAuthModeLabel={getWorkspaceAuthModeLabel}
      handleDeleteWorkspaceConfig={handleDeleteWorkspace}
      handleSaveWorkspaceConfig={handleSaveWorkspace}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
