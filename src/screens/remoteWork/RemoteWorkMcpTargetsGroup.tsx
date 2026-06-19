import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkMcpTargetsGroupProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  mcpTargets: any[];
  mcpServers: any[];
  handleCreateMcp: () => void;
  handleEditMcpConfig: (server: any) => void;
};

export const RemoteWorkMcpTargetsGroup: React.FC<RemoteWorkMcpTargetsGroupProps> = ({
  styles,
  t,
  mcpTargets,
  mcpServers,
  handleCreateMcp,
  handleEditMcpConfig,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('remoteWork.mcpTargetsTitle')}</Text>
      <Text style={styles.sectionCaption}>
        {`${mcpTargets.filter((target) => target.readiness === 'ready').length}/${mcpTargets.filter((target) => target.readiness !== 'disabled').length || mcpTargets.length || 0}`}
      </Text>
    </View>

    {mcpTargets.length === 0 ? (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>{t('remoteWork.noMcpTargetsTitle')}</Text>
        <Text style={styles.emptyText}>{t('remoteWork.noMcpTargetsHint')}</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleCreateMcp}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addMcpServer')}
        >
          <Text style={styles.primaryBtnText}>{t('settings.addMcpServer')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}

    {mcpTargets.map((target) => (
      <View key={target.id} style={styles.targetCard}>
        <View style={styles.targetHeader}>
          <View style={styles.targetHeaderText}>
            <Text style={styles.targetTitle}>{target.name}</Text>
            <Text style={styles.targetSubtitle}>{target.detail}</Text>
          </View>
          <View
            style={[
              styles.badge,
              target.readiness === 'ready' ? styles.badgeReady : styles.badgeWarn,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                target.readiness === 'ready' ? styles.badgeTextReady : styles.badgeTextWarn,
              ]}
            >
              {target.statusLabel}
            </Text>
          </View>
        </View>

        {target.activitySummary ? (
          <Text style={styles.detailValue}>{target.activitySummary}</Text>
        ) : null}
        {target.error ? <Text style={styles.sessionError}>{target.error}</Text> : null}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              const server = mcpServers.find((entry) => entry.id === target.id);
              if (server) handleEditMcpConfig(server);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.editMcpServer')}
          >
            <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    ))}
  </>
);
