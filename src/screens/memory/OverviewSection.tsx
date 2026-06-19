import React from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { MemoryDiagnosticsPanel } from '../../components/memory/MemoryDiagnosticsPanel';
import { consolidationTierLabel } from './consolidationStatusLabel';
import type {
  MemoryDiagnostics,
  MemoryFactRow,
  MemoryOverview,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type OverviewSectionProps = {
  colors: MemoryScreenPalette;
  diagnostics: MemoryDiagnostics | null;
  loadOverviewFacts: (query: string) => void;
  memoryStatus: string;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
  overviewSearch: string;
  setOverviewSearch: React.Dispatch<React.SetStateAction<string>>;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function OverviewSection({
  colors,
  diagnostics,
  loadOverviewFacts,
  memoryStatus,
  overview,
  overviewFacts,
  overviewSearch,
  setOverviewSearch,
  styles,
  t,
}: OverviewSectionProps) {
  return (
    <View style={styles.editorContainer} testID="memory-overview-tab-panel">
      <Text style={styles.statusLine}>{memoryStatus}</Text>
      {overview ? (
        <>
          <Text style={styles.overviewSectionTitle}>{t('memory.overviewConsolidationTitle')}</Text>
          <Text style={styles.overviewBody} testID="memory-overview-consolidation">
            {consolidationTierLabel(overview.consolidation, t)}
            {overview.consolidation.isFallback && !overview.consolidation.memoryDisabled
              ? ` · ${t('memory.consolidationFallbackActive')}`
              : ''}
          </Text>
          {overview.pendingIngestionJobs > 0 ? (
            <Text style={styles.statusLine} testID="memory-overview-ingestion-pending">
              {t('memory.ingestionPendingJobs', { count: overview.pendingIngestionJobs })}
            </Text>
          ) : null}

          <Text style={styles.overviewSectionTitle}>{t('memory.overviewFocusTitle')}</Text>
          <Text style={styles.overviewBody} testID="memory-overview-focus">
            {overview.focus?.content?.trim() || t('memory.overviewFocusEmpty')}
          </Text>

          <Text style={styles.overviewSectionTitle}>{t('memory.overviewTaskTitle')}</Text>
          <Text style={styles.overviewBody} testID="memory-overview-task">
            {overview.activeTask?.title?.trim() || t('memory.overviewTaskEmpty')}
          </Text>

          {diagnostics ? <MemoryDiagnosticsPanel diagnostics={diagnostics} /> : null}

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
