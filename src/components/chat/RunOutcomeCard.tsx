import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CheckCircle2 } from 'lucide-react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import type { ToolCall } from '../../types/message';
import { humanizeToolName } from '../../utils/toolDisplayName';
import { buildRunOutcomeEntries, RUN_OUTCOME_LABEL_KEYS } from './runOutcomePresentation';

type Props = {
  toolCalls: ReadonlyArray<ToolCall>;
};

/**
 * The changes a reply really made, from the receipts of its tool calls: what was saved,
 * scheduled, drafted or remembered, and anything that did not go through. Renders nothing
 * for a reply that changed nothing.
 */
export const RunOutcomeCard: React.FC<Props> = ({ toolCalls }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const entries = useMemo(() => buildRunOutcomeEntries(toolCalls), [toolCalls]);
  if (entries.length === 0) return null;

  return (
    <View
      style={[styles.container, { borderColor: colors.border }]}
      testID="run-outcome-card"
      accessibilityRole="summary"
    >
      <Text style={[styles.title, { color: colors.textSecondary }]}>{t('runOutcome.title')}</Text>
      {entries.map((entry) => {
        const action = humanizeToolName(entry.toolName, t);
        const label =
          entry.state === 'done'
            ? t(RUN_OUTCOME_LABEL_KEYS[entry.effectKind]!)
            : entry.state === 'pending'
              ? t('runOutcome.inProgress', { action })
              : t('runOutcome.didNotWork', { action });
        return (
          <View key={entry.id} style={styles.row} testID={`run-outcome-${entry.state}`}>
            {entry.state === 'done' ? (
              <CheckCircle2 size={16} color={colors.success} />
            ) : entry.state === 'pending' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <AlertTriangle size={16} color={colors.warning} />
            )}
            <View style={styles.rowText}>
              <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
              {entry.detail ? (
                <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>
                  {entry.detail}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, gap: 8, marginTop: 8, padding: 12 },
  title: { fontSize: 12, fontWeight: '600' },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '500' },
  detail: { fontSize: 12 },
});
