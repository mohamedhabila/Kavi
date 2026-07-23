import React from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type {
  MemoryFactRow,
  MemoryOverview,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type OverviewSectionProps = {
  colors: MemoryScreenPalette;
  loadOverviewFacts: (query: string) => void;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
  overviewSearch: string;
  setOverviewSearch: React.Dispatch<React.SetStateAction<string>>;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function OverviewSection({
  colors,
  loadOverviewFacts,
  overview,
  overviewFacts,
  overviewSearch,
  setOverviewSearch,
  styles,
  t,
}: OverviewSectionProps) {
  return (
    <View style={styles.editorContainer} testID="memory-overview-tab-panel">
      {overview ? (
        <>
          <Text style={styles.overviewSectionTitle}>{t('memory.overviewFocusTitle')}</Text>
          <Text style={styles.overviewBody} testID="memory-overview-focus">
            {overview.focus?.content?.trim() || t('memory.overviewFocusEmpty')}
          </Text>

          <Text style={styles.overviewSectionTitle}>{t('memory.overviewTaskTitle')}</Text>
          <Text style={styles.overviewBody} testID="memory-overview-task">
            {overview.activeTask?.title?.trim() || t('memory.overviewTaskEmpty')}
          </Text>

          <TextInput
            style={styles.factsSearch}
            value={overviewSearch}
            onChangeText={setOverviewSearch}
            onSubmitEditing={() => loadOverviewFacts(overviewSearch)}
            placeholder={t('memory.overviewSearchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="memory-overview-search"
          />

          <Text style={styles.overviewSectionTitle}>{t('memory.overviewRecentFactsTitle')}</Text>
          <ScrollView style={styles.editorScroll}>
            {overviewFacts.length === 0 ? (
              <Text style={styles.emptyText}>{t('memory.factsEmpty')}</Text>
            ) : (
              overviewFacts.map((fact) => (
                <View key={fact.id} style={styles.factRow} testID={`memory-overview-fact-${fact.id}`}>
                  <Text style={styles.factSubject}>
                    {fact.subject} · {fact.predicate}
                  </Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </>
      ) : (
        <Text style={styles.emptyText}>{t('memory.overviewLoading')}</Text>
      )}
    </View>
  );
}
