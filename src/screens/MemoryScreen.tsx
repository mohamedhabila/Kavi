// ---------------------------------------------------------------------------
// Kavi — Memory Viewer / Editor Screen
// ---------------------------------------------------------------------------
// Lets users inspect and manage the canonical structured memory system.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { loadMemoryDiagnosticsSnapshot } from '../services/memory/memoryDiagnostics';
import { loadMemoryOverviewSnapshot } from '../services/memory/memoryOverview';
import { useChatStore } from '../store/useChatStore';
import {
  getMemoryLastUpdatedAt,
  subscribeToMemoryChanges,
} from '../services/memory/changeNotifications';
import { resetCanonicalMemoryForManagement } from '../services/memory/memoryReset';
import {
  queryMemoryFactsForManagement,
  forgetMemoryFactForManagement,
  setMemoryFactPinnedForManagement,
} from '../services/memory/memoryTools';
import { recallRecentEpisodes } from '../services/memory/episodeRecall';
import { useAppTheme } from '../theme/useAppTheme';
import { MemoryScreenView } from './memory/MemoryScreenView';
import type {
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
  if (tabParam === 'facts') return 'facts';
  if (tabParam === 'advanced') return 'advanced';
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
  const [diagnosticsError, setDiagnosticsError] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState(routeQuery);
  const [overviewFacts, setOverviewFacts] = useState<FactRow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => getMemoryLastUpdatedAt());

  // Facts tab state.
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [factsFilter, setFactsFilter] = useState(routeQuery);
  const [factsPinnedOnly, setFactsPinnedOnly] = useState(false);
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);

  const overviewRequestEpochRef = useRef(0);
  const diagnosticsRequestEpochRef = useRef(0);
  const diagnosticsExpandedRef = useRef(false);

  useEffect(() => {
    diagnosticsExpandedRef.current = diagnosticsExpanded;
  }, [diagnosticsExpanded]);

  useEffect(() => {
    if (!route.params?.tab && !routeQuery) return;
    setTab(resolveRouteTab(route.params?.tab));
    if (routeQuery) {
      setOverviewSearch(routeQuery);
      setFactsFilter(routeQuery);
    }
  }, [route.params?.tab, routeQuery]);

  const loadFacts = useCallback(() => {
    const subject = factsFilter.trim();
    const result = queryMemoryFactsForManagement({
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

  const loadEpisodes = useCallback(() => {
    try {
      setEpisodes(recallRecentEpisodes({ limit: 20 }));
    } catch {
      setEpisodes([]);
    }
  }, []);

  const loadOverviewFacts = useCallback((query: string) => {
    const subject = query.trim();
    const result = queryMemoryFactsForManagement({
      ...(subject ? { subject } : { all: true }),
      limit: 8,
    });
    if ('ok' in result && result.ok) {
      setOverviewFacts(result.facts);
    } else {
      setOverviewFacts([]);
    }
  }, []);

  const loadOverviewSnapshot = useCallback(async () => {
    const requestEpoch = overviewRequestEpochRef.current + 1;
    overviewRequestEpochRef.current = requestEpoch;
    try {
      const snapshot = loadMemoryOverviewSnapshot({ recentFactLimit: 8 });
      if (overviewRequestEpochRef.current === requestEpoch) setOverview(snapshot);
    } catch {
      if (overviewRequestEpochRef.current === requestEpoch) setOverview(null);
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const requestEpoch = diagnosticsRequestEpochRef.current + 1;
    diagnosticsRequestEpochRef.current = requestEpoch;
    const threadId = useChatStore.getState().activeConversationId;
    setDiagnosticsLoading(true);
    setDiagnosticsError(false);
    try {
      const snapshot = await loadMemoryDiagnosticsSnapshot({ threadId });
      if (
        diagnosticsRequestEpochRef.current === requestEpoch &&
        useChatStore.getState().activeConversationId === threadId
      ) {
        setDiagnostics(snapshot);
      }
    } catch {
      if (
        diagnosticsRequestEpochRef.current === requestEpoch &&
        useChatStore.getState().activeConversationId === threadId
      ) {
        setDiagnostics(null);
        setDiagnosticsError(true);
      }
    } finally {
      if (diagnosticsRequestEpochRef.current === requestEpoch) {
        setDiagnosticsLoading(false);
      }
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadOverviewSnapshot();
      loadFacts();
      loadEpisodes();
      setLastSyncedAt(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  }, [loadOverviewSnapshot, loadFacts, loadEpisodes]);

  const refreshVisibleMemory = useCallback(async () => {
    await refreshMemory();
    if (diagnosticsExpandedRef.current) await loadDiagnostics();
  }, [loadDiagnostics, refreshMemory]);

  useEffect(() => {
    if (tab !== 'overview') return;
    void loadOverviewSnapshot();
    loadOverviewFacts(overviewSearch);
  }, [tab, overviewSearch, loadOverviewSnapshot, loadOverviewFacts]);

  useEffect(() => {
    void refreshMemory();
  }, [refreshMemory]);

  useFocusEffect(
    useCallback(() => {
      void refreshVisibleMemory();
      return undefined;
    }, [refreshVisibleMemory]),
  );

  useEffect(() => {
    const unsubscribe = subscribeToMemoryChanges((event) => {
      void loadOverviewSnapshot();
      if (tab === 'overview') {
        loadOverviewFacts(overviewSearch);
      }
      loadFacts();
      loadEpisodes();
      if (diagnosticsExpandedRef.current) void loadDiagnostics();
      setLastSyncedAt(event.updatedAt);
    });

    return unsubscribe;
  }, [loadDiagnostics, loadOverviewSnapshot, loadOverviewFacts, loadFacts, loadEpisodes, tab, overviewSearch]);

  const handleClearAll = useCallback(() => {
    Alert.alert(t('memory.clearTitle'), t('memory.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('memory.clearAction'),
        style: 'destructive',
        onPress: () => {
          resetCanonicalMemoryForManagement();
          void refreshVisibleMemory();
          setLastSyncedAt(Date.now());
        },
      },
    ]);
  }, [refreshVisibleMemory, t]);

  const handleToggleDiagnostics = useCallback(() => {
    if (diagnosticsExpanded) {
      setDiagnosticsExpanded(false);
      return;
    }
    setDiagnosticsExpanded(true);
    void loadDiagnostics();
  }, [diagnosticsExpanded, loadDiagnostics]);

  // Re-query when facts filter / pinned toggle changes.
  useEffect(() => {
    if (tab !== 'facts') return;
    loadFacts();
    loadEpisodes();
  }, [tab, loadFacts, loadEpisodes]);

  const handleFactToggleStar = useCallback(
    (fact: FactRow) => {
      const result = fact.pinned
        ? setMemoryFactPinnedForManagement({ factId: fact.id }, false)
        : setMemoryFactPinnedForManagement({ factId: fact.id }, true);
      if ('ok' in result && result.ok) {
        loadFacts();
      }
    },
    [loadFacts],
  );

  const handleFactForget = useCallback(
    (fact: FactRow) => {
      Alert.alert(t('memory.factForgetTitle'), t('memory.factForgetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('memory.factForget'),
          style: 'destructive',
          onPress: () => {
            try {
              const result = forgetMemoryFactForManagement({ factId: fact.id });
              if ('ok' in result && result.ok) {
                loadFacts();
                return;
              }
            } catch {
              // The user-facing alert below is deliberately content-free.
            }
            Alert.alert(t('memory.factForgetFailedTitle'), t('memory.factForgetFailedMessage'));
          },
        },
      ]);
    },
    [loadFacts, t],
  );

  const memoryStatus = isRefreshing
    ? t('memory.refreshing')
    : lastSyncedAt
      ? t('memory.lastSynced', { time: new Date(lastSyncedAt).toLocaleTimeString() })
      : t('memory.notSyncedYet');

  return (
    <MemoryScreenView
      colors={colors}
      diagnostics={diagnostics}
      diagnosticsError={diagnosticsError}
      diagnosticsExpanded={diagnosticsExpanded}
      diagnosticsLoading={diagnosticsLoading}
      episodes={episodes}
      facts={facts}
      factsFilter={factsFilter}
      factsPinnedOnly={factsPinnedOnly}
      handleBack={handleBack}
      handleClearAll={handleClearAll}
      handleFactForget={handleFactForget}
      handleFactToggleStar={handleFactToggleStar}
      loadFacts={loadFacts}
      loadOverviewFacts={loadOverviewFacts}
      memoryStatus={memoryStatus}
      onToggleDiagnostics={handleToggleDiagnostics}
      overview={overview}
      overviewFacts={overviewFacts}
      overviewSearch={overviewSearch}
      refreshMemory={refreshVisibleMemory}
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
