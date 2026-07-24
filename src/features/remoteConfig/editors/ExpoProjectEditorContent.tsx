import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { createExpoProjectDraft } from '../../../screens/configDrafts';
import type { AppPalette } from '../../../theme/useAppTheme';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

const EXPO_MODE_OPTIONS: ExpoProjectConfig['mode'][] = [
  'eas-workflow',
  'direct-ssh',
  'github-workflow',
];

const EXPO_PLATFORM_OPTIONS: Array<'android' | 'ios' | 'web'> = ['android', 'ios', 'web'];
const EXPO_PLATFORM_LABELS = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
} as const;

type ExpoProjectEditorContentProps = {
  draft: ExpoProjectConfig;
  isExisting: boolean;
  expoAccountDraft: ExpoAccountConfig | null;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  sshTargets: SshTargetConfig[];
  isWide: boolean;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setExpoProjectDraft: React.Dispatch<React.SetStateAction<ExpoProjectConfig | null>>;
  getLocalizedExpoModeLabel: (mode?: ExpoProjectConfig['mode']) => string;
  handleDeleteExpoProject: (id: string) => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
  handleSaveExpoProject: () => void | Promise<void>;
  handleSyncExpoAccount: (accountId?: string) => void | Promise<void>;
  toggleExpoPlatform: (platform: 'android' | 'ios' | 'web') => void;
  closeEditor: () => void;
};

export const ExpoProjectEditorContent: React.FC<ExpoProjectEditorContentProps> = ({
  draft,
  isExisting,
  expoAccountDraft,
  expoAccounts,
  expoProjects,
  sshTargets,
  isWide,
  colors,
  styles,
  t,
  setExpoProjectDraft,
  getLocalizedExpoModeLabel,
  handleDeleteExpoProject,
  handleEditExpoProject,
  handleSaveExpoProject,
  handleSyncExpoAccount,
  toggleExpoPlatform,
  closeEditor,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>{t('settings.expoProjects')}</Text>

      {expoProjects.length ? (
        <>
          <View
            accessibilityLabel={t('settings.expoProjects')}
            accessibilityRole="radiogroup"
            style={styles.optionRow}
            testID="expo-project-group"
          >
            {expoProjects.map((project) => (
              <TouchableOpacity
                accessibilityLabel={project.name}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.id === project.id }}
                key={project.id}
                style={[
                  styles.optionChip,
                  draft.id === project.id ? styles.optionChipActive : null,
                ]}
                onPress={() => handleEditExpoProject(project)}
                testID={`expo-project-${project.id}`}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    draft.id === project.id ? styles.optionChipTextActive : null,
                  ]}
                >
                  {project.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.configActionRow}>
            <TouchableOpacity
              accessibilityLabel={t('settings.addExpoProject')}
              accessibilityRole="button"
              style={styles.secondaryBtn}
              onPress={() => {
                const linkedAccount = expoAccounts.find(
                  (account) => account.id === (draft.accountId || expoAccountDraft?.id),
                );
                setExpoProjectDraft(createExpoProjectDraft(linkedAccount, sshTargets[0]?.id));
              }}
              testID="expo-project-add"
            >
              <Text style={styles.secondaryBtnText}>{t('settings.addExpoProject')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t('common.refresh')}
              accessibilityRole="button"
              style={styles.secondaryBtn}
              onPress={() => void handleSyncExpoAccount(draft.accountId || expoAccountDraft?.id)}
              testID="expo-project-refresh"
            >
              <Text style={styles.secondaryBtnText}>{t('common.refresh')}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <Text style={styles.detailLabel}>{t('settings.expoProjectName')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoProjectName')}
        style={styles.configInput}
        value={draft.name}
        onChangeText={(value) =>
          setExpoProjectDraft((current) => (current ? { ...current, name: value } : current))
        }
        placeholder={t('settings.expoProjectNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
        <View style={styles.formGridItem}>
          <Text style={styles.detailLabel}>{t('settings.expoOwner')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoOwner')}
            style={styles.configInput}
            value={draft.owner}
            onChangeText={(value) =>
              setExpoProjectDraft((current) => (current ? { ...current, owner: value } : current))
            }
            placeholder={t('settings.expoOwnerPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.formGridItem}>
          <Text style={styles.detailLabel}>{t('settings.expoProjectSlug')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoProjectSlug')}
            style={styles.configInput}
            value={draft.slug}
            onChangeText={(value) =>
              setExpoProjectDraft((current) => (current ? { ...current, slug: value } : current))
            }
            placeholder={t('settings.expoProjectSlugPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <Text style={styles.detailLabel}>{t('settings.expoLinkedAccount')}</Text>
      <View
        accessibilityLabel={t('settings.expoLinkedAccount')}
        accessibilityRole="radiogroup"
        style={styles.optionRow}
        testID="expo-linked-account-group"
      >
        {expoAccounts.map((account) => (
          <TouchableOpacity
            accessibilityLabel={account.name || account.owner}
            accessibilityRole="radio"
            accessibilityState={{ selected: draft.accountId === account.id }}
            key={account.id}
            style={[
              styles.optionChip,
              draft.accountId === account.id ? styles.optionChipActive : null,
            ]}
            onPress={() =>
              setExpoProjectDraft((current) =>
                current
                  ? { ...current, accountId: account.id, owner: current.owner || account.owner }
                  : current,
              )
            }
            testID={`expo-linked-account-${account.id}`}
          >
            <Text
              style={[
                styles.optionChipText,
                draft.accountId === account.id ? styles.optionChipTextActive : null,
              ]}
            >
              {account.name || account.owner}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {!expoAccounts.length ? (
        <Text style={styles.formHint}>{t('settings.expoAccountRequired')}</Text>
      ) : null}

      <Text style={styles.detailLabel}>{t('settings.expoExecutionMode')}</Text>
      <View
        accessibilityLabel={t('settings.expoExecutionMode')}
        accessibilityRole="radiogroup"
        style={styles.optionRow}
        testID="expo-mode-group"
      >
        {EXPO_MODE_OPTIONS.map((option) => (
          <TouchableOpacity
            accessibilityLabel={getLocalizedExpoModeLabel(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: draft.mode === option }}
            key={option}
            style={[styles.optionChip, draft.mode === option ? styles.optionChipActive : null]}
            onPress={() =>
              setExpoProjectDraft((current) => (current ? { ...current, mode: option } : current))
            }
            testID={`expo-mode-${option}`}
          >
            <Text
              style={[
                styles.optionChipText,
                draft.mode === option ? styles.optionChipTextActive : null,
              ]}
            >
              {getLocalizedExpoModeLabel(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {draft.mode === 'direct-ssh' ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.expoSshTarget')}</Text>
          <ScrollView
            accessibilityLabel={t('settings.expoSshTarget')}
            accessibilityRole="radiogroup"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalChipRow}
            testID="expo-ssh-target-group"
          >
            {sshTargets.map((target) => (
              <TouchableOpacity
                accessibilityLabel={target.name}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.sshTargetId === target.id }}
                key={target.id}
                style={[
                  styles.optionChip,
                  draft.sshTargetId === target.id ? styles.optionChipActive : null,
                ]}
                onPress={() =>
                  setExpoProjectDraft((current) =>
                    current ? { ...current, sshTargetId: target.id } : current,
                  )
                }
                testID={`expo-ssh-target-${target.id}`}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    draft.sshTargetId === target.id ? styles.optionChipTextActive : null,
                  ]}
                >
                  {target.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {!sshTargets.length ? (
            <Text style={styles.formHint}>{t('remoteWork.noSshTargetsHint')}</Text>
          ) : null}

          <Text style={styles.detailLabel}>{t('settings.expoProjectPath')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoProjectPath')}
            style={styles.configInput}
            value={draft.projectPath || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, projectPath: value } : current,
              )
            }
            placeholder={t('settings.expoProjectPathPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : draft.mode === 'github-workflow' ? (
        <>
          <Text style={styles.detailLabel}>{t('settings.expoGithubRepository')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoGithubRepository')}
            style={styles.configInput}
            value={draft.repoFullName || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, repoFullName: value } : current,
              )
            }
            placeholder={t('settings.expoGithubRepositoryPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.detailLabel}>{t('settings.expoWorkflowFile')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoWorkflowFile')}
            style={styles.configInput}
            value={draft.workflowFile || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, workflowFile: value } : current,
              )
            }
            placeholder={t('settings.expoWorkflowFilePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.detailLabel}>{t('settings.expoWorkflowRef')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoWorkflowRef')}
            style={styles.configInput}
            value={draft.workflowRef || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, workflowRef: value } : current,
              )
            }
            placeholder={t('settings.expoWorkflowRefPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : (
        <Text style={styles.formHint}>{t('remoteWork.expoWorkflowManagedHint')}</Text>
      )}

      <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
        <View style={styles.formGridItem}>
          <Text style={styles.detailLabel}>{t('settings.expoDefaultBuildProfile')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoDefaultBuildProfile')}
            style={styles.configInput}
            value={draft.defaultBuildProfile || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, defaultBuildProfile: value } : current,
              )
            }
            placeholder={t('settings.expoDefaultBuildProfilePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.formGridItem}>
          <Text style={styles.detailLabel}>{t('settings.expoDefaultUpdateBranch')}</Text>
          <TextInput
            accessibilityLabel={t('settings.expoDefaultUpdateBranch')}
            style={styles.configInput}
            value={draft.defaultUpdateBranch || ''}
            onChangeText={(value) =>
              setExpoProjectDraft((current) =>
                current ? { ...current, defaultUpdateBranch: value } : current,
              )
            }
            placeholder={t('settings.expoDefaultUpdateBranchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <Text style={styles.detailLabel}>{t('settings.expoUpdateChannel')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoUpdateChannel')}
        style={styles.configInput}
        value={draft.updateChannel || ''}
        onChangeText={(value) =>
          setExpoProjectDraft((current) =>
            current ? { ...current, updateChannel: value } : current,
          )
        }
        placeholder={t('settings.expoUpdateChannelPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.expoTargetPlatforms')}</Text>
      <View
        accessibilityLabel={t('settings.expoTargetPlatforms')}
        accessibilityRole="list"
        style={styles.optionRow}
        testID="expo-platform-group"
      >
        {EXPO_PLATFORM_OPTIONS.map((platform) => {
          const selected = draft.platforms?.includes(platform);
          return (
            <TouchableOpacity
              accessibilityLabel={EXPO_PLATFORM_LABELS[platform]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={platform}
              style={[styles.optionChip, selected ? styles.optionChipActive : null]}
              onPress={() => toggleExpoPlatform(platform)}
              testID={`expo-platform-${platform}`}
            >
              <Text style={[styles.optionChipText, selected ? styles.optionChipTextActive : null]}>
                {platform}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.detailLabel}>{t('settings.expoProductionWebUrl')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoProductionWebUrl')}
        style={styles.configInput}
        value={draft.webUrl || ''}
        onChangeText={(value) =>
          setExpoProjectDraft((current) => (current ? { ...current, webUrl: value } : current))
        }
        placeholder={t('settings.expoProductionWebUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.detailLabel}>{t('settings.expoPreviewUrl')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoPreviewUrl')}
        style={styles.configInput}
        value={draft.previewUrl || ''}
        onChangeText={(value) =>
          setExpoProjectDraft((current) => (current ? { ...current, previewUrl: value } : current))
        }
        placeholder={t('settings.expoPreviewUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.detailLabel}>{t('settings.expoCustomDomain')}</Text>
      <TextInput
        accessibilityLabel={t('settings.expoCustomDomain')}
        style={styles.configInput}
        value={draft.customDomain || ''}
        onChangeText={(value) =>
          setExpoProjectDraft((current) =>
            current ? { ...current, customDomain: value } : current,
          )
        }
        placeholder={t('settings.expoCustomDomainPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchLabelWrap}>
          <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
          <Text style={styles.switchHint}>{t('remoteWork.enabledSurfaceHint')}</Text>
        </View>
        <Switch
          accessibilityLabel={t('common.enabled')}
          value={draft.enabled}
          onValueChange={(value) =>
            setExpoProjectDraft((current) => (current ? { ...current, enabled: value } : current))
          }
          trackColor={{ false: colors.surfaceAlt, true: colors.primarySoft }}
          thumbColor={draft.enabled ? colors.primary : colors.textSecondary}
        />
      </View>

      <View style={styles.configActionRow}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => void handleSaveExpoProject()}
          accessibilityRole="button"
          accessibilityLabel={t('common.save')}
        >
          <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={closeEditor}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Text style={styles.secondaryBtnText}>{t('common.close')}</Text>
        </TouchableOpacity>
        {isExisting ? (
          <TouchableOpacity
            style={styles.destructiveBtn}
            onPress={() => handleDeleteExpoProject(draft.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteExpoProject')}
          >
            <Text style={styles.destructiveBtnText}>{t('settings.deleteExpoProject')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
