import React from 'react';
import { Text, TextInput, View } from 'react-native';

import type { AppPalette } from '../../../theme/useAppTheme';
import type { SshTargetConfig } from '../../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SshBasicsSectionProps = {
  draft: SshTargetConfig;
  isWide: boolean;
  sshPortText: string;
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  setDraft: React.Dispatch<React.SetStateAction<SshTargetConfig | null>>;
  setSshPortText: (value: string) => void;
};

export const SshBasicsSection: React.FC<SshBasicsSectionProps> = ({
  draft,
  isWide,
  sshPortText,
  colors,
  styles,
  t,
  setDraft,
  setSshPortText,
}) => {
  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>
        {t('remoteWork.workspaceBasicsSection')}
      </Text>

      <Text style={styles.detailLabel}>{t('settings.sshTargetName')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.name}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, name: value } : current))
        }
        placeholder={t('settings.sshTargetNamePlaceholder')}
        placeholderTextColor={colors.placeholder}
      />

      <View style={[styles.formGrid, isWide ? styles.formGridWide : null]}>
        <View style={styles.formGridItem}>
          <Text style={styles.detailLabel}>{t('settings.sshHost')}</Text>
          <TextInput
            style={styles.configInput}
            value={draft.host}
            onChangeText={(value) =>
              setDraft((current) => (current ? { ...current, host: value } : current))
            }
            placeholder={t('settings.sshHostPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={[styles.formGridItem, styles.formGridPortItem]}>
          <Text style={styles.detailLabel}>{t('settings.sshPort')}</Text>
          <TextInput
            style={styles.configInput}
            value={sshPortText}
            onChangeText={setSshPortText}
            placeholder="22"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Text style={styles.detailLabel}>{t('settings.sshUsername')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.username}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, username: value } : current))
        }
        placeholder={t('settings.sshUsernamePlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.detailLabel}>{t('settings.sshRemoteRoot')}</Text>
      <TextInput
        style={styles.configInput}
        value={draft.remoteRoot || ''}
        onChangeText={(value) =>
          setDraft((current) => (current ? { ...current, remoteRoot: value } : current))
        }
        placeholder={t('settings.sshRemoteRootPlaceholder')}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.formHint}>{t('settings.sshRemoteRootHint')}</Text>
    </View>
  );
};
