import React from 'react';

import { RemoteWorkWorkspaceEditorModal } from '../editors/WorkspaceEditorModal';
import type { RemoteConfigModalsProps } from './RemoteConfigModals';

type RemoteConfigWorkspaceModalProps = Pick<
  RemoteConfigModalsProps,
  | 'showWorkspaceEditor'
  | 'workspaceDraft'
  | 'workspaceEditorIsExisting'
  | 'workspaceTitleOverride'
  | 'browserProviders'
  | 'sshTargets'
  | 'workspaceAccessToken'
  | 'workspaceConfigRootsText'
  | 'closeWorkspaceEditor'
  | 'setWorkspaceDraft'
  | 'setWorkspaceAccessToken'
  | 'setWorkspaceConfigRootsText'
  | 'getLocalizedWorkspaceProviderLabel'
  | 'getWorkspaceAuthModeLabel'
  | 'handleDeleteWorkspaceConfig'
  | 'handleSaveWorkspaceConfig'
  | 'colors'
  | 'styles'
  | 'shellStyles'
  | 't'
>;

export const RemoteConfigWorkspaceModal: React.FC<RemoteConfigWorkspaceModalProps> = ({
  showWorkspaceEditor,
  workspaceDraft,
  workspaceEditorIsExisting,
  workspaceTitleOverride,
  browserProviders,
  sshTargets,
  workspaceAccessToken,
  workspaceConfigRootsText,
  closeWorkspaceEditor,
  setWorkspaceDraft,
  setWorkspaceAccessToken,
  setWorkspaceConfigRootsText,
  getLocalizedWorkspaceProviderLabel,
  getWorkspaceAuthModeLabel,
  handleDeleteWorkspaceConfig,
  handleSaveWorkspaceConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteWorkWorkspaceEditorModal
      visible={showWorkspaceEditor}
      draft={workspaceDraft}
      isExisting={workspaceEditorIsExisting}
      titleOverride={workspaceTitleOverride}
      browserProviders={browserProviders}
      sshTargets={sshTargets}
      workspaceAccessToken={workspaceAccessToken}
      workspaceConfigRootsText={workspaceConfigRootsText}
      closeEditor={closeWorkspaceEditor}
      setDraft={setWorkspaceDraft}
      setWorkspaceAccessToken={setWorkspaceAccessToken}
      setWorkspaceConfigRootsText={setWorkspaceConfigRootsText}
      getLocalizedWorkspaceProviderLabel={getLocalizedWorkspaceProviderLabel}
      getWorkspaceAuthModeLabel={getWorkspaceAuthModeLabel}
      handleDeleteWorkspaceConfig={handleDeleteWorkspaceConfig}
      handleSaveWorkspaceConfig={handleSaveWorkspaceConfig}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
