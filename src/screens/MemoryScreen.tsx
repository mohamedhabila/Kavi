// ---------------------------------------------------------------------------
// Kavi — Memory Viewer / Editor Screen
// ---------------------------------------------------------------------------
// Lets users view, edit and manage persistent memory (MEMORY.md + daily).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { loadMemoryDiagnosticsSnapshot } from '../services/memory/memoryDiagnostics';
import { loadMemoryOverviewSnapshot } from '../services/memory/memoryOverview';
import { useChatStore } from '../store/useChatStore';
import {
  getMemoryLastUpdatedAt,
  readGlobalMemory,
  writeGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
  clearAllMemory,
  subscribeToMemoryChanges,
} from '../services/memory/store';
import {
  executeMemoryRecall,
  executeMemoryForget,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryBlockRead,
  executeMemoryBlockEdit,
} from '../services/memory/memoryTools';
import { recallRecentEpisodes } from '../services/memory/episodeRecall';
import { useAppTheme } from '../theme/useAppTheme';
import { MemoryScreenView } from './memory/MemoryScreenView';
import type {
  MemoryBlockRow as BlockRow,
  MemoryDiagnostics,
  MemoryEpisodeRow as MemoryEpisode,
  MemoryFactRow as FactRow,
  MemoryOverview,
  MemoryTab as Tab,
} from './memory/memoryScreenTypes';
import { createMemoryScreenStyles as createStyles } from './memory/memoryScreenStyles';
import { useTranslation } from '../i18n/useTranslation';
import { useBackToChat } from '../navigation/useBackToChat';

function resolveRouteTab(tabParam: unknown): Tab {
  if (tabParam === 'blocks') return 'blocks';
  if (tabParam === 'facts') return 'facts';
  if (tabParam === 'global') return 'global';
  if (tabParam === 'daily') return 'daily';
  return 'overview';
}

export const MemoryScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const route = useRoute<any>();
  const handleBack = useBackToChat();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const routeQuery = typeof route.params?.query === 'string' ? route.params.query.trim() : '';
  const routeTab = resolveRouteTab(route.params?.tab);

  const [tab, setTab] = useState<Tab>(routeTab);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [diagnostics, setDiagnostics] = useState<MemoryDiagnostics | null>(null);
  const [overviewSearch, setOverviewSearch] = useState(routeQuery);
  const [overviewFacts, setOverviewFacts] = useState<FactRow[]>([]);
  const [globalContent, setGlobalContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [dailyFiles, setDailyFiles] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailyContent, setDailyContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => getMemoryLastUpdatedAt());
  const [hasExternalGlobalUpdate, setHasExternalGlobalUpdate] = useState(false);

  // Facts tab state.
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [factsFilter, setFactsFilter] = useState(routeQuery);
  const [factsPinnedOnly, setFactsPinnedOnly] = useState(false);
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);

  // Blocks tab state.
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [blockDrafts, setBlockDrafts] = useState<Record<string, string>>({});

  const dirtyRef = useRef(false);
  const selectedDateRef = useRef<string | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    if (!route.params?.tab && !routeQuery) return;
    setTab(resolveRouteTab(route.params?.tab));
    if (routeQuery) {
      setOverviewSearch(routeQuery);
      setFactsFilter(routeQuery);
    }
  }, [route.params?.tab, routeQuery]);

  const loadGlobalMemory = useCallback(async (preserveDirty = false) => {
    if (preserveDirty && dirtyRef.current) {
      setHasExternalGlobalUpdate(true);
      return;
    }

    const content = await readGlobalMemory();
    const text = content || '';
    setGlobalContent(text);
    setOriginalContent(text);
    setDirty(false);
    setHasExternalGlobalUpdate(false);
  }, []);

  const loadDailyContent = useCallback(async (date: string) => {
    setSelectedDate(date);
    const content = await readDailyMemory(date);
    setDailyContent(content || '(empty)');
  }, []);

  const loadDailyList = useCallback(
    async (preferredDate?: string | null) => {
      const files = listDailyMemoryFiles();
      setDailyFiles(files);

      const nextSelection =
        preferredDate && files.includes(preferredDate)
          ? preferredDate
          : selectedDateRef.current && files.includes(selectedDateRef.current)
            ? selectedDateRef.current
            : files[0] || null;

      if (!nextSelection) {
        setSelectedDate(null);
        setDailyContent('');
        return;
      }

      await loadDailyContent(nextSelection);
    },
    [loadDailyContent],
  );

  const loadFacts = useCallback(() => {
    const subject = factsFilter.trim();
    const result = executeMemoryRecall({
      ...(subject ? { subject } : {}),
      ...(factsPinnedOnly ? { pinnedOnly: true } : {}),
      ...(!subject && !factsPinnedOnly ? { all: true } : {}),
      limit: 100,
    });
    if ('ok' in result && result.ok) {
      setFacts(result.facts);
    } else {
      setFacts([]);
    }
  }, [factsFilter, factsPinnedOnly]);

  const loadBlocks = useCallback(() => {
    const result = executeMemoryBlockRead({});
    if ('ok' in result && result.ok) {
      setBlocks(result.blocks);
      setBlockDrafts((prev) => {
        // Preserve in-flight edits; only seed labels we don't yet have a draft for.
        const next = { ...prev };
        for (const block of result.blocks) {
          if (next[block.label] === undefined) {
            next[block.label] = block.content;
          }
        }
        return next;
      });
    } else {
      setBlocks([]);
    }
  }, []);

  const loadEpisodes = useCallback(() => {
    try {
      setEpisodes(recallRecentEpisodes({ limit: 20 }));
    } catch {
      setEpisodes([]);
    }
  }, []);

  const loadOverviewFacts = useCallback((query: string) => {
    const subject = query.trim();
    const result = executeMemoryRecall({
      ...(subject ? { subject } : { all: true }),
      limit: 8,
    });
    if ('ok' in result && result.ok) {
      setOverviewFacts(result.facts);
    } else {
      setOverviewFacts([]);
    }
  }, []);

  const loadOverviewSnapshot = useCallback(() => {
    try {
      setOverview(loadMemoryOverviewSnapshot({ recentFactLimit: 8 }));
      const threadId = useChatStore.getState().activeConversationId;
      setDiagnostics(loadMemoryDiagnosticsSnapshot({ threadId }));
    } catch {
      setOverview(null);
      setDiagnostics(null);
    }
  }, []);

  const refreshMemory = useCallback(
    async (preserveDirty = true) => {
      setIsRefreshing(true);
      try {
        await Promise.all([loadGlobalMemory(preserveDirty), loadDailyList()]);
        loadOverviewSnapshot();
        loadFacts();
        loadBlocks();
        loadEpisodes();
        setLastSyncedAt(Date.now());
      } finally {
        setIsRefreshing(false);
      }
    },
    [loadDailyList, loadGlobalMemory, loadOverviewSnapshot, loadFacts, loadBlocks, loadEpisodes],
  );

  useEffect(() => {
    if (tab !== 'overview') return;
    loadOverviewSnapshot();
    loadOverviewFacts(overviewSearch);
  }, [tab, overviewSearch, loadOverviewSnapshot, loadOverviewFacts]);

  useEffect(() => {
    void refreshMemory(false);
  }, [refreshMemory]);

  useFocusEffect(
    useCallback(() => {
      void refreshMemory(true);
      return undefined;
    }, [refreshMemory]),
  );

  useEffect(() => {
    const unsubscribe = subscribeToMemoryChanges((event) => {
      if (event.scope === 'global' || event.scope === 'all') {
        void loadGlobalMemory(true).then(() => {
          setLastSyncedAt(event.updatedAt);
        });
      }

      if (event.scope === 'daily' || event.scope === 'all') {
        void loadDailyList(selectedDateRef.current).then(() => {
          setLastSyncedAt(event.updatedAt);
        });
      }

      if (event.scope === 'structured' || event.scope === 'conversation' || event.scope === 'all') {
        loadOverviewSnapshot();
        if (tab === 'overview') {
          loadOverviewFacts(overviewSearch);
        }
        loadFacts();
        loadBlocks();
        loadEpisodes();
        setLastSyncedAt(event.updatedAt);
      }
    });

    return unsubscribe;
  }, [
    loadDailyList,
    loadGlobalMemory,
    loadOverviewSnapshot,
    loadOverviewFacts,
    loadFacts,
    loadBlocks,
    loadEpisodes,
    tab,
    overviewSearch,
  ]);

  const handleSave = useCallback(() => {
    writeGlobalMemory(globalContent);
    setOriginalContent(globalContent);
    setDirty(false);
    setHasExternalGlobalUpdate(false);
    setLastSyncedAt(Date.now());
    Alert.alert(t('memory.saved'), t('memory.savedDesc'));
  }, [globalContent, t]);

  const handleClearAll = useCallback(() => {
    Alert.alert(t('memory.clearTitle'), t('memory.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('memory.clearAction'),
        style: 'destructive',
        onPress: () => {
          clearAllMemory();
          setGlobalContent('');
          setOriginalContent('');
          setDailyFiles([]);
          setDailyContent('');
          setSelectedDate(null);
          setDirty(false);
          setHasExternalGlobalUpdate(false);
          setLastSyncedAt(Date.now());
        },
      },
    ]);
  }, [t]);

  const handleGlobalChange = useCallback(
    (text: string) => {
      setGlobalContent(text);
      setDirty(text !== originalContent);
    },
    [originalContent],
  );

  // Re-query when facts filter / pinned toggle changes.
  useEffect(() => {
    if (tab !== 'facts') return;
    loadFacts();
    loadEpisodes();
  }, [tab, loadFacts, loadEpisodes]);

  const handleFactToggleStar = useCallback(
    (fact: FactRow) => {
      const result = fact.pinned
        ? executeMemoryUnpin({ factId: fact.id })
        : executeMemoryPin({ factId: fact.id });
      if ('ok' in result && result.ok) {
        loadFacts();
      }
    },
    [loadFacts],
  );

  const handleFactForget = useCallback(
    (fact: FactRow) => {
      const result = executeMemoryForget({ factId: fact.id, mode: 'invalidate' });
      if ('ok' in result && result.ok) {
        loadFacts();
      }
    },
    [loadFacts],
  );

  const handleBlockDraftChange = useCallback((label: string, content: string) => {
    setBlockDrafts((prev) => ({ ...prev, [label]: content }));
  }, []);

  const handleBlockSave = useCallback(
    (label: string) => {
      const draft = blockDrafts[label] ?? '';
      const result = executeMemoryBlockEdit({ label, content: draft, replace: true });
      if ('ok' in result && result.ok) {
        loadBlocks();
      }
    },
    [blockDrafts, loadBlocks],
  );

  const charCount = globalContent.length;
  const lineCount = globalContent ? globalContent.split('\n').length : 0;
  const memoryStatus = isRefreshing
    ? t('memory.refreshing')
    : lastSyncedAt
      ? t('memory.lastSynced', { time: new Date(lastSyncedAt).toLocaleTimeString() })
      : t('memory.notSyncedYet');

  return (
    <MemoryScreenView
      blockDrafts={blockDrafts}
      blocks={blocks}
      charCount={charCount}
      colors={colors}
      dailyContent={dailyContent}
      dailyFiles={dailyFiles}
      diagnostics={diagnostics}
      dirty={dirty}
      episodes={episodes}
      facts={facts}
      factsFilter={factsFilter}
      factsPinnedOnly={factsPinnedOnly}
      globalContent={globalContent}
      handleBack={handleBack}
      handleBlockDraftChange={handleBlockDraftChange}
      handleBlockSave={handleBlockSave}
      handleClearAll={handleClearAll}
      handleFactForget={handleFactForget}
      handleFactToggleStar={handleFactToggleStar}
      handleGlobalChange={handleGlobalChange}
      handleSave={handleSave}
      hasExternalGlobalUpdate={hasExternalGlobalUpdate}
      lineCount={lineCount}
      loadBlocks={loadBlocks}
      loadDailyContent={loadDailyContent}
      loadDailyList={loadDailyList}
      loadFacts={loadFacts}
      loadGlobalMemory={loadGlobalMemory}
      loadOverviewFacts={loadOverviewFacts}
      memoryStatus={memoryStatus}
      overview={overview}
      overviewFacts={overviewFacts}
      overviewSearch={overviewSearch}
      refreshMemory={refreshMemory}
      selectedDate={selectedDate}
      setFactsFilter={setFactsFilter}
      setFactsPinnedOnly={setFactsPinnedOnly}
      setOverviewSearch={setOverviewSearch}
      setTab={setTab}
      styles={styles}
      t={t}
      tab={tab}
    />
  );
};
