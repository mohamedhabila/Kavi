import React from 'react';

import { RemoteWorkBrowserEditorModal } from '../editors/BrowserEditorModal';
import type { RemoteConfigModalsProps } from './RemoteConfigModals';

type RemoteConfigBrowserModalProps = Pick<
  RemoteConfigModalsProps,
  | 'showBrowserEditor'
  | 'browserDraft'
  | 'browserEditorIsExisting'
  | 'browserApiKey'
  | 'closeBrowserEditor'
  | 'setBrowserDraft'
  | 'setBrowserApiKey'
  | 'getLocalizedBrowserAuthModeLabel'
  | 'handleDeleteBrowserConfig'
  | 'handleSaveBrowserConfig'
  | 'colors'
  | 'styles'
  | 'shellStyles'
  | 't'
>;

export const RemoteConfigBrowserModal: React.FC<RemoteConfigBrowserModalProps> = ({
  showBrowserEditor,
  browserDraft,
  browserEditorIsExisting,
  browserApiKey,
  closeBrowserEditor,
  setBrowserDraft,
  setBrowserApiKey,
  getLocalizedBrowserAuthModeLabel,
  handleDeleteBrowserConfig,
  handleSaveBrowserConfig,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteWorkBrowserEditorModal
      visible={showBrowserEditor}
      draft={browserDraft}
      isExisting={browserEditorIsExisting}
      browserApiKey={browserApiKey}
      closeEditor={closeBrowserEditor}
      setDraft={setBrowserDraft}
      setBrowserApiKey={setBrowserApiKey}
      getLocalizedBrowserAuthModeLabel={getLocalizedBrowserAuthModeLabel}
      handleDeleteBrowserConfig={handleDeleteBrowserConfig}
      handleSaveBrowserConfig={handleSaveBrowserConfig}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
