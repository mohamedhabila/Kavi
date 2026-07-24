import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { createExpoAccountDraft } from '../../../screens/configDrafts';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { ExpoAccountConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type ExpoAccountEditorContentProps = {
  draft: ExpoAccountConfig;
  isExisting: boolean;
  expoAccountToken: string;
  expoAccounts: ExpoAccountConfig[];
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setExpoAccountDraft: React.Dispatch<React.SetStateAction<ExpoAccountConfig | null>>;
  setExpoAccountToken: (value: string) => void;
  handleDeleteExpoAccount: (id: string) => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleSaveExpoAccount: () => void | Promise<void>;
  handleSyncExpoAccount: (accountId?: string) => void | Promise<void>;
};

export const ExpoAccountEditorContent: React.FC<ExpoAccountEditorContentProps> = ({
  draft,
  isExisting,
  expoAccountToken,
  expoAccounts,
  colors,
  styles,
  t,
  setExpoAccountDraft,
  setExpoAccountToken,
  handleDeleteExpoAccount,
  handleEditExpoAccount,
  handleSaveExpoAccount,
  handleSyncExpoAccount,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>{t('settings.expoAccounts')}</Text>

      {expoAccounts.length ? (
        <>
          <View
            accessibilityLabel={t('settings.expoAccounts')}
            accessibilityRole="radiogroup"
            style={styles.optionRow}
            testID="expo-account-group"
          >
            {expoAccounts.map((account) => (
              <TouchableOpacity
                accessibilityLabel={account.name || account.owner}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.id === account.id }}
                key={account.id}
                style={[
                  styles.optionChip,
                  draft.id === account.id ? styles.optionChipActive : null,
                ]}
                onPress={() => handleEditExpoAccount(account)}
                testID={`expo-account-${account.id}`}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    draft.id === account.id ? styles.optionChipTextActive : null,
                  ]}
                >
                  {account.name || account.owner}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.configActionRow}>
            <TouchableOpacity
              accessibilityLabel={t('settings.addExpoAccount')}
              accessibilityRole="button"
              style={styles.secondaryBtn}
              onPress={() => {
                setExpoAccountDraft(createExpoAccountDraft());
                setExpoAccountToken('');
              }}
              testID="expo-account-add"
            >
              <Text style={styles.secondaryBtnText}>{t('settings.addExpoAccount')}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <Text style={styles.detailLabel}>{t('settings.expoAccountName')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoAccountName')}
        style={styles.configInput}
        value={draft.name}
        onChangeText={(value) =>
          setExpoAccountDraft((current) => (current ? { ...current, name: value } : current))
        }
        placeholder={t('settings.expoAccountNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.detailLabel}>{t('settings.expoOwner')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoOwner')}
        style={styles.configInput}
        value={draft.owner}
        onChangeText={(value) =>
          setExpoAccountDraft((current) => (current ? { ...current, owner: value } : current))
        }
        placeholder={t('settings.expoOwnerPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.formHint}>{t('settings.expoOwnerHint')}</Text>

      <Text style={styles.detailLabel}>{t('settings.expoAccountType')}</Text>
      <View
        accessibilityLabel={t('settings.expoAccountType')}
        accessibilityRole="radiogroup"
        style={styles.optionRow}
        testID="expo-account-type-group"
      >
        {(['personal', 'robot'] as const).map((option) => (
          <TouchableOpacity
            accessibilityLabel={
              option === 'robot'
                ? t('settings.expoAccountTypeRobot')
                : t('settings.expoAccountTypePersonal')
            }
            accessibilityRole="radio"
            accessibilityState={{ selected: draft.accountType === option }}
            key={option}
            style={[
              styles.optionChip,
              draft.accountType === option ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setExpoAccountDraft((current) =>
                current ? { ...current, accountType: option } : current,
              )
            }
            testID={`expo-account-type-${option}`}
          >
            <Text
              style={[
                styles.optionChipText,
                draft.accountType === option ? styles.optionChipTextActive : null,
              ]}
            >
              {option === 'robot'
                ? t('settings.expoAccountTypeRobot')
                : t('settings.expoAccountTypePersonal')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.detailLabel}>{t('settings.expoAccessToken')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoAccessToken')}
        style={styles.configInput}
        value={expoAccountToken}
        onChangeText={setExpoAccountToken}
        placeholder={
          draft.tokenRef
            ? t('remoteWork.workspaceAccessTokenRetainedPlaceholder')
            : t('settings.expoAccessTokenPlaceholder')
        }
        placeholderTextColor={colors.placeholder}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.formHint}>{t('settings.expoAccessTokenHint')}</Text>
      <Text style={styles.detailValue}>
        {draft.lastProjectSyncError
          ? t('remoteWork.expoLastSyncFailed', {
              message: draft.lastProjectSyncError,
            })
          : t('remoteWork.expoProjectsSyncedCount', {
              count: draft.syncedProjectCount || 0,
            })}
      </Text>

      <View style={styles.configActionRow}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => void handleSaveExpoAccount()}
          accessibilityRole="button"
          accessibilityLabel={t('common.save')}
        >
          <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => void handleSyncExpoAccount(draft.id)}
          accessibilityRole="button"
          accessibilityLabel={t('common.refresh')}
        >
          <Text style={styles.secondaryBtnText}>{t('common.refresh')}</Text>
        </TouchableOpacity>
        {isExisting ? (
          <TouchableOpacity
            style={styles.destructiveBtn}
            onPress={() => handleDeleteExpoAccount(draft.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteExpoAccount')}
          >
            <Text style={styles.destructiveBtnText}>{t('settings.deleteExpoAccount')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
