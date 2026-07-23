import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ListTodo, MessageCircle, RefreshCw, Target } from 'lucide-react-native';

import { MemoryFactCard } from './MemoryFactCard';

import type {
  MemoryFactRow,
  MemoryOverview,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type OverviewSectionProps = {
  colors: MemoryScreenPalette;
  onAskKavi: () => void;
  onCorrect: (fact: MemoryFactRow) => void;
  onForget: (fact: MemoryFactRow) => void;
  onRetry: () => void;
  onTogglePin: (fact: MemoryFactRow) => void;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
  overviewLoaded: boolean;
  overviewSearch: string;
  setOverviewSearch: React.Dispatch<React.SetStateAction<string>>;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function OverviewSection({
  colors,
  onAskKavi,
  onCorrect,
  onForget,
  onRetry,
  onTogglePin,
  overview,
  overviewFacts,
  overviewLoaded,
  overviewSearch,
  setOverviewSearch,
  styles,
  t,
}: OverviewSectionProps) {
  if (!overview) {
    return (
      <View style={styles.editorContainer} testID="memory-overview-tab-panel">
        {overviewLoaded ? (
          <View style={styles.overviewUnavailableCard} testID="memory-overview-unavailable">
            <Text style={styles.overviewUnavailableText}>{t('memory.overviewUnavailable')}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onRetry}
              style={styles.overviewSecondaryAction}
              testID="memory-overview-retry"
            >
              <RefreshCw size={16} color={colors.primary} />
              <Text style={styles.overviewSecondaryActionText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={styles.emptyText}>
            {t('memory.overviewLoading')}
          </Text>
        )}
      </View>
    );
  }

  const focus = overview.focus?.content?.trim() ?? '';
  const activeTask = overview.activeTask?.title?.trim() ?? '';
  const hasSearch = overviewSearch.trim().length > 0;

  return (
    <View style={styles.editorContainer} testID="memory-overview-tab-panel">
      <ScrollView
        contentContainerStyle={styles.overviewContent}
        keyboardShouldPersistTaps="handled"
        style={styles.editorScroll}
      >
        <View style={styles.overviewHero}>
          <Text accessibilityRole="header" style={styles.overviewHeading}>
            {t('memory.overviewHeading')}
          </Text>
          <Text style={styles.overviewIntro}>{t('memory.overviewIntro')}</Text>
        </View>

        <View style={styles.overviewSummaryCard}>
          <View style={styles.overviewSummaryHeader}>
            <View style={styles.overviewSummaryIcon}>
              <Target size={18} color={colors.primary} />
            </View>
            <Text accessibilityRole="header" style={styles.overviewSummaryTitle}>
              {t('memory.overviewFocusTitle')}
            </Text>
          </View>
          <Text
            style={focus ? styles.overviewSummaryValue : styles.overviewSummaryEmpty}
            testID="memory-overview-focus"
          >
            {focus || t('memory.overviewFocusEmpty')}
          </Text>
          {!focus ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onAskKavi}
              style={styles.overviewPrimaryAction}
              testID="memory-overview-ask-kavi"
            >
              <MessageCircle size={17} color={colors.onPrimary} />
              <Text style={styles.overviewPrimaryActionText}>
                {t('memory.overviewFocusAction')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.overviewSummaryCard}>
          <View style={styles.overviewSummaryHeader}>
            <View style={styles.overviewSummaryIcon}>
              <ListTodo size={18} color={colors.primary} />
            </View>
            <Text accessibilityRole="header" style={styles.overviewSummaryTitle}>
              {t('memory.overviewTaskTitle')}
            </Text>
          </View>
          <Text
            style={activeTask ? styles.overviewSummaryValue : styles.overviewSummaryEmpty}
            testID="memory-overview-task"
          >
            {activeTask || t('memory.overviewTaskEmpty')}
          </Text>
        </View>

        <Text style={styles.overviewSearchLabel}>{t('memory.overviewSearchLabel')}</Text>
        <TextInput
          accessibilityLabel={t('memory.overviewSearchLabel')}
          autoCapitalize="none"
          autoCorrect
          onChangeText={setOverviewSearch}
          placeholder={t('memory.overviewSearchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          style={styles.factsSearch}
          testID="memory-overview-search"
          value={overviewSearch}
        />

        <Text accessibilityRole="header" style={styles.overviewRecentTitle}>
          {hasSearch
            ? t('memory.overviewSearchResultsTitle')
            : t('memory.overviewRecentFactsTitle')}
        </Text>
        {overviewFacts.length === 0 ? (
          <Text style={styles.overviewRecentEmpty}>
            {hasSearch ? t('memory.overviewSearchEmpty') : t('memory.overviewRecentEmpty')}
          </Text>
        ) : (
          overviewFacts.map((fact) => (
            <MemoryFactCard
              colors={colors}
              fact={fact}
              key={fact.id}
              onCorrect={onCorrect}
              onForget={onForget}
              onTogglePin={onTogglePin}
              t={t}
              testIDPrefix="memory-overview-fact"
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
