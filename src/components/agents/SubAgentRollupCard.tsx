import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../i18n/useTranslation';
import type { SubAgentRollup } from '../../services/agents/lifecycle/subAgentHierarchyPresentation';
import { getSubAgentDisplayName } from '../../services/agents/lifecycle/presentPhase';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { SubAgentSnapshot } from '../../types/subAgent';

interface SubAgentRollupCardProps {
  rootSnapshot: SubAgentSnapshot;
  rollup: SubAgentRollup;
}

export const SubAgentRollupCard: React.FC<SubAgentRollupCardProps> = ({ rootSnapshot, rollup }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const issueCount = rollup.errorCount + rollup.timeoutCount + rollup.cancelledCount;
  const title = getSubAgentDisplayName(rootSnapshot);

  return (
    <View style={styles.card} testID="sub-agent-rollup-card">
      <Text style={styles.eyebrow}>{t('chat.subAgentSummaryTitle')}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{t('chat.subAgentWorkerTree')}</Text>

      <View style={styles.metricGrid}>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('chat.subAgentRollupWorkersLabel')}</Text>
          <Text style={styles.metricValue}>{rollup.totalAgents}</Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('agentRoster.queueStatusRunning')}</Text>
          <Text style={[styles.metricValue, { color: colors.primary }]}>{rollup.runningCount}</Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('agentRoster.queueStatusCompleted')}</Text>
          <Text style={[styles.metricValue, { color: colors.success || colors.primary }]}>
            {rollup.completedCount}
          </Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('chat.subAgentRollupIssuesLabel')}</Text>
          <Text
            style={[
              styles.metricValue,
              { color: issueCount > 0 ? colors.danger : colors.textSecondary },
            ]}
          >
            {issueCount}
          </Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('chat.subAgentRollupRoundsLabel')}</Text>
          <Text style={styles.metricValue}>{rollup.totalIterations}</Text>
        </View>
        <View style={styles.metricChip}>
          <Text style={styles.metricLabel}>{t('chat.subAgentRollupToolsLabel')}</Text>
          <Text style={styles.metricValue}>{rollup.totalToolUses}</Text>
        </View>
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    card: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 14,
      gap: 10,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    metricChip: {
      minWidth: '30%',
      flexGrow: 1,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 10,
      paddingVertical: 9,
      gap: 4,
    },
    metricLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    metricValue: {
      fontSize: 18,
      color: colors.text,
      fontWeight: '700',
    },
  });
