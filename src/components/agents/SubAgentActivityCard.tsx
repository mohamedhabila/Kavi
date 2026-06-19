import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react-native';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { SubAgentLifecycleEvent, SubAgentSnapshot } from '../../types/subAgent';
import {
  formatCompactElapsed,
  getSubAgentDisplayName,
  getSubAgentElapsedMs,
  getSubAgentSessionLabel,
  summarizeSubAgentVisibleActivity,
} from '../../services/agents/lifecycle/presentPhase';
import type { SubAgentRollup } from '../../services/agents/lifecycle/subAgentHierarchyPresentation';

type SubAgentActivityCardVariant = 'transcript' | 'queue' | 'detail';

interface SubAgentActivityCardProps {
  snapshot: SubAgentSnapshot;
  event?: SubAgentLifecycleEvent;
  visualDepth?: number;
  variant?: SubAgentActivityCardVariant;
  rollup?: SubAgentRollup;
  defaultExpanded?: boolean;
  showOpenDetailsAction?: boolean;
  onOpenDetails?: (snapshot: SubAgentSnapshot) => void;
}

const INDENT_STEP = 14;
const MAX_SUMMARY_LINES = 2;

function getStatusLabel(
  status: SubAgentSnapshot['status'],
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case 'running':
      return t('agentRoster.queueStatusRunning');
    case 'completed':
      return t('agentRoster.queueStatusCompleted');
    case 'timeout':
      return t('agentRoster.queueStatusTimeout');
    case 'error':
      return t('agentRoster.queueStatusError');
    case 'cancelled':
      return t('agentRoster.queueStatusCancelled');
    default:
      return t('agentRoster.queueStatusPending');
  }
}

function getSandboxLabel(
  policy: SubAgentSnapshot['sandboxPolicy'],
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (policy) {
    case 'safe-only':
      return t('chat.subAgentSandboxSafeOnly');
    case 'inherit':
      return t('chat.subAgentSandboxInherit');
    case 'full':
    default:
      return t('chat.subAgentSandboxFull');
  }
}

function getStatusColors(status: SubAgentSnapshot['status'], colors: AppPalette) {
  switch (status) {
    case 'completed':
      return {
        accent: colors.success || colors.primary,
        surface: colors.primarySoft || colors.surfaceAlt,
        border: colors.success || colors.primary,
      };
    case 'timeout':
      return {
        accent: colors.warning || colors.textSecondary,
        surface: colors.warningBackground || colors.surfaceAlt,
        border: colors.warning || colors.textSecondary,
      };
    case 'error':
      return {
        accent: colors.danger,
        surface: colors.dangerSoft || colors.surfaceAlt,
        border: colors.danger,
      };
    case 'cancelled':
      return {
        accent: colors.warning || colors.textSecondary,
        surface: colors.warningBackground || colors.surfaceAlt,
        border: colors.warning || colors.textSecondary,
      };
    case 'running':
    default:
      return {
        accent: colors.primary,
        surface: colors.surfaceAlt,
        border: colors.subtleBorder,
      };
  }
}

const StatusIcon: React.FC<{ status: SubAgentSnapshot['status']; color: string }> = ({
  status,
  color,
}) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} color={color} />;
    case 'cancelled':
    case 'timeout':
    case 'error':
      return <AlertTriangle size={16} color={color} />;
    case 'running':
    default:
      return <Bot size={16} color={color} />;
  }
};

export const SubAgentActivityCard: React.FC<SubAgentActivityCardProps> = ({
  snapshot,
  event,
  visualDepth,
  variant = 'transcript',
  rollup,
  defaultExpanded = false,
  showOpenDetailsAction = false,
  onOpenDetails,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded, snapshot.sessionId]);

  useEffect(() => {
    if (snapshot.status !== 'running') {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    (intervalId as any).unref?.();

    return () => clearInterval(intervalId);
  }, [snapshot.sessionId, snapshot.status]);

  const depth = Math.max(0, visualDepth ?? snapshot.depth);
  const statusLabel = getStatusLabel(snapshot.status, t);
  const sandboxLabel = getSandboxLabel(snapshot.sandboxPolicy, t);
  const tone = getStatusColors(snapshot.status, colors);
  const title = getSubAgentDisplayName(snapshot);
  const sessionLabel = t('chat.subAgentSession', {
    id: getSubAgentSessionLabel(snapshot.sessionId),
  });
  const elapsedLabel = formatCompactElapsed(getSubAgentElapsedMs(snapshot, now));
  const outputSummary = summarizeSubAgentVisibleActivity(snapshot, variant === 'queue' ? 280 : 180);
  const toolCountLabel = snapshot.toolsUsed?.length
    ? snapshot.toolsUsed.length === 1
      ? t('chat.subAgentToolCountOne')
      : t('chat.subAgentToolCount', { count: snapshot.toolsUsed.length })
    : undefined;
  const iterationCountLabel = snapshot.iterations
    ? snapshot.iterations === 1
      ? t('chat.subAgentIterationCountOne')
      : t('chat.subAgentIterationCount', { count: snapshot.iterations })
    : undefined;
  const nestedUnderLabel = snapshot.parentSessionId
    ? t('chat.subAgentNestedUnder', { session: getSubAgentSessionLabel(snapshot.parentSessionId) })
    : undefined;
  const recentActivity = (snapshot.activityLog || []).slice(-3);
  const hasExpandableDetails = Boolean(
    snapshot.output?.trim() ||
    snapshot.currentActivity?.trim() ||
    snapshot.lastToolResultPreview?.trim() ||
    recentActivity.length > 0 ||
    nestedUnderLabel ||
    toolCountLabel ||
    iterationCountLabel,
  );
  const hasRollup = Boolean(rollup && rollup.descendantCount > 0);
  const rollupIssueCount =
    (rollup?.errorCount || 0) + (rollup?.timeoutCount || 0) + (rollup?.cancelledCount || 0);
  const handleOpenDetails = () => {
    onOpenDetails?.(snapshot);
  };
  const accessibilityLabel = [t('chat.subAgentLabel'), title, statusLabel].join(', ');

  return (
    <View
      style={[
        styles.depthContainer,
        depth > 0 ? { marginLeft: depth * INDENT_STEP, borderLeftWidth: 2, paddingLeft: 12 } : null,
      ]}
      testID={`sub-agent-card-depth-${depth}`}
    >
      <View style={[styles.card, { backgroundColor: tone.surface, borderColor: tone.border }]}>
        <TouchableOpacity
          accessibilityRole={hasExpandableDetails ? 'button' : undefined}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={
            hasExpandableDetails
              ? expanded
                ? t('chat.subAgentHideDetails')
                : t('chat.subAgentShowDetails')
              : undefined
          }
          disabled={!hasExpandableDetails}
          onPress={() => setExpanded((current) => !current)}
          activeOpacity={0.85}
          testID="sub-agent-toggle"
        >
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: colors.surface, borderColor: tone.border },
              ]}
            >
              <StatusIcon status={snapshot.status} color={tone.accent} />
            </View>
            <View style={styles.headerTextColumn}>
              <Text style={styles.eyebrowText}>{t('chat.subAgentLabel')}</Text>
              <Text style={styles.titleText}>{title}</Text>
              <Text style={styles.subtitleText}>{sessionLabel}</Text>
            </View>
            <View style={styles.headerMetaColumn}>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: colors.surface, borderColor: tone.border },
                ]}
              >
                <Text style={[styles.statusPillText, { color: tone.accent }]}>{statusLabel}</Text>
              </View>
              {hasExpandableDetails ? (
                expanded ? (
                  <ChevronDown size={16} color={colors.textSecondary} />
                ) : (
                  <ChevronRight size={16} color={colors.textSecondary} />
                )
              ) : null}
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Clock size={12} color={colors.textSecondary} />
              <Text style={styles.metaChipText}>{elapsedLabel}</Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                {t('chat.subAgentDepth', { depth: snapshot.depth })}
              </Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{sandboxLabel}</Text>
            </View>
            {snapshot.activeToolName ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{snapshot.activeToolName}</Text>
              </View>
            ) : null}
            {toolCountLabel ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{toolCountLabel}</Text>
              </View>
            ) : null}
            {iterationCountLabel ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{iterationCountLabel}</Text>
              </View>
            ) : null}
          </View>

          {!expanded && outputSummary ? (
            <Text
              numberOfLines={MAX_SUMMARY_LINES}
              style={styles.summaryText}
              testID="sub-agent-summary"
            >
              {outputSummary}
            </Text>
          ) : null}

          {hasRollup && rollup ? (
            <View style={styles.rollupStrip} testID="sub-agent-rollup-strip">
              <Text style={styles.rollupLabelText}>
                {rollup.totalAgents === 1
                  ? t('chat.subAgentRollupWorkersOne')
                  : t('chat.subAgentRollupWorkers', { count: rollup.totalAgents })}
              </Text>
              {rollup.runningCount > 0 ? (
                <Text style={styles.rollupValueText}>
                  {rollup.runningCount === 1
                    ? t('chat.subAgentRollupRunningOne')
                    : t('chat.subAgentRollupRunning', { count: rollup.runningCount })}
                </Text>
              ) : null}
              {rollup.completedCount > 0 ? (
                <Text style={styles.rollupValueText}>
                  {rollup.completedCount === 1
                    ? t('chat.subAgentRollupCompletedOne')
                    : t('chat.subAgentRollupCompleted', { count: rollup.completedCount })}
                </Text>
              ) : null}
              {rollupIssueCount > 0 ? (
                <Text style={[styles.rollupValueText, { color: colors.danger }]}>
                  {rollupIssueCount === 1
                    ? t('chat.subAgentRollupIssuesOne')
                    : t('chat.subAgentRollupIssues', { count: rollupIssueCount })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </TouchableOpacity>

        {showOpenDetailsAction && onOpenDetails ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('chat.subAgentOpenDetails')}
            onPress={handleOpenDetails}
            style={styles.openDetailsButton}
            testID="sub-agent-open-details"
          >
            <Text style={styles.openDetailsText}>{t('chat.subAgentOpenDetails')}</Text>
            <ChevronRight size={16} color={colors.primary} />
          </TouchableOpacity>
        ) : null}

        {expanded ? (
          <View style={styles.detailSection} testID="sub-agent-details">
            {nestedUnderLabel ? (
              <Text style={styles.detailMetaText}>{nestedUnderLabel}</Text>
            ) : null}
            {event ? (
              <Text style={styles.detailMetaText}>
                {event === 'started'
                  ? t('chat.subAgentStarted')
                  : event === 'completed'
                    ? t('chat.subAgentCompleted')
                    : event === 'timeout'
                      ? t('agentRoster.queueStatusTimeout')
                      : event === 'cancelled'
                        ? t('chat.subAgentCancelled')
                        : t('chat.subAgentFailed')}
              </Text>
            ) : null}
            {snapshot.currentActivity?.trim() ? (
              <Text style={styles.detailMetaText}>{snapshot.currentActivity.trim()}</Text>
            ) : null}
            {snapshot.lastToolResultPreview?.trim() &&
            snapshot.lastToolResultPreview.trim() !== snapshot.currentActivity?.trim() ? (
              <Text style={styles.detailMetaText}>{snapshot.lastToolResultPreview.trim()}</Text>
            ) : null}
            {recentActivity.map((entry) => (
              <Text
                key={`${snapshot.sessionId}-${entry.timestamp}-${entry.kind}`}
                style={styles.detailMetaText}
              >
                {entry.text}
              </Text>
            ))}
            {snapshot.output?.trim() ? (
              <Text style={styles.detailOutputText} selectable>
                {snapshot.output.trim()}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    depthContainer: {
      borderLeftColor: colors.subtleBorder,
    },
    card: {
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      gap: 10,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    iconBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextColumn: {
      flex: 1,
      gap: 2,
    },
    headerMetaColumn: {
      alignItems: 'flex-end',
      gap: 8,
    },
    eyebrowText: {
      fontSize: 11,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      fontWeight: '600',
    },
    titleText: {
      fontSize: 14,
      lineHeight: 18,
      color: colors.text,
      fontWeight: '700',
    },
    subtitleText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontFamily: 'monospace',
    },
    statusPill: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    statusPillText: {
      fontSize: 11,
      fontWeight: '700',
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.surface,
    },
    metaChipText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    summaryText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    rollupStrip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 2,
    },
    rollupLabelText: {
      fontSize: 12,
      color: colors.text,
      fontWeight: '700',
    },
    rollupValueText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    openDetailsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.subtleBorder,
    },
    openDetailsText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    detailSection: {
      gap: 8,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.subtleBorder,
    },
    detailMetaText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    detailOutputText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },
  });
