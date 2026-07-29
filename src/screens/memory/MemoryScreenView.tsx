import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Brain, Compass, RefreshCw, Settings2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FactsSection } from './FactsSection';
import { OverviewSection } from './OverviewSection';
import { AdvancedSection } from './AdvancedSection';
import { MemoryCorrectionModal } from './MemoryCorrectionModal';
import type { MemoryFactManagementController } from './useMemoryFactManagement';
import type {
  MemoryDiagnostics,
  MemoryEpisodeRow,
  MemoryFactRow,
  MemoryOverview,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
  MemoryTab,
} from './memoryScreenTypes';

type MemoryScreenViewProps = {
  colors: MemoryScreenPalette;
  diagnostics: MemoryDiagnostics | null;
  diagnosticsError: boolean;
  diagnosticsExpanded: boolean;
  diagnosticsLoading: boolean;
  episodes: MemoryEpisodeRow[];
  facts: MemoryFactRow[];
  factsFilter: string;
  factsPinnedOnly: boolean;
  factManagement: MemoryFactManagementController;
  handleAskKavi: () => void;
  handleBack: () => void;
  handleClearAll: () => void;
  loadFacts: () => void;
  memoryStatus: string;
  onToggleDiagnostics: () => void;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
  overviewLoaded: boolean;
  overviewSearch: string;
  refreshMemory: () => Promise<void>;
  setFactsFilter: React.Dispatch<React.SetStateAction<string>>;
  setFactsPinnedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setOverviewSearch: React.Dispatch<React.SetStateAction<string>>;
  setTab: React.Dispatch<React.SetStateAction<MemoryTab>>;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
  tab: MemoryTab;
};

export function MemoryScreenView({
  colors,
  diagnostics,
  diagnosticsError,
  diagnosticsExpanded,
  diagnosticsLoading,
  episodes,
  facts,
  factsFilter,
  factsPinnedOnly,
  factManagement,
  handleAskKavi,
  handleBack,
  handleClearAll,
  loadFacts,
  memoryStatus,
  onToggleDiagnostics,
  overview,
  overviewFacts,
  overviewLoaded,
  overviewSearch,
  refreshMemory,
  setFactsFilter,
  setFactsPinnedOnly,
  setOverviewSearch,
  setTab,
  styles,
  t,
  tab,
}: MemoryScreenViewProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          onPress={handleBack}
          style={styles.headerButton}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('memory.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void refreshMemory()}
            style={styles.headerButton}
            accessibilityLabel={t('common.refresh')}
            testID="memory-refresh"
          >
            <RefreshCw size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        <TouchableOpacity
          style={[styles.tab, tab === 'overview' && styles.tabActive]}
          onPress={() => setTab('overview')}
          accessibilityLabel={t('memory.overviewTab')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'overview' }}
          testID="memory-overview-tab"
        >
          <Compass size={16} color={tab === 'overview' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'overview' && styles.tabTextActive]}>
            {t('memory.overviewTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'facts' && styles.tabActive]}
          onPress={() => {
            setTab('facts');
            loadFacts();
          }}
          accessibilityLabel={t('memory.factsTab')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'facts' }}
          testID="memory-facts-tab-trigger"
        >
          <Brain size={16} color={tab === 'facts' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'facts' && styles.tabTextActive]}>
            {t('memory.factsTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'advanced' && styles.tabActive]}
          onPress={() => setTab('advanced')}
          accessibilityLabel={t('memory.advancedTab')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'advanced' }}
          testID="memory-advanced-tab"
        >
          <Settings2 size={16} color={tab === 'advanced' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'advanced' && styles.tabTextActive]}>
            {t('memory.advancedTab')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {tab === 'overview' ? (
        <OverviewSection
          colors={colors}
          onAskKavi={handleAskKavi}
          onCorrect={factManagement.handleFactCorrect}
          onForget={factManagement.handleFactForget}
          onRetry={() => void refreshMemory()}
          onTogglePin={factManagement.handleFactTogglePin}
          overview={overview}
          overviewFacts={overviewFacts}
          overviewLoaded={overviewLoaded}
          overviewSearch={overviewSearch}
          setOverviewSearch={setOverviewSearch}
          styles={styles}
          t={t}
        />
      ) : tab === 'facts' ? (
        <FactsSection
          colors={colors}
          episodes={episodes}
          facts={facts}
          factsFilter={factsFilter}
          factsPinnedOnly={factsPinnedOnly}
          handleFactCorrect={factManagement.handleFactCorrect}
          handleFactForget={factManagement.handleFactForget}
          handleFactTogglePin={factManagement.handleFactTogglePin}
          setFactsFilter={setFactsFilter}
          setFactsPinnedOnly={setFactsPinnedOnly}
          styles={styles}
          t={t}
        />
      ) : (
        <AdvancedSection
          colors={colors}
          diagnostics={diagnostics}
          diagnosticsError={diagnosticsError}
          diagnosticsExpanded={diagnosticsExpanded}
          diagnosticsLoading={diagnosticsLoading}
          handleClearAll={handleClearAll}
          memoryStatus={memoryStatus}
          onToggleDiagnostics={onToggleDiagnostics}
          overview={overview}
          styles={styles}
          t={t}
        />
      )}

      {tab === 'advanced' ? (
        <Text style={styles.attributionFooter} testID="memory-attribution-footer">
          {t('memory.attribution')}
        </Text>
      ) : null}
      <MemoryCorrectionModal
        colors={colors}
        error={factManagement.correctionError}
        fact={factManagement.correctionFact}
        onCancel={factManagement.cancelCorrection}
        onEdit={factManagement.clearCorrectionError}
        onSave={factManagement.saveCorrection}
        t={t}
      />
    </SafeAreaView>
  );
}
