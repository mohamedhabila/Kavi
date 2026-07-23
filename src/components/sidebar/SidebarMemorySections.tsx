// ---------------------------------------------------------------------------
// Kavi — Sidebar memory sections
// ---------------------------------------------------------------------------
// Reusable contextual memory summaries for Assistant and Library surfaces.
// All memory reads are guarded so a missing/uninitialised SQLite store
// degrades gracefully (the section simply renders empty).
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Compass, Pin, Search, Brain } from 'lucide-react-native';
import { AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import type { Conversation } from '../../types/conversation';
import type { MemoryFact } from '../../services/memory/facts/types';
import { subscribeToMemoryChanges } from '../../services/memory/changeNotifications';

// ── Memory readers (guarded) ────────────────────────────────────────────────

function safeGetWorkingBlockContent(
  label: 'active_focus',
  options?: { conversationId?: string | null },
): string | null {
  try {
    const {
      getWorkingBlock,
      listRecentWorkingBlocks,
    } = require('../../services/memory/workingBlocks');
    const conversationId = options?.conversationId?.trim();
    if (conversationId) {
      const scopedBlock = getWorkingBlock(label, {
        conversationId,
        threadId: conversationId,
      });
      return scopedBlock?.content ?? null;
    }
    const block = listRecentWorkingBlocks(label, 1)?.[0];
    if (block?.content) return block.content;
  } catch {
    return null;
  }
  return null;
}

function safeListPinnedFacts(limit: number): MemoryFact[] {
  try {
    const { listFacts } = require('../../services/memory/facts/queries');
    return listFacts({ pinnedOnly: true, limit });
  } catch {
    return [];
  }
}

function safeCountFacts(): number {
  try {
    const { countFacts } = require('../../services/memory/facts/queries');
    return countFacts();
  } catch {
    return 0;
  }
}

function safeCountEpisodes(): number {
  try {
    const { countEpisodes } = require('../../services/memory/episodes/queries');
    return countEpisodes();
  } catch {
    return 0;
  }
}

function safeGetActiveTaskTitle(threadId?: string | null): string | null {
  if (!threadId) return null;
  try {
    const { getActiveTaskTitle } = require('../../services/memory/taskStack');
    return getActiveTaskTitle(threadId);
  } catch {
    return null;
  }
}

function useMemoryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      subscribeToMemoryChanges(() => {
        setVersion((current) => current + 1);
      }),
    [],
  );
  return version;
}

// ── Time bucketing ──────────────────────────────────────────────────────────

export type TimeBucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

export interface BucketedConversations {
  today: Conversation[];
  yesterday: Conversation[];
  thisWeek: Conversation[];
  earlier: Conversation[];
}

/**
 * Bucket conversations into Today / Yesterday / This week / Earlier based on
 * `updatedAt`. Each bucket preserves the input ordering (callers should sort
 * by recency upstream).
 */
export function bucketConversationsByTime(
  conversations: ReadonlyArray<Conversation>,
  now: number = Date.now(),
): BucketedConversations {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
  const startOfThisWeekMs = startOfTodayMs - 7 * 24 * 60 * 60 * 1000;

  const buckets: BucketedConversations = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  for (const c of conversations) {
    const ts = c.updatedAt ?? c.createdAt ?? 0;
    if (ts >= startOfTodayMs) buckets.today.push(c);
    else if (ts >= startOfYesterdayMs) buckets.yesterday.push(c);
    else if (ts >= startOfThisWeekMs) buckets.thisWeek.push(c);
    else buckets.earlier.push(c);
  }
  return buckets;
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface TodaysFocusTileProps {
  colors: AppPalette;
  conversationId?: string | null;
  onPress?: () => void;
}

export const TodaysFocusTile: React.FC<TodaysFocusTileProps> = ({
  colors,
  conversationId,
  onPress,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useMemoryVersion();
  const focus = (safeGetWorkingBlockContent('active_focus', { conversationId }) ?? '').trim();
  const isEmpty = focus.length === 0;

  if (isEmpty) {
    return null;
  }

  return (
    <TouchableOpacity
      style={styles.focusTile}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={t('nav.todaysFocus')}
      testID="sidebar-todays-focus"
    >
      <View style={styles.focusHeader}>
        <Compass size={14} color={colors.primary} />
        <Text style={styles.sectionTitle}>{t('nav.todaysFocus')}</Text>
      </View>
      <Text style={styles.focusBody} numberOfLines={3} testID="sidebar-todays-focus-body">
        {focus}
      </Text>
    </TouchableOpacity>
  );
};

interface RecallSearchInputProps {
  colors: AppPalette;
  onSubmit: (query: string) => void;
}

export const RecallSearchInput: React.FC<RecallSearchInputProps> = ({ colors, onSubmit }) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    setValue('');
  }, [onSubmit, value]);

  return (
    <View style={styles.section} testID="sidebar-recall">
      <View style={styles.recallRow}>
        <Search size={14} color={colors.textSecondary} />
        <TextInput
          style={styles.recallInput}
          value={value}
          onChangeText={setValue}
          placeholder={t('nav.recallPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          onSubmitEditing={handleSubmit}
          accessibilityLabel={t('nav.recallSearch')}
          testID="sidebar-recall-input"
        />
      </View>
    </View>
  );
};

interface PinnedMomentsProps {
  colors: AppPalette;
  onSelect?: (factId: string) => void;
  limit?: number;
}

export const PinnedMoments: React.FC<PinnedMomentsProps> = ({ colors, onSelect, limit = 5 }) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useMemoryVersion();
  const facts = safeListPinnedFacts(limit);

  return (
    <View style={styles.section} testID="sidebar-pinned-moments">
      <View style={styles.sectionHeader}>
        <Pin size={14} color={colors.textSecondary} />
        <Text style={styles.sectionTitle}>{t('nav.pinnedMoments')}</Text>
      </View>
      {facts.length === 0 ? (
        <Text style={styles.emptyHint} testID="sidebar-pinned-moments-empty">
          {t('nav.pinnedMomentsEmpty')}
        </Text>
      ) : (
        <View>
          {facts.map((fact) => {
            const summary = `${fact.predicate} · ${fact.objectText}`.trim();
            return (
              <TouchableOpacity
                key={fact.id}
                style={styles.pinnedRow}
                onPress={() => onSelect?.(fact.id)}
                accessibilityRole="button"
                accessibilityLabel={summary}
                testID={`sidebar-pinned-moment-${fact.id}`}
              >
                <Pin size={12} color={colors.primary} />
                <Text style={styles.pinnedText} numberOfLines={1}>
                  {summary}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

interface MemoryStatsProps {
  colors: AppPalette;
  conversationId?: string | null;
  consolidationTierLabel?: string | null;
  onPress?: () => void;
}

export const MemoryStats: React.FC<MemoryStatsProps> = ({
  colors,
  conversationId,
  consolidationTierLabel,
  onPress,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useMemoryVersion();
  const factCount = safeCountFacts();
  const episodeCount = safeCountEpisodes();
  const activeTask = safeGetActiveTaskTitle(conversationId);

  return (
    <TouchableOpacity
      style={styles.section}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={t('nav.memoryStats')}
      testID="sidebar-memory-stats"
    >
      <View style={styles.sectionHeader}>
        <Brain size={14} color={colors.textSecondary} />
        <Text style={styles.sectionTitle}>{t('nav.memoryStats')}</Text>
      </View>
      <View style={styles.statsRow}>
        <Text style={styles.statsItem} testID="sidebar-memory-facts">
          {t('nav.memoryStatsFacts', { count: factCount })}
        </Text>
        <Text style={styles.statsDot}>·</Text>
        <Text style={styles.statsItem} testID="sidebar-memory-episodes">
          {t('nav.memoryStatsEpisodes', { count: episodeCount })}
        </Text>
        {activeTask ? (
          <>
            <Text style={styles.statsDot}>·</Text>
            <Text style={styles.statsItemActive} numberOfLines={1} testID="sidebar-memory-task">
              {t('nav.memoryStatsActiveTask', { task: activeTask })}
            </Text>
          </>
        ) : null}
      </View>
      {consolidationTierLabel ? (
        <Text
          style={styles.consolidationChip}
          numberOfLines={2}
          testID="sidebar-memory-consolidation-tier"
        >
          {consolidationTierLabel}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    section: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    sectionTitle: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    emptyHint: {
      fontSize: 12,
      color: colors.textTertiary,
      fontStyle: 'italic',
    },
    focusTile: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.primarySoft,
    },
    focusHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    focusBody: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },
    recallRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    recallInput: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
      paddingVertical: 4,
    },
    pinnedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
    },
    pinnedText: {
      flex: 1,
      fontSize: 12,
      color: colors.text,
    },
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    statsItem: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    statsDot: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    statsItemActive: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '500',
      maxWidth: 180,
    },
    consolidationChip: {
      marginTop: 6,
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
    },
  });
