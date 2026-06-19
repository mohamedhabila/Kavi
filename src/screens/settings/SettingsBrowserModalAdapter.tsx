import React from 'react';

import { RemoteConfigBrowserModal } from '../../features/remoteConfig/components/RemoteConfigBrowserModal';
import type { BrowserProviderConfig } from '../../types/remote';
import type { SettingsRemoteConfigModalSharedProps } from './settingsRemoteConfigModalShared';

type SettingsBrowserModalAdapterProps = SettingsRemoteConfigModalSharedProps & {
  showBrowserEditor: boolean;
  editingBrowser: BrowserProviderConfig | null;
  browserProviders: BrowserProviderConfig[];
  browserApiKey: string;
  closeBrowserEditor: () => void;
  setEditingBrowser: React.Dispatch<React.SetStateAction<BrowserProviderConfig | null>>;
  setBrowserApiKey: (value: string) => void;
  getLocalizedBrowserAuthModeLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleDeleteBrowserProvider: (id: string) => void;
  handleSaveBrowserProvider: () => void | Promise<void>;
};

export const SettingsBrowserModalAdapter: React.FC<SettingsBrowserModalAdapterProps> = ({
  showBrowserEditor,
  editingBrowser,
  browserProviders,
  browserApiKey,
  closeBrowserEditor,
  setEditingBrowser,
  setBrowserApiKey,
  getLocalizedBrowserAuthModeLabel,
  handleDeleteBrowserProvider,
  handleSaveBrowserProvider,
  colors,
  styles,
  shellStyles,
  t,
}) => {
  return (
    <RemoteConfigBrowserModal
      showBrowserEditor={showBrowserEditor}
      browserDraft={editingBrowser}
      browserEditorIsExisting={Boolean(
        editingBrowser && browserProviders.some((provider) => provider.id === editingBrowser.id),
      )}
      browserApiKey={browserApiKey}
      closeBrowserEditor={closeBrowserEditor}
      setBrowserDraft={setEditingBrowser}
      setBrowserApiKey={setBrowserApiKey}
      getLocalizedBrowserAuthModeLabel={getLocalizedBrowserAuthModeLabel}
      handleDeleteBrowserConfig={handleDeleteBrowserProvider}
      handleSaveBrowserConfig={handleSaveBrowserProvider}
      colors={colors}
      styles={styles}
      shellStyles={shellStyles}
      t={t}
    />
  );
};
