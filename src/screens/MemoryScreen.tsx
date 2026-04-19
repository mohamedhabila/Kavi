// ---------------------------------------------------------------------------
// Kavi — Memory Viewer / Editor Screen
// ---------------------------------------------------------------------------
// Lets users view, edit and manage persistent memory (MEMORY.md + daily).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Save, Trash2, FileText, Calendar, RefreshCw } from 'lucide-react-native';
import {
  getMemoryLastUpdatedAt,
  readGlobalMemory,
  writeGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
  clearAllMemory,
  subscribeToMemoryChanges,
} from '../services/memory/store';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import { useBackToChat } from '../navigation/useBackToChat';

type Tab = 'global' | 'daily';

export const MemoryScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const handleBack = useBackToChat();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [tab, setTab] = useState<Tab>('global');
  const [globalContent, setGlobalContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [dailyFiles, setDailyFiles] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailyContent, setDailyContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => getMemoryLastUpdatedAt());
  const [hasExternalGlobalUpdate, setHasExternalGlobalUpdate] = useState(false);

  const dirtyRef = useRef(false);
  const selectedDateRef = useRef<string | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

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

  const refreshMemory = useCallback(
    async (preserveDirty = true) => {
      setIsRefreshing(true);
      try {
        await Promise.all([loadGlobalMemory(preserveDirty), loadDailyList()]);
        setLastSyncedAt(Date.now());
      } finally {
        setIsRefreshing(false);
      }
    },
    [loadDailyList, loadGlobalMemory],
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
    });

    return unsubscribe;
  }, [loadDailyList, loadGlobalMemory]);

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
      ) : (
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
      )}
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
  });
}
