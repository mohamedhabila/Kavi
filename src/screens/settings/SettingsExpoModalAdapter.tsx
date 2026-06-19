import React from 'react';

import { RemoteConfigExpoModal } from '../../features/remoteConfig/components/RemoteConfigExpoModal';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../types/remote';
import type { SettingsRemoteConfigModalSharedProps } from './settingsRemoteConfigModalShared';

type SettingsExpoModalAdapterProps = SettingsRemoteConfigModalSharedProps & {
  isWide: boolean;
  showExpoEditor: boolean;
  editingExpoAccount: ExpoAccountConfig | null;
  editingExpoProject: ExpoProjectConfig | null;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  expoAccountToken: string;
  sshTargets: SshTargetConfig[];
  closeExpoEditor: () => void;
  setEditingExpoAccount: React.Dispatch<React.SetStateAction<ExpoAccountConfig | null>>;
  setExpoAccountToken: (value: string) => void;
  setEditingExpoProject: React.Dispatch<React.SetStateAction<ExpoProjectConfig | null>>;
  getLocalizedExpoModeLabel: (mode?: ExpoProjectConfig['mode']) => string;
  handleDeleteExpoAccount: (id: string) => void;
  handleDeleteExpoProject: (id: string) => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
  handleSaveExpoAccount: () => void | Promise<void>;
  handleSaveExpoProject: () => void | Promise<void>;
  handleSyncExpoAccount: (accountId?: string) => void | Promise<void>;
  toggleExpoPlatform: (platform: 'android' | 'ios' | 'web') => void;
};

export const SettingsExpoModalAdapter: React.FC<SettingsExpoModalAdapterProps> = ({
  isWide,
  showExpoEditor,
  editingExpoAccount,
  editingExpoProject,
  expoAccounts,
  expoProjects,
  expoAccountToken,
  sshTargets,
  closeExpoEditor,
  setEditingExpoAccount,
  setExpoAccountToken,
  setEditingExpoProject,
  getLocalizedExpoModeLabel,
  handleDeleteExpoAccount,
  handleDeleteExpoProject,
  handleEditExpoAccount,
  handleEditExpoProject,
  handleSaveExpoAccount,
  handleSaveExpoProject,
  handleSyncExpoAccount,
  toggleExpoPlatform,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  const expoTitleOverride = editingExpoProject
    ? expoProjects.some((project) => project.id === editingExpoProject.id)
      ? t('settings.editExpoProject')
      : t('settings.addExpoProject')
    : editingExpoAccount
      ? expoAccounts.some((account) => account.id === editingExpoAccount.id)
        ? t('settings.editExpoAccount')
        : t('settings.addExpoAccount')
      : undefined;

  return (
    <RemoteConfigExpoModal
      showExpoEditor={showExpoEditor}
      expoTitleOverride={expoTitleOverride}
      expoAccountDraft={editingExpoAccount}
      expoProjectDraft={editingExpoProject}
      expoAccountEditorIsExisting={Boolean(
        editingExpoAccount && expoAccounts.some((account) => account.id === editingExpoAccount.id),
      )}
      expoProjectEditorIsExisting={Boolean(
        editingExpoProject && expoProjects.some((project) => project.id === editingExpoProject.id),
      )}
      expoAccountToken={expoAccountToken}
      expoAccounts={expoAccounts}
      expoProjects={expoProjects}
      isWide={isWide}
      sshTargets={sshTargets}
      closeExpoEditor={closeExpoEditor}
      setExpoAccountDraft={setEditingExpoAccount}
      setExpoAccountToken={setExpoAccountToken}
      setExpoProjectDraft={setEditingExpoProject}
      getLocalizedExpoModeLabel={getLocalizedExpoModeLabel}
      handleDeleteExpoAccount={handleDeleteExpoAccount}
      handleDeleteExpoProject={handleDeleteExpoProject}
      handleEditExpoAccount={handleEditExpoAccount}
      handleEditExpoProject={handleEditExpoProject}
      handleSaveExpoAccount={handleSaveExpoAccount}
      handleSaveExpoProject={handleSaveExpoProject}
      handleSyncExpoAccount={handleSyncExpoAccount}
      toggleExpoPlatform={toggleExpoPlatform}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
