import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Brain, Calendar, Compass, FileText, Layers, RefreshCw, Save, Trash2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlocksSection } from './BlocksSection';
import { DailySection } from './DailySection';
import { FactsSection } from './FactsSection';
import { GlobalSection } from './GlobalSection';
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
  charCount: number;
  colors: MemoryScreenPalette;
  dailyContent: string;
  dailyFiles: string[];
  diagnostics: MemoryDiagnostics | null;
  dirty: boolean;
  episodes: MemoryEpisodeRow[];
  facts: MemoryFactRow[];
  factsFilter: string;
  factsPinnedOnly: boolean;
  globalContent: string;
  handleBack: () => void;
  handleBlockDraftChange: (label: string, content: string) => void;
  handleBlockSave: (label: string) => void;
  handleClearAll: () => void;
  handleFactForget: (fact: MemoryFactRow) => void;
  handleFactToggleStar: (fact: MemoryFactRow) => void;
  handleGlobalChange: (text: string) => void;
  handleSave: () => void;
  hasExternalGlobalUpdate: boolean;
  lineCount: number;
  loadBlocks: () => void;
  loadDailyContent: (date: string) => Promise<void>;
  loadDailyList: (preferredDate?: string | null) => Promise<void>;
  loadFacts: () => void;
  loadGlobalMemory: (preserveDirty?: boolean) => Promise<void>;
  loadOverviewFacts: (query: string) => void;
  memoryStatus: string;
  overview: MemoryOverview | null;
  overviewFacts: MemoryFactRow[];
  overviewSearch: string;
  refreshMemory: (preserveDirty?: boolean) => Promise<void>;
  selectedDate: string | null;
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
  charCount,
  colors,
  dailyContent,
  dailyFiles,
  diagnostics,
  dirty,
  episodes,
  facts,
  factsFilter,
  factsPinnedOnly,
  globalContent,
  handleBack,
  handleBlockDraftChange,
  handleBlockSave,
  handleClearAll,
  handleFactForget,
  handleFactToggleStar,
  handleGlobalChange,
  handleSave,
  hasExternalGlobalUpdate,
  lineCount,
  loadBlocks,
  loadDailyContent,
  loadDailyList,
  loadFacts,
  loadGlobalMemory,
  loadOverviewFacts,
  memoryStatus,
  overview,
  overviewFacts,
  overviewSearch,
  refreshMemory,
  selectedDate,
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
            onPress={() => void refreshMemory(true)}
            accessibilityLabel={t('common.refresh')}
          >
            <RefreshCw size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {tab === 'global' && dirty ? (
            <TouchableOpacity onPress={handleSave} accessibilityLabel={t('memory.save')}>
              <Save size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
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
          style={[styles.tab, tab === 'global' && styles.tabActive]}
          onPress={() => setTab('global')}
        >
          <FileText size={16} color={tab === 'global' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'global' && styles.tabTextActive]}>
            {t('memory.globalTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'daily' && styles.tabActive]}
          onPress={() => {
            setTab('daily');
            void loadDailyList();
          }}
        >
          <Calendar size={16} color={tab === 'daily' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'daily' && styles.tabTextActive]}>
            {t('memory.dailyTab')} ({dailyFiles.length})
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
      ) : tab === 'global' ? (
        <GlobalSection
          charCount={charCount}
          colors={colors}
          dirty={dirty}
          globalContent={globalContent}
          handleGlobalChange={handleGlobalChange}
          hasExternalGlobalUpdate={hasExternalGlobalUpdate}
          lineCount={lineCount}
          loadGlobalMemory={loadGlobalMemory}
          memoryStatus={memoryStatus}
          styles={styles}
          t={t}
        />
      ) : tab === 'daily' ? (
        <DailySection
          dailyContent={dailyContent}
          dailyFiles={dailyFiles}
          loadDailyContent={loadDailyContent}
          memoryStatus={memoryStatus}
          selectedDate={selectedDate}
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
