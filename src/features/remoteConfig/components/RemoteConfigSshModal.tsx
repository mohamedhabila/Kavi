import React from 'react';

import { RemoteWorkSshEditorModal } from '../editors/SshEditorModal';
import type { RemoteConfigModalsProps } from './RemoteConfigModals';

type RemoteConfigSshModalProps = Pick<
  RemoteConfigModalsProps,
  | 'showSshEditor'
  | 'sshDraft'
  | 'sshEditorIsExisting'
  | 'isWide'
  | 'sshPortText'
  | 'sshPassword'
  | 'sshPrivateKey'
  | 'sshPassphrase'
  | 'sshFingerprintPending'
  | 'closeSshEditor'
  | 'sshCloseAccessibilityLabel'
  | 'sshCloseIcon'
  | 'sshDeleteButtonLabel'
  | 'setSshDraft'
  | 'setSshPassphrase'
  | 'setSshPassword'
  | 'setSshPortText'
  | 'setSshPrivateKey'
  | 'getLocalizedSshHostKeyPolicyOptionLabel'
  | 'handleDeleteSshConfig'
  | 'handleFetchFingerprint'
  | 'handleResetFingerprint'
  | 'handleSaveSshConfig'
  | 'colors'
  | 'styles'
  | 'shellStyles'
  | 't'
>;

export const RemoteConfigSshModal: React.FC<RemoteConfigSshModalProps> = ({
  showSshEditor,
  sshDraft,
  sshEditorIsExisting,
  isWide,
  sshPortText,
  sshPassword,
  sshPrivateKey,
  sshPassphrase,
  sshFingerprintPending,
  closeSshEditor,
  sshCloseAccessibilityLabel,
  sshCloseIcon,
  sshDeleteButtonLabel,
  setSshDraft,
  setSshPassphrase,
  setSshPassword,
  setSshPortText,
  setSshPrivateKey,
  getLocalizedSshHostKeyPolicyOptionLabel,
  handleDeleteSshConfig,
  handleFetchFingerprint,
  handleResetFingerprint,
  handleSaveSshConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteWorkSshEditorModal
      visible={showSshEditor}
      draft={sshDraft}
      isExisting={sshEditorIsExisting}
      isWide={isWide}
      sshPortText={sshPortText}
      sshPassword={sshPassword}
      sshPrivateKey={sshPrivateKey}
      sshPassphrase={sshPassphrase}
      sshFingerprintPending={sshFingerprintPending}
      closeEditor={closeSshEditor}
      closeAccessibilityLabel={sshCloseAccessibilityLabel}
      closeIcon={sshCloseIcon}
      deleteButtonLabel={sshDeleteButtonLabel}
      setDraft={setSshDraft}
      setSshPassphrase={setSshPassphrase}
      setSshPassword={setSshPassword}
      setSshPortText={setSshPortText}
      setSshPrivateKey={setSshPrivateKey}
      getLocalizedSshHostKeyPolicyOptionLabel={getLocalizedSshHostKeyPolicyOptionLabel}
      handleDeleteSshConfig={handleDeleteSshConfig}
      handleFetchFingerprint={handleFetchFingerprint}
      handleResetFingerprint={handleResetFingerprint}
      handleSaveSshConfig={handleSaveSshConfig}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
