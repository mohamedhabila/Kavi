import React, { useMemo } from 'react';
import { FlatList, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  AlarmClock,
  Bot,
  ChevronRight,
  FileText,
  ListTree,
  ShieldCheck,
  Sparkles,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteLeadingButton } from '../navigation/RouteLeadingButton';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import {
  countActivityFeed,
  filterActivityFeed,
  type ActivityFilter,
  type ActivityItem,
  type ActivityItemStatus,
} from '../../services/activity/activityFeed';
import { createActivityFeedStyles } from './ActivityFeed.styles';

interface ActivityFeedViewProps {
  filter: ActivityFilter;
  items: ActivityItem[];
  onFilterChange: (filter: ActivityFilter) => void;
  onOpenAdvanced: () => void;
  onOpenArtifact: (item: ActivityItem, path: string) => void;
  onOpenAssistant: () => void;
  onOpenAutomations: () => void;
  onOpenItem: (item: ActivityItem) => void;
}

const FILTERS: ActivityFilter[] = ['pending', 'active', 'recent', 'automations'];

const FILTER_LABEL_KEYS: Record<ActivityFilter, string> = {
  pending: 'activity.filter.pending',
  active: 'activity.filter.active',
  recent: 'activity.filter.recent',
  automations: 'activity.filter.automations',
};

const STATUS_LABEL_KEYS: Record<ActivityItemStatus, string> = {
  waiting: 'activity.status.waiting',
  active: 'activity.status.active',
  'needs-attention': 'activity.status.needs-attention',
  scheduled: 'activity.status.scheduled',
  paused: 'activity.status.paused',
  completed: 'activity.status.completed',
  failed: 'activity.status.failed',
  denied: 'activity.status.denied',
  expired: 'activity.status.expired',
  interrupted: 'activity.status.interrupted',
  retrying: 'activity.status.retrying',
};

const EMPTY_COPY_KEYS: Record<ActivityFilter, { titleKey: string; hintKey: string }> = {
  pending: {
    titleKey: 'activity.empty.pendingTitle',
    hintKey: 'activity.empty.pendingHint',
  },
  active: {
    titleKey: 'activity.empty.activeTitle',
    hintKey: 'activity.empty.activeHint',
  },
  recent: {
    titleKey: 'activity.empty.recentTitle',
    hintKey: 'activity.empty.recentHint',
  },
  automations: {
    titleKey: 'activity.empty.automationsTitle',
    hintKey: 'activity.empty.automationsHint',
  },
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

function getFilterLabel(filter: ActivityFilter, t: Translate): string {
  return t(FILTER_LABEL_KEYS[filter]);
}

function getStatusLabel(status: ActivityItemStatus, t: Translate): string {
  return t(STATUS_LABEL_KEYS[status]);
}

function getFallbackTitle(item: ActivityItem, t: Translate): string {
  if (item.kind === 'approval') return t('activity.fallbackDecision');
  if (item.kind === 'automation' || item.kind === 'automation-result') {
    return t('activity.fallbackAutomation');
  }
  return t('activity.fallbackAssistantWork');
}

function getOpenHint(item: ActivityItem, t: Translate): string {
  if (item.kind === 'approval') return t('activity.openDecisionHint');
  if (item.kind === 'automation' || item.kind === 'automation-result') {
    return t('activity.openAutomationHint');
  }
  return t('activity.openConversationHint');
}

function getEmptyCopy(filter: ActivityFilter, t: Translate) {
  const keys = EMPTY_COPY_KEYS[filter];
  return {
    title: t(keys.titleKey),
    hint: t(keys.hintKey),
    action: filter === 'automations' ? t('activity.createAutomation') : t('activity.openAssistant'),
  };
}

function getStatusTone(status: ActivityItemStatus, colors: AppPalette) {
  switch (status) {
    case 'active':
    case 'scheduled':
      return { foreground: colors.primary, background: colors.primarySoft };
    case 'completed':
      return {
        foreground: colors.success || colors.primary,
        background: colors.primarySoft,
      };
    case 'failed':
    case 'denied':
      return { foreground: colors.danger, background: colors.dangerSoft || colors.surfaceAlt };
    case 'waiting':
    case 'needs-attention':
    case 'retrying':
      return {
        foreground: colors.warning || colors.textSecondary,
        background: colors.warningBackground || colors.surfaceAlt,
      };
    default:
      return { foreground: colors.textSecondary, background: colors.surfaceAlt };
  }
}

function formatActivityTime(timestamp: number, locale: string): string {
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

export const ActivityFeedView: React.FC<ActivityFeedViewProps> = ({
  filter,
  items,
  onFilterChange,
  onOpenAdvanced,
  onOpenArtifact,
  onOpenAssistant,
  onOpenAutomations,
  onOpenItem,
}) => {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createActivityFeedStyles(colors), [colors]);
  const counts = useMemo(() => countActivityFeed(items), [items]);
  const visibleItems = useMemo(() => filterActivityFeed(items, filter), [filter, items]);
  const emptyCopy = getEmptyCopy(filter, t);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="activity-feed">
      <View style={styles.header}>
        <RouteLeadingButton style={styles.headerButton} testID="activity-leading" />
        <Text style={styles.headerTitle}>{t('nav.activity')}</Text>
        <TouchableOpacity
          accessibilityLabel={t('nav.assistant')}
          accessibilityRole="button"
          onPress={onOpenAssistant}
          style={styles.headerButton}
          testID="activity-open-assistant"
        >
          <Sparkles size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.intro}>{t('activity.intro')}</Text>
      <ScrollView
        accessibilityLabel={t('activity.filtersLabel')}
        contentContainerStyle={styles.filterContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
      >
        {FILTERS.map((candidate) => {
          const selected = candidate === filter;
          const label = getFilterLabel(candidate, t);
          return (
            <TouchableOpacity
              accessibilityLabel={t('activity.filterLabelWithCount', {
                count: counts[candidate],
                label,
              })}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={candidate}
              onPress={() => onFilterChange(candidate)}
              style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
              testID={`activity-filter-${candidate}`}
            >
              <Text style={[styles.filterText, selected ? styles.filterTextSelected : null]}>
                {label}
              </Text>
              <Text style={[styles.filterCount, selected ? styles.filterCountSelected : null]}>
                {counts[candidate]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        contentContainerStyle={
          visibleItems.length > 0 ? styles.listContent : styles.listContentEmpty
        }
        data={visibleItems}
        initialNumToRender={16}
        keyExtractor={(item) => item.id}
        maxToRenderPerBatch={12}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item }) => {
          const statusLabel = getStatusLabel(item.status, t);
          const title = item.title || getFallbackTitle(item, t);
          const tone = getStatusTone(item.status, colors);
          const timestamp = formatActivityTime(item.timestamp, locale);
          const nextOccurrence = item.nextOccurrenceAt
            ? formatActivityTime(item.nextOccurrenceAt, locale)
            : '';
          const Icon =
            item.kind === 'approval'
              ? ShieldCheck
              : item.kind === 'automation' || item.kind === 'automation-result'
                ? AlarmClock
                : Bot;
          const artifactPath = item.artifactPaths?.[0];
          const accessibilityLabel = [
            statusLabel,
            title,
            item.sourceConversationTitle
              ? t('activity.fromConversation', { title: item.sourceConversationTitle })
              : '',
            timestamp,
          ]
            .filter(Boolean)
            .join(', ');

          return (
            <View style={styles.row}>
              <TouchableOpacity
                accessibilityHint={getOpenHint(item, t)}
                accessibilityLabel={accessibilityLabel}
                accessibilityRole="button"
                onPress={() => onOpenItem(item)}
                style={styles.rowMain}
                testID={`activity-item-${item.id}`}
              >
                <View
                  style={styles.iconWrap}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  <Icon size={20} color={tone.foreground} />
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTopLine}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
                      <Text style={[styles.statusText, { color: tone.foreground }]}>
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                  {item.detail ? (
                    <Text style={styles.detail} numberOfLines={2}>
                      {item.detail}
                    </Text>
                  ) : null}
                  <View style={styles.metadata}>
                    {item.sourceConversationTitle ? (
                      <Text style={styles.metadataText} numberOfLines={1}>
                        {t('activity.fromConversation', { title: item.sourceConversationTitle })}
                      </Text>
                    ) : null}
                    {timestamp ? <Text style={styles.metadataText}>{timestamp}</Text> : null}
                  </View>
                  {nextOccurrence ? (
                    <Text style={styles.nextOccurrence}>
                      {t('activity.nextOccurrence', { time: nextOccurrence })}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight color={colors.textTertiary} size={18} style={styles.rowChevron} />
              </TouchableOpacity>
              {artifactPath ? (
                <TouchableOpacity
                  accessibilityHint={t('activity.openCreationHint')}
                  accessibilityLabel={t('activity.openCreation')}
                  accessibilityRole="button"
                  onPress={() => onOpenArtifact(item, artifactPath)}
                  style={styles.artifactAction}
                  testID={`activity-artifact-${item.id}`}
                >
                  <FileText size={20} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        ListEmptyComponent={
          <View style={styles.emptyState} testID={`activity-empty-${filter}`}>
            <View style={styles.emptyIcon}>
              {filter === 'automations' ? (
                <AlarmClock size={28} color={colors.primary} />
              ) : (
                <ShieldCheck size={28} color={colors.primary} />
              )}
            </View>
            <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
            <Text style={styles.emptyHint}>{emptyCopy.hint}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={filter === 'automations' ? onOpenAutomations : onOpenAssistant}
              style={styles.primaryButton}
              testID={`activity-empty-action-${filter}`}
            >
              <Text style={styles.primaryButtonText}>{emptyCopy.action}</Text>
            </TouchableOpacity>
          </View>
        }
        ListFooterComponent={
          <TouchableOpacity
            accessibilityHint={t('activity.advancedHint')}
            accessibilityLabel={t('activity.advancedTitle')}
            accessibilityRole="button"
            onPress={onOpenAdvanced}
            style={styles.advancedButton}
            testID="activity-open-advanced-work"
          >
            <ListTree size={20} color={colors.textSecondary} />
            <View style={styles.advancedCopy}>
              <Text style={styles.advancedTitle}>{t('activity.advancedTitle')}</Text>
              <Text style={styles.advancedHint}>{t('activity.advancedHint')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        }
      />
    </SafeAreaView>
  );
};
