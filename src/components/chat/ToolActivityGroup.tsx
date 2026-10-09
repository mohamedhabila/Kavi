import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CheckCircle2 } from 'lucide-react-native';

import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme } from '../../theme/useAppTheme';
import type { ToolCall } from '../../types/message';
import { ExpandCollapseChevronIcon } from '../navigation/DirectionalIcons';
import { humanizeToolName, summarizeToolCall } from './toolCallPresentation';
import { summarizeToolActivity } from './toolActivityTimeline';

type Props = {
  toolCalls: ReadonlyArray<ToolCall>;
  /** The folded steps, in order, shown when the group is expanded. */
  children: React.ReactNode;
};

/**
 * Consecutive tool steps of one answer, folded into a single line of progress.
 *
 * While the work runs, the line names the step in progress and how many are done; once
 * it settles, it says how many steps were taken and whether any did not work. The
 * individual steps — and the thinking between them — are one tap away, in order.
 */
export const ToolActivityGroup: React.FC<Props> = ({ toolCalls, children }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolActivity(toolCalls);

  const title = summary.active
    ? summarizeToolCall(summary.active, t) || humanizeToolName(summary.active.name, t)
    : t('toolActivity.completedSteps', { count: summary.total });
  const detail = summary.active
    ? t('toolActivity.progress', { done: summary.settled, total: summary.total })
    : summary.failed > 0
      ? t('toolActivity.failedSteps', { count: summary.failed })
      : undefined;
  const toggleLabel = expanded ? t('toolActivity.hideSteps') : t('toolActivity.showSteps');

  return (
    <View style={[styles.container, { borderColor: colors.border }]} testID="tool-activity-group">
      <Pressable
        accessibilityHint={toggleLabel}
        accessibilityLabel={detail ? `${title}. ${detail}` : title}
        accessibilityRole="button"
        accessibilityState={{ expanded, busy: Boolean(summary.active) }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
        testID="tool-activity-toggle"
      >
        {summary.active ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : summary.failed > 0 ? (
          <AlertTriangle size={18} color={colors.warning} />
        ) : (
          <CheckCircle2 size={18} color={colors.success} />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <ExpandCollapseChevronIcon expanded={expanded} size={18} color={colors.textSecondary} />
      </Pressable>
      {expanded ? (
        <View style={styles.steps} testID="tool-activity-steps">
          {children}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, marginVertical: 4, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44, padding: 12 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 12 },
  steps: { paddingBottom: 8, paddingHorizontal: 8 },
});
