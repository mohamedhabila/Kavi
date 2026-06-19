import React from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../../theme/useAppTheme';
import type { McpServerConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type McpAccessSectionProps = {
  draft: McpServerConfig;
  isExisting: boolean;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  closeEditor: () => void;
  deleteButtonLabel?: string;
  setDraft: React.Dispatch<React.SetStateAction<McpServerConfig | null>>;
  mcpToken?: string;
  setMcpToken?: (value: string) => void;
  mcpHeadersText?: string;
  setMcpHeadersText?: (value: string) => void;
  mcpOauthClientSecret?: string;
  setMcpOauthClientSecret?: (value: string) => void;
  handleDeleteMcpConfig: (id: string) => void;
  handleSaveMcpConfig: () => void | Promise<void>;
};

export const McpAccessSection: React.FC<McpAccessSectionProps> = ({
  draft,
  isExisting,
  colors,
  styles,
  t,
  closeEditor,
  deleteButtonLabel,
  setDraft,
  mcpToken,
  setMcpToken,
  mcpHeadersText,
  setMcpHeadersText,
  mcpOauthClientSecret,
  setMcpOauthClientSecret,
  handleDeleteMcpConfig,
  handleSaveMcpConfig,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceAccessSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.serverToken')}</Text>
      <TextInput
        style={styles.configInput}
        value={mcpToken ?? draft.token ?? ''}
        onChangeText={(value) => {
          if (setMcpToken) {
            setMcpToken(value);
            return;
          }

          setDraft((current) => (current ? { ...current, token: value } : current));
        }}
        placeholder={
          draft.tokenRef
            ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
            : t('settings.serverTokenPlaceholder')
        }
        placeholderTextColor={colors.placeholder}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.mcpOAuthClientId')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.oauth?.clientId || ''}
        onChangeText={(value) =>
          setDraft((current) =>
            current ? { ...current, oauth: { ...current.oauth, clientId: value } } : current,
          )
        }
        placeholder={t('settings.mcpOAuthClientIdPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {setMcpOauthClientSecret ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.mcpOAuthClientSecret')}</Text>
          <TextInput
            style={styles.configInput}
            value={mcpOauthClientSecret || ''}
            onChangeText={setMcpOauthClientSecret}
            placeholder={t('settings.mcpOAuthClientSecretPlaceholder')}
            placeholderTextColor={colors.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : null}

      <Text style={styles.detailLabel}>{t('settings.mcpOAuthAuthorizationUrl')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.oauth?.authorizationUrl || ''}
        onChangeText={(value) =>
          setDraft((current) =>
            current
              ? { ...current, oauth: { ...current.oauth, authorizationUrl: value } }
              : current,
          )
        }
        placeholder={t('settings.mcpOAuthAuthorizationUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.detailLabel}>{t('settings.mcpOAuthTokenUrl')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.oauth?.tokenUrl || ''}
        onChangeText={(value) =>
          setDraft((current) =>
            current ? { ...current, oauth: { ...current.oauth, tokenUrl: value } } : current,
          )
        }
        placeholder={t('settings.mcpOAuthTokenUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.detailLabel}>{t('settings.mcpOAuthScope')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.oauth?.scope || ''}
        onChangeText={(value) =>
          setDraft((current) =>
            current ? { ...current, oauth: { ...current.oauth, scope: value } } : current,
          )
        }
        placeholder={t('settings.mcpOAuthScopePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.mcpOAuthProxyProjectName')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.oauth?.projectNameForProxy || ''}
        onChangeText={(value) =>
          setDraft((current) =>
            current
              ? { ...current, oauth: { ...current.oauth, projectNameForProxy: value } }
              : current,
          )
        }
        placeholder={t('settings.mcpOAuthProxyProjectNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {setMcpHeadersText ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.serverHeaders')}</Text>
          <Text style={styles.formHint}>{t('settings.serverHeadersHint')}</Text>
          <TextInput
            style={[styles.configInput, styles.configTextArea]}
            value={mcpHeadersText || ''}
            onChangeText={setMcpHeadersText}
            placeholder={t('settings.serverHeadersPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </>
      ) : null}

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
          onPress={() => void handleSaveMcpConfig()}
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
            onPress={() => handleDeleteMcpConfig(draft.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteMcpServer')}
          >
            <Text style={styles.destructiveBtnText}>{deleteButtonLabel || t('common.delete')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
