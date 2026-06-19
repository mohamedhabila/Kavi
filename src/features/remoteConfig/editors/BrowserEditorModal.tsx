import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  ConfigEditorModal,
  type ConfigEditorModalShellStyles,
} from '../../../screens/components/ConfigEditorModal';
import {
  applyBrowserProviderPreset,
  BROWSER_PROVIDER_AUTH_OPTIONS,
  BROWSER_PROVIDER_OPTIONS,
  BROWSER_PROVIDER_PRESETS,
} from '../../../services/browser/providers/registry';
import {
  getBrowserProviderAuthHint,
  getBrowserProviderLabel,
} from '../../../services/browser/providers/labels';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { BrowserProviderConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};

type RemoteWorkBrowserEditorModalProps = SharedProps & {
  visible: boolean;
  draft: BrowserProviderConfig | null;
  isExisting: boolean;
  browserApiKey: string;
  closeEditor: () => void;
  setDraft: React.Dispatch<React.SetStateAction<BrowserProviderConfig | null>>;
  setBrowserApiKey: (value: string) => void;
  getLocalizedBrowserAuthModeLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleDeleteBrowserConfig: (id: string) => void;
  handleSaveBrowserConfig: () => void | Promise<void>;
};

export const RemoteWorkBrowserEditorModal: React.FC<RemoteWorkBrowserEditorModalProps> = ({
  visible,
  draft,
  isExisting,
  browserApiKey,
  closeEditor,
  setDraft,
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
    <ConfigEditorModal
      visible={visible && Boolean(draft)}
      title={isExisting ? t('settings.editBrowserProvider') : t('settings.newBrowserProvider')}
      subtitle={t('remoteWork.browserManageHint')}
      onClose={closeEditor}
      closeAccessibilityLabel={t('common.close')}
      shellStyles={shellStyles}
      contentContainerStyle={styles.workspaceEditorContent}
    >
      {draft ? (
        <>
          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceBasicsSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.browserProviderName')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.name}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, name: value } : current))
              }
              placeholder={t('settings.browserProviderNamePlaceholder')}
              placeholderTextColor={colors.placeholder}
            />

            <Text style={styles.detailLabel}>{t('settings.browserProviderType')}</Text>
            <View style={styles.optionRow}>
              {BROWSER_PROVIDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.provider === option ? styles.optionChipActive : null,
                  ]}
                  onPress={() =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            provider: option,
                            baseUrl:
                              option === 'browserbase'
                                ? 'https://api.browserbase.com'
                                : option === 'browserless'
                                  ? 'https://production-sfo.browserless.io'
                                  : current.baseUrl,
                            authMode:
                              option === 'browserbase'
                                ? 'api-key-header'
                                : option === 'browserless'
                                  ? 'query-token'
                                  : current.authMode,
                          }
                        : current,
                    )
                  }
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      draft.provider === option ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {getBrowserProviderLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.detailLabel}>{t('settings.quickSetupTitle')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalChipRow}
            >
              {BROWSER_PROVIDER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={styles.optionChip}
                  onPress={() =>
                    setDraft((current) =>
                      current ? applyBrowserProviderPreset(current, preset.id) : current,
                    )
                  }
                >
                  <Text style={styles.optionChipText}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.detailLabel}>{t('settings.browserBaseUrl')}</Text>
            <TextInput
              style={styles.configInput}
              value={draft.baseUrl || ''}
              onChangeText={(value) =>
                setDraft((current) => (current ? { ...current, baseUrl: value } : current))
              }
              placeholder={t('settings.browserBaseUrlPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            {draft.provider === 'browserbase' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserProjectId')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.projectId || ''}
                  onChangeText={(value) =>
                    setDraft((current) => (current ? { ...current, projectId: value } : current))
                  }
                  placeholder={t('settings.browserProjectIdPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}
          </View>

          <View style={styles.workspaceEditorSectionCard}>
            <Text style={styles.workspaceEditorSectionTitle}>
              {t('remoteWork.workspaceAccessSection')}
            </Text>

            <Text style={styles.detailLabel}>{t('settings.browserAuthMode')}</Text>
            <View style={styles.optionRow}>
              {BROWSER_PROVIDER_AUTH_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionChip,
                    draft.authMode === option ? styles.optionChipActive : null,
                  ]}
                  onPress={() =>
                    setDraft((current) => (current ? { ...current, authMode: option } : current))
                  }
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      draft.authMode === option ? styles.optionChipTextActive : null,
                    ]}
                  >
                    {getLocalizedBrowserAuthModeLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.formHint}>{getBrowserProviderAuthHint(draft)}</Text>

            {draft.authMode === 'query-token' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserQueryTokenParam')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={draft.queryTokenParam || ''}
                  onChangeText={(value) =>
                    setDraft((current) =>
                      current ? { ...current, queryTokenParam: value } : current,
                    )
                  }
                  placeholder={t('settings.browserQueryTokenParamPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}

            {draft.authMode !== 'none' ? (
              <>
                <Text style={styles.detailLabel}>{t('settings.browserApiKey')}</Text>
                <TextInput
                  style={styles.configInput}
                  value={browserApiKey}
                  onChangeText={setBrowserApiKey}
                  placeholder={
                    draft.apiKeyRef
                      ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
                      : t('settings.browserApiKeyPlaceholder')
                  }
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
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
                onPress={() => void handleSaveBrowserConfig()}
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
                  onPress={() => handleDeleteBrowserConfig(draft.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.deleteBrowserProvider')}
                >
                  <Text style={styles.destructiveBtnText}>
                    {t('settings.deleteBrowserProvider')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </ConfigEditorModal>
  );
};
