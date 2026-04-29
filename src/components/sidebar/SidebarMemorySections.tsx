// ---------------------------------------------------------------------------
// Kavi — Sidebar memory sections
// ---------------------------------------------------------------------------
// Renders the four memory-driven IA sections that sit above the conversation
// list:
//   1. Today's focus tile — current `active_focus` block.
//   2. Open threads chips — items parsed from the `open_threads` block.
//   3. Recall search input — opens the Memory screen with the query.
//   4. Pinned moments — top user-pinned facts.
// All memory reads are guarded so a missing/uninitialised SQLite store
// degrades gracefully (the section simply renders empty).
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Compass, Pin, Search, Hash } from 'lucide-react-native';
import { AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import type { Conversation } from '../../types';
import type { MemoryBlock } from '../../services/memory/blocks';
import { MemoryFact } from '@/services/memory/factStore';

// ── Memory readers (guarded) ────────────────────────────────────────────────

function safeGetBlock(label: string): MemoryBlock | null {
  try {
    // Lazy require so test harnesses that don't mock SQLite still load the
    // sidebar module without crashing at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBlock } = require('../../services/memory/blocks');
    return getBlock(label) ?? null;
  } catch {
    return null;
  }
}

function safeListPinnedFacts(limit: number): MemoryFact[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listFacts } = require('../../services/memory/facts');
    return listFacts({ pinnedOnly: true, limit });
  } catch {
    return [];
  }
}

// ── Open-threads parser ─────────────────────────────────────────────────────

/** Split `open_threads` block content into chip labels. */
export function parseOpenThreads(content: string | null | undefined): string[] {
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-•·*]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 12);
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
  onPress?: () => void;
}

export const TodaysFocusTile: React.FC<TodaysFocusTileProps> = ({ colors, onPress }) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const block = useMemo(() => safeGetBlock('active_focus'), []);
  const focus = (block?.content ?? '').trim();
  const isEmpty = focus.length === 0;

  return (
    <TouchableOpacity
      style={styles.focusTile}
      onPress={onPress}
      disabled={!onPress || isEmpty}
      accessibilityRole="button"
      accessibilityLabel={t('nav.todaysFocus')}
      testID="sidebar-todays-focus"
    >
      <View style={styles.focusHeader}>
        <Compass size={14} color={colors.primary} />
        <Text style={styles.sectionTitle}>{t('nav.todaysFocus')}</Text>
      </View>
      <Text
        style={[styles.focusBody, isEmpty && styles.focusBodyEmpty]}
        numberOfLines={3}
        testID="sidebar-todays-focus-body"
      >
        {isEmpty ? t('nav.todaysFocusEmpty') : focus}
      </Text>
    </TouchableOpacity>
  );
};

interface OpenThreadsChipsProps {
  colors: AppPalette;
  onSelect?: (label: string) => void;
}

export const OpenThreadsChips: React.FC<OpenThreadsChipsProps> = ({ colors, onSelect }) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const block = useMemo(() => safeGetBlock('open_threads'), []);
  const labels = useMemo(() => parseOpenThreads(block?.content), [block]);

  return (
    <View style={styles.section} testID="sidebar-open-threads">
      <View style={styles.sectionHeader}>
        <Hash size={14} color={colors.textSecondary} />
        <Text style={styles.sectionTitle}>{t('nav.openThreads')}</Text>
      </View>
      {labels.length === 0 ? (
        <Text style={styles.emptyHint} testID="sidebar-open-threads-empty">
          {t('nav.openThreadsEmpty')}
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={{ flexGrow: 0, flexShrink: 0 }}
        >
          {labels.map((label) => (
            <TouchableOpacity
              key={label}
              style={styles.chip}
              onPress={() => onSelect?.(label)}
              accessibilityRole="button"
              accessibilityLabel={label}
              testID={`sidebar-open-thread-${label}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
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

export const PinnedMoments: React.FC<PinnedMomentsProps> = ({
  colors,
  onSelect,
  limit = 5,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const facts = useMemo(() => safeListPinnedFacts(limit), [limit]);

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
    focusBodyEmpty: {
      color: colors.textTertiary,
      fontStyle: 'italic',
    },
    chipsRow: {
      gap: 6,
      paddingVertical: 2,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 180,
    },
    chipText: {
      fontSize: 12,
      color: colors.text,
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
  });
