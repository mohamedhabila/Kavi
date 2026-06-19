import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type McpMetadataSectionProps = {
  metadataChips?: string[];
  hasStoredMcpOauthSession?: boolean;
  handleResetMcpOAuthSession?: () => void | Promise<void>;
  isExisting: boolean;
  styles: StyleMap;
  t: TranslationFn;
};

export const McpMetadataSection: React.FC<McpMetadataSectionProps> = ({
  metadataChips,
  hasStoredMcpOauthSession,
  handleResetMcpOAuthSession,
  isExisting,
  styles,
  t,
}) => {
  if (!metadataChips?.length) {
    return null;
  }

  return (
    <View style={styles.workspaceEditorSectionCard}>
      <Text style={styles.workspaceEditorSectionTitle}>{t('settings.mcpMetadata')}</Text>
      <View style={styles.optionRow}>
        {metadataChips.map((chip) => (
          <View key={chip} style={styles.optionChip}>
            <Text style={styles.optionChipText}>{chip}</Text>
          </View>
        ))}
      </View>
      {hasStoredMcpOauthSession ? (
        <View style={styles.configActionRow}>
          <View style={[styles.optionChip, styles.optionChipActive]}>
            <Text style={[styles.optionChipText, styles.optionChipTextActive]}>
              {t('settings.mcpOAuthSessionSaved')}
            </Text>
          </View>
          {handleResetMcpOAuthSession && isExisting ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void handleResetMcpOAuthSession()}
              accessibilityRole="button"
              accessibilityLabel={t('settings.mcpResetOAuthSession')}
            >
              <Text style={styles.secondaryBtnText}>{t('settings.mcpResetOAuthSession')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};
