import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Brain, Compass, Layers, RefreshCw, Trash2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlocksSection } from './BlocksSection';
import { FactsSection } from './FactsSection';
import { OverviewSection } from './OverviewSection';
import type {
  MemoryBlockRow,
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
  blockDrafts: Record<string, string>;
  blocks: MemoryBlockRow[];
  colors: MemoryScreenPalette;
  diagnostics: MemoryDiagnostics | null;
  episodes: MemoryEpisodeRow[];
  facts: MemoryFactRow[];
  factsFilter: string;
  factsPinnedOnly: boolean;
  handleBack: () => void;
  handleBlockDraftChange: (label: string, content: string) => void;
  handleBlockSave: (label: string) => void;
  handleClearAll: () => void;
  handleFactForget: (fact: MemoryFactRow) => void;
  handleFactToggleStar: (fact: MemoryFactRow) => void;
  loadBlocks: () => void;
  loadFacts: () => void;
  loadOverviewFacts: (query: string) => void;
  memoryStatus: string;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
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
  blockDrafts,
  blocks,
  colors,
  diagnostics,
  episodes,
  facts,
  factsFilter,
  factsPinnedOnly,
  handleBack,
  handleBlockDraftChange,
  handleBlockSave,
  handleClearAll,
  handleFactForget,
  handleFactToggleStar,
  loadBlocks,
  loadFacts,
  loadOverviewFacts,
  memoryStatus,
  overview,
  overviewFacts,
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
        <TouchableOpacity onPress={handleBack} accessibilityLabel={t('common.back')}>
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('memory.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => void refreshMemory()}
            accessibilityLabel={t('common.refresh')}
          >
            <RefreshCw size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleClearAll}
            style={styles.dangerBtn}
            accessibilityLabel={t('memory.clearAction')}
          >
            <Trash2 size={18} color={colors.danger} />
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
        >
          <Brain size={16} color={tab === 'facts' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'facts' && styles.tabTextActive]}>
            {t('memory.factsTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'blocks' && styles.tabActive]}
          onPress={() => {
            setTab('blocks');
            loadBlocks();
          }}
          accessibilityLabel={t('memory.blocksTab')}
        >
          <Layers size={16} color={tab === 'blocks' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'blocks' && styles.tabTextActive]}>
            {t('memory.blocksTab')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {tab === 'overview' ? (
        <OverviewSection
          colors={colors}
          diagnostics={diagnostics}
          loadOverviewFacts={loadOverviewFacts}
          memoryStatus={memoryStatus}
          overview={overview}
          overviewFacts={overviewFacts}
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
          handleFactForget={handleFactForget}
          handleFactToggleStar={handleFactToggleStar}
          setFactsFilter={setFactsFilter}
          setFactsPinnedOnly={setFactsPinnedOnly}
          styles={styles}
          t={t}
        />
      ) : (
        <BlocksSection
          blockDrafts={blockDrafts}
          blocks={blocks}
          colors={colors}
          handleBlockDraftChange={handleBlockDraftChange}
          handleBlockSave={handleBlockSave}
          styles={styles}
          t={t}
        />
      )}

      <Text style={styles.attributionFooter} testID="memory-attribution-footer">
        {t('memory.attribution')}
      </Text>
    </SafeAreaView>
  );
}
