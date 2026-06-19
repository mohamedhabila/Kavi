import React from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../../theme/useAppTheme';
import type { WorkspaceTargetConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type WorkspaceRoutingSectionProps = {
  draft: WorkspaceTargetConfig;
  isExisting: boolean;
  workspaceConfigRootsText: string;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  closeEditor: () => void;
  setDraft: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
  setWorkspaceConfigRootsText: (value: string) => void;
  handleDeleteWorkspaceConfig: (id: string) => void;
  handleSaveWorkspaceConfig: () => void | Promise<void>;
};

export const WorkspaceRoutingSection: React.FC<WorkspaceRoutingSectionProps> = ({
  draft,
  isExisting,
  workspaceConfigRootsText,
  colors,
  styles,
  t,
  closeEditor,
  setDraft,
  setWorkspaceConfigRootsText,
  handleDeleteWorkspaceConfig,
  handleSaveWorkspaceConfig,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceRoutingSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.workspaceConfigRoots')}</Text>
      <TextInput
        style={[styles.configInput, styles.configTextArea]}
        value={workspaceConfigRootsText}
        onChangeText={setWorkspaceConfigRootsText}
        placeholder=".github&#10;.vscode"
        placeholderTextColor={colors.placeholder}
        multiline
        textAlignVertical="top"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.formHint}>{t('settings.workspaceConfigRootsHint')}</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchTitle}>{t('common.enabled')}</Text>
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
          onPress={() => void handleSaveWorkspaceConfig()}
          accessibilityRole="button"
          accessibilityLabel={t('remoteWork.saveWorkspaceTarget')}
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
            onPress={() => handleDeleteWorkspaceConfig(draft.id)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteWorkspaceTarget')}
          >
            <Text style={styles.destructiveBtnText}>{t('settings.deleteWorkspaceTarget')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
