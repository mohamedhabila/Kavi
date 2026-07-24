import React, { useMemo } from 'react';
import { Platform, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  CircleX,
  Clock3,
  FilePlus2,
  MessageCircle,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react-native';
import { useTranslation } from '../../i18n/useTranslation';
import type {
  DelegatedWorkActivityKind,
  DelegatedWorkGroup,
  DelegatedWorkQueuePresentation,
  DelegatedWorkSection,
} from '../../services/agents/delegatedWorkQueuePresentation';
import { summarizeSubAgentOutput } from '../../services/agents/lifecycle/presentPhase';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';

interface DelegatedWorkQueueProps {
  presentation: DelegatedWorkQueuePresentation;
  onOpenSourceConversation: (group: DelegatedWorkGroup) => void;
  onOpenDetails: (group: DelegatedWorkGroup) => void;
  onPrepareRetry: (group: DelegatedWorkGroup) => void;
  onStop: (group: DelegatedWorkGroup) => void;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function getSectionLabel(section: DelegatedWorkSection, t: Translate): string {
  if (section === 'active') return t('agentRoster.queueSectionActive');
  if (section === 'attention') return t('agentRoster.queueSectionAttention');
  return t('agentRoster.queueSectionRecent');
}

function getActivityLabel(activity: DelegatedWorkActivityKind, t: Translate): string {
  return t(`agentRoster.queueActivity.${activity}`);
}

function getStepCountLabel(count: number, t: Translate): string {
  return count === 1
    ? t('agentRoster.queueStepCountOne')
    : t('agentRoster.queueStepCountMany', { count });
}

function getGroupPreview(group: DelegatedWorkGroup): string | undefined {
  if (group.section === 'attention') return undefined;

  const snapshots = [
    group.rootSnapshot,
    ...group.nodes
      .map((node) => node.snapshot)
      .filter((snapshot) => snapshot.sessionId !== group.rootSnapshot.sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt),
  ];
  const ordered =
    group.section === 'active'
      ? [
          ...snapshots.filter((snapshot) => snapshot.status === 'running'),
          ...snapshots.filter((snapshot) => snapshot.status !== 'running'),
        ]
      : snapshots;

  for (const snapshot of ordered) {
    const preview =
      group.section === 'active'
        ? summarizeSubAgentOutput(snapshot.currentActivity, 180)
        : summarizeSubAgentOutput(snapshot.output, 180);
    if (preview) return preview;
  }
  return undefined;
}

function formatUpdatedAt(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function getTone(
  section: DelegatedWorkSection,
  activity: DelegatedWorkActivityKind,
  colors: AppPalette,
) {
  if (section === 'attention') {
    return {
      foreground: colors.warning || colors.danger,
      background: colors.warningBackground || colors.dangerSoft,
    };
  }
  if (activity === 'cancelled') {
    return {
      foreground: colors.warning || colors.textSecondary,
      background: colors.warningBackground || colors.surfaceAlt,
    };
  }
  if (section === 'recent') {
    return {
      foreground: colors.success || colors.primary,
      background: colors.primarySoft,
    };
  }
  return { foreground: colors.primary, background: colors.primarySoft };
}

const ActivityIcon: React.FC<{
  activity: DelegatedWorkActivityKind;
  color: string;
}> = ({ activity, color }) => {
  if (activity === 'researching') return <Search size={17} color={color} />;
  if (activity === 'reviewing') return <BookOpen size={17} color={color} />;
  if (activity === 'creating') return <FilePlus2 size={17} color={color} />;
  if (activity === 'waiting' || activity === 'starting') return <Clock3 size={17} color={color} />;
  if (activity === 'completed') return <CheckCircle2 size={17} color={color} />;
  if (activity === 'cancelled') return <CircleX size={17} color={color} />;
  if (activity === 'needs_attention') return <TriangleAlert size={17} color={color} />;
  return <CircleEllipsis size={17} color={color} />;
};

const DelegatedWorkCard: React.FC<
  Omit<DelegatedWorkQueueProps, 'presentation'> & { group: DelegatedWorkGroup }
> = ({ group, onOpenDetails, onOpenSourceConversation, onPrepareRetry, onStop }) => {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tone = getTone(group.section, group.activityKind, colors);
  const preview = getGroupPreview(group);
  const sourceTitle = group.sourceConversationTitle?.trim();
  const title = group.workTitle?.trim() || sourceTitle || t('agentRoster.queueSourceFallback');
  const updatedAt = formatUpdatedAt(group.latestUpdatedAt, locale);

  return (
    <View style={styles.card} testID={`delegated-work-${group.id}`}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusIcon, { backgroundColor: tone.background }]}>
          <ActivityIcon activity={group.activityKind} color={tone.foreground} />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {title}
          </Text>
          <Text style={[styles.statusText, { color: tone.foreground }]}>
            {getActivityLabel(group.activityKind, t)}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityLabel={t('agentRoster.queueDetails')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => onOpenDetails(group)}
          style={styles.iconAction}
          testID={`delegated-work-details-${group.id}`}
        >
          <ChevronRight size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{getStepCountLabel(group.rollup.totalAgents, t)}</Text>
        {updatedAt ? <Text style={styles.metaText}>{updatedAt}</Text> : null}
      </View>

      {group.workTitle && sourceTitle ? (
        <Text numberOfLines={1} style={styles.sourceText}>
          {t('activity.fromConversation', { title: sourceTitle })}
        </Text>
      ) : null}

      {group.section === 'attention' ? (
        <Text style={styles.previewText}>{t('agentRoster.queueAttentionDescription')}</Text>
      ) : preview ? (
        <Text numberOfLines={3} style={styles.previewText}>
          {preview}
        </Text>
      ) : group.section === 'active' ? (
        <Text style={styles.previewText}>{t('agentRoster.queueWorkingDescription')}</Text>
      ) : null}

      <View style={styles.actions}>
        {group.canPrepareRetry ? (
          <TouchableOpacity
            accessibilityLabel={t('agentRoster.queueRetryInChat')}
            accessibilityRole="button"
            onPress={() => onPrepareRetry(group)}
            style={[styles.action, styles.primaryAction]}
            testID={`delegated-work-retry-${group.id}`}
          >
            <RotateCcw size={16} color={colors.onPrimary} />
            <Text style={styles.primaryActionText}>{t('agentRoster.queueRetryInChat')}</Text>
          </TouchableOpacity>
        ) : group.canOpenSourceConversation ? (
          <TouchableOpacity
            accessibilityLabel={t('agentRoster.queueOpenChat')}
            accessibilityRole="button"
            onPress={() => onOpenSourceConversation(group)}
            style={[styles.action, styles.primaryAction]}
            testID={`delegated-work-open-chat-${group.id}`}
          >
            <MessageCircle size={16} color={colors.onPrimary} />
            <Text style={styles.primaryActionText}>{t('agentRoster.queueOpenChat')}</Text>
          </TouchableOpacity>
        ) : null}

        {group.canCancel ? (
          <TouchableOpacity
            accessibilityLabel={t('agentRoster.queueStopAction')}
            accessibilityRole="button"
            onPress={() => onStop(group)}
            style={[styles.action, styles.secondaryAction]}
            testID={`delegated-work-stop-${group.id}`}
          >
            <Square size={15} color={colors.danger} fill={colors.danger} />
            <Text style={[styles.secondaryActionText, { color: colors.danger }]}>
              {t('agentRoster.queueStopAction')}
            </Text>
          </TouchableOpacity>
        ) : group.canOpenSourceConversation && group.canPrepareRetry ? (
          <TouchableOpacity
            accessibilityLabel={t('agentRoster.queueOpenChat')}
            accessibilityRole="button"
            onPress={() => onOpenSourceConversation(group)}
            style={[styles.action, styles.secondaryAction]}
          >
            <MessageCircle size={16} color={colors.primary} />
            <Text style={styles.secondaryActionText}>{t('agentRoster.queueOpenChat')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export const DelegatedWorkQueue: React.FC<DelegatedWorkQueueProps> = ({
  presentation,
  ...callbacks
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sections = useMemo(
    () => presentation.sections.map((section) => ({ key: section.key, data: section.groups })),
    [presentation.sections],
  );

  return (
    <SectionList
      contentContainerStyle={[styles.list, presentation.groups.length === 0 && styles.emptyList]}
      initialNumToRender={6}
      keyExtractor={(group) => group.id}
      maxToRenderPerBatch={6}
      removeClippedSubviews={Platform.OS === 'android'}
      renderItem={({ item }) => <DelegatedWorkCard group={item} {...callbacks} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{getSectionLabel(section.key, t)}</Text>
          <Text style={styles.sectionCount}>{section.data.length}</Text>
        </View>
      )}
      sections={sections}
      stickySectionHeadersEnabled={false}
      testID="delegated-work-queue"
      windowSize={7}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Sparkles size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t('agentRoster.emptyQueueTitle')}</Text>
          <Text style={styles.emptyDescription}>{t('agentRoster.emptyQueueDescription')}</Text>
        </View>
      }
    />
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    emptyList: { flexGrow: 1 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 18,
      paddingBottom: 8,
      backgroundColor: colors.background,
    },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    sectionCount: { fontSize: 12, color: colors.textTertiary },
    card: {
      gap: 12,
      padding: 14,
      marginBottom: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    statusIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitleWrap: { flex: 1, minWidth: 0, gap: 2 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    statusText: { fontSize: 12, fontWeight: '600' },
    iconAction: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      margin: -8,
    },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    metaText: { flexShrink: 1, fontSize: 12, color: colors.textTertiary },
    sourceText: { fontSize: 12, color: colors.textSecondary },
    previewText: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    primaryAction: { backgroundColor: colors.primary },
    primaryActionText: { fontSize: 13, fontWeight: '700', color: colors.onPrimary },
    secondaryAction: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryActionText: { fontSize: 13, fontWeight: '600', color: colors.primary },
    emptyState: {
      flex: 1,
      minHeight: 360,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 28,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
      backgroundColor: colors.primarySoft,
    },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
    emptyDescription: {
      maxWidth: 320,
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
