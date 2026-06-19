import { useEffect } from 'react';

import { getSecure } from '../../services/storage/SecureStorage';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { useSecureDraftValue } from '../useSecureDraftValue';
import type { SettingsSection } from './useSettingsRemoteConfigFlow';

type UseSettingsRemoteConfigDraftHydrationParams = {
  section: SettingsSection;
  editingWorkspace: WorkspaceTargetConfig | null;
  editingSsh: SshTargetConfig | null;
  editingBrowser: BrowserProviderConfig | null;
  editingExpoAccount: ExpoAccountConfig | null;
  setWorkspaceAccessToken: (value: string) => void;
  setBrowserApiKey: (value: string) => void;
  setExpoAccountToken: (value: string) => void;
  setSshPassword: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  setSshPassphrase: (value: string) => void;
};

export function useSettingsRemoteConfigDraftHydration({
  section,
  editingWorkspace,
  editingSsh,
  editingBrowser,
  editingExpoAccount,
  setWorkspaceAccessToken,
  setBrowserApiKey,
  setExpoAccountToken,
  setSshPassword,
  setSshPrivateKey,
  setSshPassphrase,
}: UseSettingsRemoteConfigDraftHydrationParams) {
  useEffect(() => {
    let cancelled = false;

    if (section !== 'ssh-edit' || !editingSsh) {
      setSshPassword('');
      setSshPrivateKey('');
      setSshPassphrase('');
      return undefined;
    }

    void Promise.all([
      editingSsh.passwordRef ? getSecure(editingSsh.passwordRef) : Promise.resolve(''),
      editingSsh.privateKeyRef ? getSecure(editingSsh.privateKeyRef) : Promise.resolve(''),
      editingSsh.passphraseRef ? getSecure(editingSsh.passphraseRef) : Promise.resolve(''),
    ]).then(([password, privateKey, passphrase]) => {
      if (!cancelled) {
        setSshPassword(password || '');
        setSshPrivateKey(privateKey || '');
        setSshPassphrase(passphrase || '');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [editingSsh, section, setSshPassphrase, setSshPassword, setSshPrivateKey]);

  useSecureDraftValue({
    enabled: section === 'workspace-edit' && editingWorkspace?.authMode !== 'none',
    secureRef: editingWorkspace?.accessTokenRef,
    setValue: setWorkspaceAccessToken,
  });

  useSecureDraftValue({
    enabled: section === 'browser-edit' && editingBrowser?.authMode !== 'none',
    secureRef: editingBrowser?.apiKeyRef,
    setValue: setBrowserApiKey,
  });

  useSecureDraftValue({
    enabled: section === 'expo-account-edit',
    secureRef: editingExpoAccount?.tokenRef,
    setValue: setExpoAccountToken,
  });
}
