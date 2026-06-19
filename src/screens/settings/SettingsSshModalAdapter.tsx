import React from 'react';

import { RemoteConfigSshModal } from '../../features/remoteConfig/components/RemoteConfigSshModal';
import type { SshTargetConfig } from '../../types/remote';
import type { SettingsRemoteConfigModalSharedProps } from './settingsRemoteConfigModalShared';

type SettingsSshModalAdapterProps = SettingsRemoteConfigModalSharedProps & {
  isWide: boolean;
  showSshEditor: boolean;
  editingSsh: SshTargetConfig | null;
  sshTargets: SshTargetConfig[];
  sshPortText: string;
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  sshFingerprintPending: boolean;
  closeSshEditor: () => void;
  setEditingSsh: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPortText: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  setSshPassphrase: (value: string) => void;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  handleDeleteSsh: (id: string) => void | Promise<void>;
  handleFetchSshFingerprint: () => void | Promise<void>;
  handleSaveSsh: () => void | Promise<void>;
};

export const SettingsSshModalAdapter: React.FC<SettingsSshModalAdapterProps> = ({
  isWide,
  showSshEditor,
  editingSsh,
  sshTargets,
  sshPortText,
  sshPassword,
  sshPrivateKey,
  sshPassphrase,
  sshFingerprintPending,
  closeSshEditor,
  setEditingSsh,
  setSshPortText,
  setSshPassword,
  setSshPrivateKey,
  setSshPassphrase,
  getLocalizedSshHostKeyPolicyOptionLabel,
  handleDeleteSsh,
  handleFetchSshFingerprint,
  handleSaveSsh,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  const isExisting = Boolean(
    editingSsh && sshTargets.some((target) => target.id === editingSsh.id),
  );

  return (
    <RemoteConfigSshModal
      showSshEditor={showSshEditor}
      sshDraft={editingSsh}
      sshEditorIsExisting={isExisting}
      isWide={isWide}
      sshPortText={sshPortText}
      sshPassword={sshPassword}
      sshPrivateKey={sshPrivateKey}
      sshPassphrase={sshPassphrase}
      sshFingerprintPending={sshFingerprintPending}
      closeSshEditor={closeSshEditor}
      sshCloseAccessibilityLabel={t('common.back')}
      sshCloseIcon="back"
      sshDeleteButtonLabel={t('settings.deleteSshTarget')}
      setSshDraft={setEditingSsh}
      setSshPortText={setSshPortText}
      setSshPassword={setSshPassword}
      setSshPrivateKey={setSshPrivateKey}
      setSshPassphrase={setSshPassphrase}
      getLocalizedSshHostKeyPolicyOptionLabel={getLocalizedSshHostKeyPolicyOptionLabel}
      handleDeleteSshConfig={handleDeleteSsh}
      handleFetchFingerprint={handleFetchSshFingerprint}
      handleResetFingerprint={() =>
        setEditingSsh((current) =>
          current ? { ...current, trustedHostFingerprint: undefined } : current,
        )
      }
      handleSaveSshConfig={handleSaveSsh}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
