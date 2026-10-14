// ---------------------------------------------------------------------------
// Kavi — Memory screen
// ---------------------------------------------------------------------------
// What Kavi remembers about the user, newest first: search it, pin what should always be
// in mind, forget an item, or clear everything.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Trash2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackIcon } from '../components/navigation/DirectionalIcons';
import { getLocaleBcp47Tag } from '../i18n/localeBcp47';
import { useTranslation } from '../i18n/useTranslation';
import { useBackToChat } from '../navigation/useBackToChat';
import { subscribeToMemoryChanges } from '../services/memory/changeNotifications';
import { clearAllMemory } from '../services/memory/core/memoryCapture';
import {
  forgetMemoryItem,
  listMemoryItems,
  searchMemoryItems,
  setMemoryItemPinned,
  type MemoryItem,
} from '../services/memory/core/memoryItemsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppTheme } from '../theme/useAppTheme';
import { createLogger } from '../utils/logger';
import { MemoryItemCard } from './memory/MemoryItemCard';
import { createMemoryScreenStyles } from './memory/memoryScreenStyles';

const logger = createLogger('MemoryScreen');
const LISTED_ITEM_LIMIT = 200;
const SEARCHED_ITEM_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 150;

function readItems(query: string): MemoryItem[] {
  const trimmed = query.trim();
  return trimmed
    ? searchMemoryItems({ query: trimmed, limit: SEARCHED_ITEM_LIMIT, includeSensitive: true })
    : listMemoryItems({ limit: LISTED_ITEM_LIMIT, offset: 0 });
}

export const MemoryScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const { t, locale } = useTranslation();
  const route = useRoute<any>();
  const handleBack = useBackToChat();
  const styles = useMemo(() => createMemoryScreenStyles(colors), [colors]);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(getLocaleBcp47Tag(locale), { dateStyle: 'medium' }),
    [locale],
  );
  const memoryOff = useSettingsStore((state) => state.disableLongTermMemory === true);
  const routeQuery = typeof route.params?.query === 'string' ? route.params.query : '';

  const [query, setQuery] = useState(routeQuery);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(() => {
    try {
      setItems(readItems(query));
      setLoadFailed(false);
    } catch (error) {
      logger.warn('Could not read memory items.', { error: String(error) });
      setItems([]);
      setLoadFailed(true);
    }
  }, [query]);

  useEffect(() => {
    if (routeQuery) setQuery(routeQuery);
  }, [routeQuery]);

  useEffect(() => {
    const timeout = setTimeout(reload, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [reload]);

  // Coming back to the screen reloads the current search. The focus effect reads it through a
  // ref: a focus effect re-runs whenever its callback changes, which would search on every
  // keystroke and defeat the debounce above.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      reloadRef.current();
      return undefined;
    }, []),
  );

  useEffect(() => subscribeToMemoryChanges(reload), [reload]);

  const handleTogglePin = useCallback(
    (item: MemoryItem) => {
      let changed = false;
      try {
        changed = setMemoryItemPinned(item.id, !item.pinned, Date.now());
      } catch (error) {
        logger.warn('Could not change a memory pin.', { error: String(error) });
      }
      if (!changed) Alert.alert(t('memory.pinFailedTitle'), t('memory.retryMessage'));
      reload();
    },
    [reload, t],
  );

  const handleForget = useCallback(
    (item: MemoryItem) => {
      Alert.alert(t('memory.forgetTitle'), t('memory.forgetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('memory.forget'),
          style: 'destructive',
          onPress: () => {
            let forgotten = false;
            try {
              forgotten = forgetMemoryItem(item.id);
            } catch (error) {
              logger.warn('Could not forget a memory item.', { error: String(error) });
            }
            if (!forgotten) Alert.alert(t('memory.forgetFailedTitle'), t('memory.retryMessage'));
            reload();
          },
        },
      ]);
    },
    [reload, t],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(t('memory.clearTitle'), t('memory.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('memory.clearAction'),
        style: 'destructive',
        onPress: () => {
          try {
            clearAllMemory();
          } catch (error) {
            logger.warn('Could not clear memory.', { error: String(error) });
            Alert.alert(t('memory.clearFailedTitle'), t('memory.retryMessage'));
          }
          reload();
        },
      },
    ]);
  }, [reload, t]);

  const emptyText = loadFailed
    ? t('memory.loadFailed')
    : query.trim()
      ? t('memory.searchEmpty')
      : t('memory.empty');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          onPress={handleBack}
          style={styles.headerButton}
        >
          <BackIcon size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('memory.title')}</Text>
        <TouchableOpacity
          accessibilityLabel={t('memory.clearTitle')}
          accessibilityRole="button"
          onPress={handleClearAll}
          style={styles.headerButton}
          testID="memory-clear-all"
        >
          <Trash2 size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>
      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel={t('memory.searchPlaceholder')}
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={t('memory.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          style={styles.search}
          testID="memory-search"
          value={query}
        />
        {memoryOff ? <Text style={styles.notice}>{t('memory.memoryOff')}</Text> : null}
        <Text style={styles.statusLine}>{t('memory.count', { count: items.length })}</Text>
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <MemoryItemCard
            colors={colors}
            item={item}
            onForget={handleForget}
            onTogglePin={handleTogglePin}
            savedOn={dateFormat.format(item.updatedAt)}
            styles={styles}
            t={t}
          />
        )}
        testID="memory-items"
      />
    </SafeAreaView>
  );
};
