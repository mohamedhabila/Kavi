// ---------------------------------------------------------------------------
// Kavi — Memory Viewer / Editor Screen
// ---------------------------------------------------------------------------
// Lets users view, edit and manage persistent memory (MEMORY.md + daily).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  ArrowLeft,
  Save,
  Trash2,
  FileText,
  Calendar,
  RefreshCw,
  Brain,
  Layers,
  Pin,
  PinOff,
} from 'lucide-react-native';
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
  type MemoryRecallResult,
  type MemoryBlockReadResult,
} from '../services/memory/memoryTools';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import { useBackToChat } from '../navigation/useBackToChat';

type Tab = 'global' | 'daily' | 'facts' | 'blocks';

type FactRow = MemoryRecallResult['facts'][number];
type BlockRow = MemoryBlockReadResult['blocks'][number];

export const MemoryScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const route = useRoute<any>();
  const handleBack = useBackToChat();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const routeQuery = typeof route.params?.query === 'string' ? route.params.query.trim() : '';
  const routeTab = route.params?.tab === 'blocks' ? 'blocks' : 'facts';

  const [tab, setTab] = useState<Tab>(routeTab);
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
    if (route.params?.tab === 'blocks') {
      setTab('blocks');
      return;
    }
    setTab('facts');
    if (routeQuery) setFactsFilter(routeQuery);
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

  const refreshMemory = useCallback(
    async (preserveDirty = true) => {
      setIsRefreshing(true);
      try {
        await Promise.all([loadGlobalMemory(preserveDirty), loadDailyList()]);
        loadFacts();
        loadBlocks();
        setLastSyncedAt(Date.now());
      } finally {
        setIsRefreshing(false);
      }
    },
    [loadDailyList, loadGlobalMemory, loadFacts, loadBlocks],
  );

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
        loadFacts();
        loadBlocks();
        setLastSyncedAt(event.updatedAt);
      }
    });

    return unsubscribe;
  }, [loadDailyList, loadGlobalMemory, loadFacts, loadBlocks]);

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
  }, [tab, loadFacts]);

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
    <SafeAreaView style={styles.container}>
      {/* Header */}
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

      {/* Tabs */}
      <View style={styles.tabs}>
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
      </View>

      {/* Content */}
      {tab === 'global' ? (
        <View style={styles.editorContainer}>
          <Text style={styles.statsLine}>
            {dirty
              ? t('memory.statsLineDirty', { lines: lineCount, chars: charCount })
              : t('memory.statsLine', { lines: lineCount, chars: charCount })}
          </Text>
          <Text style={styles.statusLine}>{memoryStatus}</Text>
          {hasExternalGlobalUpdate ? (
            <View style={styles.noticeRow}>
              <Text style={styles.noticeText}>{t('memory.externalUpdate')}</Text>
              <TouchableOpacity onPress={() => void loadGlobalMemory(false)}>
                <Text style={styles.noticeAction}>{t('common.refresh')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <ScrollView style={styles.editorScroll} keyboardDismissMode="interactive">
            <TextInput
              style={styles.editor}
              value={globalContent}
              onChangeText={handleGlobalChange}
              multiline
              placeholder={t('memory.emptyHint')}
              placeholderTextColor={colors.placeholder}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ScrollView>
        </View>
      ) : tab === 'daily' ? (
        <ScrollView style={styles.dailyContainer}>
          <Text style={styles.statusLine}>{memoryStatus}</Text>
          {dailyFiles.length === 0 ? (
            <Text style={styles.emptyText}>{t('memory.noDailyFiles')}</Text>
          ) : (
            <>
              <View style={styles.dateList}>
                {dailyFiles.map((date) => (
                  <TouchableOpacity
                    key={date}
                    style={[styles.dateChip, selectedDate === date && styles.dateChipActive]}
                    onPress={() => void loadDailyContent(date)}
                  >
                    <Text
                      style={[
                        styles.dateChipText,
                        selectedDate === date && styles.dateChipTextActive,
                      ]}
                    >
                      {date}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedDate ? (
                <View style={styles.dailyViewer}>
                  <Text style={styles.dailyHeader}>{selectedDate}</Text>
                  <Text style={styles.dailyBody}>{dailyContent}</Text>
                </View>
              ) : (
                <Text style={styles.emptyText}>{t('memory.selectDate')}</Text>
              )}
            </>
          )}
        </ScrollView>
      ) : tab === 'facts' ? (
        <View style={styles.editorContainer} testID="memory-facts-tab">
          <View style={styles.factsToolbar}>
            <TextInput
              style={styles.factsSearch}
              value={factsFilter}
              onChangeText={setFactsFilter}
              placeholder={t('memory.factsSearchPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              testID="memory-facts-search"
            />
            <View style={styles.factsToggleRow}>
              <Text style={styles.statusLine}>{t('memory.factsPinnedOnly')}</Text>
              <Switch
                value={factsPinnedOnly}
                onValueChange={setFactsPinnedOnly}
                testID="memory-facts-pinned-toggle"
              />
            </View>
            <Text style={styles.statusLine}>
              {t('memory.factsCount', { count: facts.length })}
            </Text>
          </View>
          <ScrollView style={styles.editorScroll}>
            {facts.length === 0 ? (
              <Text style={styles.emptyText}>{t('memory.factsEmpty')}</Text>
            ) : (
              facts.map((fact) => (
                <View key={fact.id} style={styles.factRow} testID={`memory-fact-${fact.id}`}>
                  <Text style={styles.factSubject}>
                    {fact.subject} · {fact.predicate}
                  </Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                  <Text style={styles.factMeta}>
                    {t('memory.factMetaPrimary', {
                      scope: fact.scope,
                      confidence: Math.round(fact.confidence * 100),
                      importance: Math.round(fact.importance * 100),
                    })}
                  </Text>
                  <Text style={styles.factMeta}>
                    {fact.originConversationId
                      ? t('memory.factSourceConversation', { id: fact.originConversationId })
                      : t('memory.factSourceGlobal')}
                    {fact.lastRecalledAt
                      ? ` ${t('memory.factLastRecalled', {
                          date: new Date(fact.lastRecalledAt).toLocaleDateString(),
                        })}`
                      : ''}
                  </Text>
                  <View style={styles.factActions}>
                    <TouchableOpacity
                      onPress={() => handleFactToggleStar(fact)}
                      accessibilityLabel={
                        fact.pinned ? t('memory.factUnpin') : t('memory.factPin')
                      }
                      testID={`memory-fact-pin-${fact.id}`}
                    >
                      {fact.pinned ? (
                        <PinOff size={16} color={colors.primary} />
                      ) : (
                        <Pin size={16} color={colors.textSecondary} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleFactForget(fact)}
                      accessibilityLabel={t('memory.factForget')}
                      testID={`memory-fact-forget-${fact.id}`}
                    >
                      <Trash2 size={16} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      ) : (
        <ScrollView style={styles.editorContainer} testID="memory-blocks-tab">
          {blocks.length === 0 ? (
            <Text style={styles.emptyText}>{t('memory.blocksEmpty')}</Text>
          ) : (
            blocks.map((block) => {
              const draft = blockDrafts[block.label] ?? block.content;
              return (
                <View
                  key={block.label}
                  style={styles.blockCard}
                  testID={`memory-block-${block.label}`}
                >
                  <Text style={styles.factSubject}>{block.label}</Text>
                  <Text style={styles.statusLine}>{block.description}</Text>
                  <TextInput
                    style={[styles.editor, styles.blockEditor]}
                    value={draft}
                    onChangeText={(text) => handleBlockDraftChange(block.label, text)}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID={`memory-block-editor-${block.label}`}
                  />
                  <View style={styles.factActions}>
                    <Text style={styles.statusLine}>
                      {t('memory.blockChars', {
                        used: draft.length,
                        limit: block.charLimit,
                      })}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleBlockSave(block.label)}
                      accessibilityLabel={t('memory.blockSave')}
                      testID={`memory-block-save-${block.label}`}
                    >
                      <Save size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Text style={styles.attributionFooter} testID="memory-attribution-footer">
        {t('memory.attribution')}
      </Text>
    </SafeAreaView>
  );
};

function createStyles(colors: AppPalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, flex: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    dangerBtn: { padding: 4 },
    tabs: {
      flexDirection: 'row',
      marginHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      gap: 6,
    },
    tabActive: { backgroundColor: colors.primarySoft },
    tabText: { fontSize: 14, color: colors.textSecondary },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    editorContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    attributionFooter: {
      fontSize: 11,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.background,
    },
    statsLine: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    statusLine: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 10,
    },
    noticeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.warningBackground,
    },
    noticeText: {
      flex: 1,
      fontSize: 13,
      color: colors.warning,
    },
    noticeAction: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    editorScroll: { flex: 1 },
    editor: {
      fontSize: 14,
      color: colors.text,
      fontFamily: 'monospace',
      lineHeight: 20,
      padding: 12,
      backgroundColor: colors.surface,
      borderRadius: 8,
      minHeight: 400,
    },
    dailyContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    dateList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    dateChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    dateChipActive: { backgroundColor: colors.primary },
    dateChipText: { fontSize: 13, color: colors.text },
    dateChipTextActive: { color: '#fff' },
    dailyViewer: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 12,
    },
    dailyHeader: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    dailyBody: {
      fontSize: 14,
      color: colors.text,
      fontFamily: 'monospace',
      lineHeight: 20,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 40,
    },
    factsToolbar: {
      gap: 8,
      marginBottom: 8,
    },
    factsSearch: {
      fontSize: 14,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderRadius: 8,
    },
    factsToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
    },
    factRow: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      gap: 4,
    },
    factSubject: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    factValue: {
      fontSize: 14,
      color: colors.text,
    },
    factMeta: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    factActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 16,
      marginTop: 6,
    },
    blockCard: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
      gap: 6,
    },
    blockEditor: {
      minHeight: 120,
      marginTop: 4,
    },
  });
}
