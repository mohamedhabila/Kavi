import React from 'react';
import { Text, TextInput, View } from 'react-native';

import type { AppPalette } from '../../../theme/useAppTheme';
import type { WorkspaceTargetConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type WorkspaceBasicsSectionProps = {
  draft: WorkspaceTargetConfig;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setDraft: React.Dispatch<React.SetStateAction<WorkspaceTargetConfig | null>>;
};

export const WorkspaceBasicsSection: React.FC<WorkspaceBasicsSectionProps> = ({
  draft,
  colors,
  styles,
  t,
  setDraft,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceBasicsSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.workspaceTargetName')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.name}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, name: value } : current))
        }
        placeholder={t('settings.workspaceTargetNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.detailLabel}>{t('settings.workspaceRootPath')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.rootPath}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, rootPath: value } : current))
        }
        placeholder={t('settings.workspaceRootPathPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.workspaceBaseUrl')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.baseUrl || ''}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, baseUrl: value } : current))
        }
        placeholder={t('settings.workspaceBaseUrlPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.formHint}>{t('settings.workspaceConnectionHint')}</Text>
    </View>
  );
};
