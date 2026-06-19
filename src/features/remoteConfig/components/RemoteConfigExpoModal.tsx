import React from 'react';

import { RemoteWorkExpoEditorModal } from '../editors/ExpoEditorModal';
import type { RemoteConfigModalsProps } from './RemoteConfigModals';

type RemoteConfigExpoModalProps = Pick<
  RemoteConfigModalsProps,
  | 'showExpoEditor'
  | 'expoTitleOverride'
  | 'expoAccountDraft'
  | 'expoProjectDraft'
  | 'expoAccountEditorIsExisting'
  | 'expoProjectEditorIsExisting'
  | 'expoAccountToken'
  | 'expoAccounts'
  | 'expoProjects'
  | 'isWide'
  | 'sshTargets'
  | 'closeExpoEditor'
  | 'setExpoAccountDraft'
  | 'setExpoAccountToken'
  | 'setExpoProjectDraft'
  | 'getLocalizedExpoModeLabel'
  | 'handleDeleteExpoAccount'
  | 'handleDeleteExpoProject'
  | 'handleEditExpoAccount'
  | 'handleEditExpoProject'
  | 'handleSaveExpoAccount'
  | 'handleSaveExpoProject'
  | 'handleSyncExpoAccount'
  | 'toggleExpoPlatform'
  | 'colors'
  | 'styles'
  | 'shellStyles'
  | 't'
>;

export const RemoteConfigExpoModal: React.FC<RemoteConfigExpoModalProps> = ({
  showExpoEditor,
  expoTitleOverride,
  expoAccountDraft,
  expoProjectDraft,
  expoAccountEditorIsExisting,
  expoProjectEditorIsExisting,
  expoAccountToken,
  expoAccounts,
  expoProjects,
  isWide,
  sshTargets,
  closeExpoEditor,
  setExpoAccountDraft,
  setExpoAccountToken,
  setExpoProjectDraft,
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
  return (
    <RemoteWorkExpoEditorModal
      visible={showExpoEditor}
      titleOverride={expoTitleOverride}
      expoAccountDraft={expoAccountDraft}
      expoProjectDraft={expoProjectDraft}
      expoAccountEditorIsExisting={expoAccountEditorIsExisting}
      expoProjectEditorIsExisting={expoProjectEditorIsExisting}
      expoAccountToken={expoAccountToken}
      expoAccounts={expoAccounts}
      expoProjects={expoProjects}
      isWide={isWide}
      sshTargets={sshTargets}
      closeEditor={closeExpoEditor}
      setExpoAccountDraft={setExpoAccountDraft}
      setExpoAccountToken={setExpoAccountToken}
      setExpoProjectDraft={setExpoProjectDraft}
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
