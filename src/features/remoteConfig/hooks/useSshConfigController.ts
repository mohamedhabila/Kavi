import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { createSshDraft, prepareSshDraft } from '../../../screens/configDrafts';
import { getSshHostFingerprint } from '../../../services/ssh/connector';
import { deleteSecure, saveSecure } from '../../../services/storage/SecureStorage';
import type { SshTargetConfig } from '../../../types/remote';
import { SharedControllerOptions, confirmDeletion } from './useRemoteConfigControllerShared';

export function useSshConfigController(
  options: SharedControllerOptions & {
    onSaved?: (target: SshTargetConfig) => void;
    onDeleted?: (id: string) => void;
  },
) {
  const { settings, t, onSaved, onDeleted } = options;
  const [draft, setDraft] = useState<SshTargetConfig | null>(null);
  const [sshPortText, setSshPortText] = useState('22');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [sshFingerprintPending, setSshFingerprintPending] = useState(false);

  const close = useCallback(() => {
    setDraft(null);
    setSshPortText('22');
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
    setSshFingerprintPending(false);
  }, []);

  const openNew = useCallback((overrides: Partial<SshTargetConfig> = {}) => {
    const nextDraft = createSshDraft(overrides);
    setDraft(nextDraft);
    setSshPortText(String(nextDraft.port || 22));
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
  }, []);

  const openEdit = useCallback((target: SshTargetConfig) => {
    setDraft(prepareSshDraft(target));
    setSshPortText(String(target.port || 22));
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
  }, []);

  const fetchFingerprint = useCallback(async () => {
    if (!draft) return null;
    const host = draft.host.trim();
    const username = draft.username.trim();
    const port = Number.parseInt(sshPortText, 10);

    if (!host) {
      Alert.alert(t('common.error'), t('settings.sshHostRequired'));
      return null;
    }
    if (!username) {
      Alert.alert(t('common.error'), t('settings.sshUsernameRequired'));
      return null;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      Alert.alert(t('common.error'), t('settings.sshPortInvalid'));
      return null;
    }

    setSshFingerprintPending(true);
    try {
      const fingerprint = await getSshHostFingerprint({ host, username, port });
      setDraft((current) =>
        current ? { ...current, trustedHostFingerprint: fingerprint } : current,
      );
      return fingerprint;
    } catch (error) {
      Alert.alert(
        t('common.error'),
        error instanceof Error ? error.message : t('settings.sshFingerprintFetchFailed'),
      );
      return null;
    } finally {
      setSshFingerprintPending(false);
    }
  }, [draft, sshPortText, t]);

  const save = useCallback(async () => {
    if (!draft) return null;
    const host = draft.host.trim();
    const username = draft.username.trim();
    const port = Number.parseInt(sshPortText, 10);
    const hostKeyPolicy = draft.hostKeyPolicy || 'trust-on-first-use';
    const trustedHostFingerprint =
      draft.trustedHostFingerprint?.trim().replace(/-/g, ':').toUpperCase() || undefined;
    const authMode = draft.authMode || 'password';
    const password = sshPassword.trim();
    const privateKey = sshPrivateKey.trim();
    const passphrase = sshPassphrase.trim();
    const previousTarget = (settings.sshTargets || []).find((target) => target.id === draft.id);

    if (!host) {
      Alert.alert(t('common.error'), t('settings.sshHostRequired'));
      return null;
    }
    if (!username) {
      Alert.alert(t('common.error'), t('settings.sshUsernameRequired'));
      return null;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      Alert.alert(t('common.error'), t('settings.sshPortInvalid'));
      return null;
    }
    if (hostKeyPolicy === 'strict' && !trustedHostFingerprint) {
      Alert.alert(t('common.error'), t('settings.sshFingerprintRequired'));
      return null;
    }
    if (authMode === 'password' && !password && !draft.passwordRef) {
      Alert.alert(t('common.error'), t('settings.sshPasswordRequired'));
      return null;
    }
    if (authMode === 'private-key' && !privateKey && !draft.privateKeyRef) {
      Alert.alert(t('common.error'), t('settings.sshPrivateKeyRequired'));
      return null;
    }

    const passwordRef = `ssh_password_${draft.id}`;
    const privateKeyRef = `ssh_private_key_${draft.id}`;
    const passphraseRef = `ssh_passphrase_${draft.id}`;
    try {
      if (authMode === 'password') {
        if (password) await saveSecure(passwordRef, password);
        await deleteSecure(privateKeyRef);
        await deleteSecure(passphraseRef);
      } else {
        if (privateKey) await saveSecure(privateKeyRef, privateKey);
        if (passphrase) {
          await saveSecure(passphraseRef, passphrase);
        } else {
          await deleteSecure(passphraseRef);
        }
        await deleteSecure(passwordRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return null;
    }

    const preserveFingerprint =
      !previousTarget ||
      (previousTarget.host.trim() === host && (previousTarget.port || 22) === port) ||
      trustedHostFingerprint !==
        (previousTarget.trustedHostFingerprint?.trim().replace(/-/g, ':').toUpperCase() ||
          undefined);

    const normalizedTarget: SshTargetConfig = {
      ...draft,
      host,
      username,
      port,
      remoteRoot: draft.remoteRoot?.trim() || undefined,
      hostKeyPolicy,
      trustedHostFingerprint: preserveFingerprint ? trustedHostFingerprint : undefined,
      authMode,
      passwordRef: authMode === 'password' ? draft.passwordRef || passwordRef : undefined,
      privateKeyRef: authMode === 'private-key' ? draft.privateKeyRef || privateKeyRef : undefined,
      passphraseRef:
        authMode === 'private-key' && (passphrase || draft.passphraseRef)
          ? draft.passphraseRef || passphraseRef
          : undefined,
      ptyType: draft.ptyType || 'xterm',
    };

    if ((settings.sshTargets || []).some((target) => target.id === normalizedTarget.id)) {
      settings.updateSshTarget(normalizedTarget);
    } else {
      settings.addSshTarget(normalizedTarget);
    }
    onSaved?.(normalizedTarget);
    close();
    return normalizedTarget;
  }, [close, draft, onSaved, settings, sshPassphrase, sshPassword, sshPortText, sshPrivateKey, t]);

  const remove = useCallback(
    (id: string) => {
      confirmDeletion(t, 'settings.deleteSshTargetConfirm', async () => {
        settings.removeSshTarget(id);
        await deleteSecure(`ssh_password_${id}`);
        await deleteSecure(`ssh_private_key_${id}`);
        await deleteSecure(`ssh_passphrase_${id}`);
        onDeleted?.(id);
        close();
      });
    },
    [close, onDeleted, settings, t],
  );

  const isExisting = Boolean(
    draft && (settings.sshTargets || []).some((target) => target.id === draft.id),
  );

  return {
    draft,
    setDraft,
    sshPortText,
    setSshPortText,
    sshPassword,
    setSshPassword,
    sshPrivateKey,
    setSshPrivateKey,
    sshPassphrase,
    setSshPassphrase,
    sshFingerprintPending,
    isEditorVisible: Boolean(draft),
    isExisting,
    openNew,
    openEdit,
    close,
    fetchFingerprint,
    save,
    remove,
  };
}
