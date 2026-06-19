import React from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { SSH_HOST_KEY_POLICY_OPTIONS } from '../../../services/ssh/connector';
import { SSH_AUTH_MODE_OPTIONS, SSH_PTY_OPTIONS } from '../../../services/ssh/native';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { SshTargetConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

const DEFAULT_SSH_PTY_OPTIONS = [{ value: 'xterm', label: 'xterm' }] as const;

type SshAccessSectionProps = {
  draft: SshTargetConfig;
  isExisting: boolean;
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  sshFingerprintPending: boolean;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  closeEditor: () => void;
  deleteButtonLabel?: string;
  setDraft: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPassword: (value: string) => void;
  setSshPrivateKey: (value: string) => void;
  setSshPassphrase: (value: string) => void;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  handleDeleteSshConfig: (id: string) => void | Promise<void>;
  handleFetchFingerprint: () => void | Promise<void>;
  handleResetFingerprint?: () => void | Promise<void>;
  handleSaveSshConfig: () => void | Promise<void>;
};

export const SshAccessSection: React.FC<SshAccessSectionProps> = ({
  draft,
  isExisting,
  sshPassword,
  sshPrivateKey,
  sshPassphrase,
  sshFingerprintPending,
  colors,
  styles,
  t,
  closeEditor,
  deleteButtonLabel,
  setDraft,
  setSshPassword,
  setSshPrivateKey,
  setSshPassphrase,
  getLocalizedSshHostKeyPolicyOptionLabel,
  handleDeleteSshConfig,
  handleFetchFingerprint,
  handleResetFingerprint,
  handleSaveSshConfig,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceAccessSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.sshAuthMode')}</Text>
      <View style={styles.optionRow}>
        {SSH_AUTH_MODE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.optionChip,
              draft.authMode === option.value ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, authMode: option.value } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.authMode === option.value ? styles.optionChipTextActive : null,
              ]}
            >
              {t(option.labelKey as any)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {draft.authMode === 'password' ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.sshPassword')}</Text>
          <TextInput
            style={styles.configInput}
            value={sshPassword}
            onChangeText={setSshPassword}
            placeholder={
              draft.passwordRef
                ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                : t('settings.sshPasswordPlaceholder')
            }
            placeholderTextColor={colors.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : (
        <>
          <Text style={styles.detailLabel}>{t('settings.sshPrivateKey')}</Text>
          <TextInput
            style={[styles.configInput, styles.configTextArea]}
            value={sshPrivateKey}
            onChangeText={setSshPrivateKey}
            placeholder={
              draft.privateKeyRef
                ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                : t('settings.sshPrivateKeyPlaceholder')
            }
            placeholderTextColor={colors.placeholder}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.formHint}>{t('settings.sshPrivateKeyHint')}</Text>

          <Text style={styles.detailLabel}>{t('settings.sshPassphrase')}</Text>
          <TextInput
            style={styles.configInput}
            value={sshPassphrase}
            onChangeText={setSshPassphrase}
            placeholder={t('settings.sshPassphrasePlaceholder')}
            placeholderTextColor={colors.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <Text style={styles.detailLabel}>{t('settings.sshHostKeyPolicy')}</Text>
      <View style={styles.optionRow}>
        {SSH_HOST_KEY_POLICY_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option}
            style={[
              styles.optionChip,
              draft.hostKeyPolicy === option ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, hostKeyPolicy: option } : current))
            }
          >
            <Text
              style={[
                styles.optionChipText,
                draft.hostKeyPolicy === option ? styles.optionChipTextActive : null,
              ]}
            >
              {getLocalizedSshHostKeyPolicyOptionLabel(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.formHint}>{t('settings.sshHostKeyPolicyHint')}</Text>

      <Text style={styles.detailLabel}>{t('settings.sshTrustedFingerprint')}</Text>
      <Text style={styles.formHint}>
        {draft.hostKeyPolicy === 'strict'
          ? t('settings.sshTrustedFingerprintStrictHint')
          : t('settings.sshTrustedFingerprintTofuHint')}
      </Text>
      <View style={styles.configActionRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => void handleFetchFingerprint()}
          accessibilityRole="button"
          accessibilityLabel={t('settings.sshFetchFingerprint')}
        >
          <Text style={styles.secondaryBtnText}>
            {sshFingerprintPending
              ? t('settings.sshFetchingFingerprint')
              : t('settings.sshFetchFingerprint')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => void (handleResetFingerprint ? handleResetFingerprint() : null)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.sshResetFingerprint')}
        >
          <Text style={styles.secondaryBtnText}>{t('settings.sshResetFingerprint')}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.configInput}
        value={draft.trustedHostFingerprint || ''}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, trustedHostFingerprint: value } : current))
        }
        placeholder={t('settings.sshTrustedFingerprintPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.sshPtyType')}</Text>
      <View style={styles.optionRow}>
        {(Array.isArray(SSH_PTY_OPTIONS) && SSH_PTY_OPTIONS.length
          ? SSH_PTY_OPTIONS
          : DEFAULT_SSH_PTY_OPTIONS
        ).map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.optionChip,
              (draft.ptyType || 'xterm') === option.value ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setDraft((current) => (current ? { ...current, ptyType: option.value } : current))
            }
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Text
              style={[
                styles.optionChipText,
                (draft.ptyType || 'xterm') === option.value ? styles.optionChipTextActive : null,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchLabelWrap}>
          <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
          <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
        </View>
        <Switch
          value={draft.enabled}
          onValueChange={(value) =>
            setDraft((current) => (current ? { ...current, enabled: value } : current))
          }
          trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
          thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
        />
      </View>

      <View style={styles.configActionRow}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => void handleSaveSshConfig()}
          accessibilityRole="button"
          accessibilityLabel={t('common.save')}
        >
          <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={closeEditor}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        >
          <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        {isExisting ? (
          <TouchableOpacity
            style={styles.destructiveBtn}
            onPress={() => void handleDeleteSshConfig(draft.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteSshTarget')}
          >
            <Text style={styles.destructiveBtnText}>{deleteButtonLabel || t('common.delete')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
