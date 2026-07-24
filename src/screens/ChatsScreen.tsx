import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Menu, Search } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { useChatStore } from '../store/useChatStore';
import { useAppTheme, type AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import {
  filterConversationsByTitle,
  getNavigableConversations,
} from '../utils/conversationNavigation';
import { ConversationNavigationRow } from '../components/conversations/ConversationNavigationRow';

export const ChatsScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const setActiveConversation = useChatStore((state) => state.setActiveConversation);
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const hasSearchQuery = query.trim().length > 0;
  const navigableConversations = useMemo(
    () => getNavigableConversations(conversations),
    [conversations],
  );
  const visibleConversations = useMemo(
    () => filterConversationsByTitle(navigableConversations, query),
    [navigableConversations, query],
  );

  const openConversation = useCallback(
    (conversationId: string) => {
      if (!navigableConversations.some((conversation) => conversation.id === conversationId)) {
        return;
      }
      setActiveConversation(conversationId);
      navigation.navigate('Chat');
    },
    [navigableConversations, navigation, setActiveConversation],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t('chat.openMenu')}
          accessibilityRole="button"
          onPress={() => navigation.openDrawer()}
          style={styles.headerButton}
          testID="chats-open-menu"
        >
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('nav.chats')}</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel={t('nav.searchChats')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder={t('nav.searchChats')}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          style={styles.searchInput}
          testID="chats-search"
          value={query}
        />
      </View>

      <FlatList
        contentContainerStyle={
          visibleConversations.length === 0 ? styles.emptyListContent : styles.listContent
        }
        data={visibleConversations}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(conversation) => conversation.id}
        renderItem={({ item }) => (
          <ConversationNavigationRow
            colors={colors}
            conversation={item}
            onPress={() => openConversation(item.id)}
            selected={item.id === activeConversationId}
            testID={`chats-conversation-${item.id}`}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState} testID="chats-empty-state">
            <Text style={styles.emptyTitle}>
              {hasSearchQuery ? t('nav.noChatMatches') : t('nav.chatsEmptyTitle')}
            </Text>
            <Text style={styles.emptyHint}>
              {hasSearchQuery ? t('nav.noChatMatchesHint') : t('nav.chatsEmptyHint')}
            </Text>
            <TouchableOpacity
              accessibilityLabel={hasSearchQuery ? t('nav.clearChatSearch') : t('nav.assistant')}
              accessibilityRole="button"
              onPress={() => {
                if (hasSearchQuery) {
                  setQuery('');
                  return;
                }
                navigation.navigate('Chat');
              }}
              style={styles.assistantButton}
              testID={hasSearchQuery ? 'chats-clear-search' : 'chats-open-assistant'}
            >
              <Text style={styles.assistantButtonText}>
                {hasSearchQuery ? t('nav.clearChatSearch') : t('nav.assistant')}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      minHeight: 56,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    searchWrap: {
      minHeight: 48,
      margin: 12,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      minHeight: 46,
      color: colors.text,
      fontSize: 15,
    },
    listContent: {
      paddingBottom: 24,
    },
    emptyListContent: {
      flexGrow: 1,
    },
    emptyState: {
      flex: 1,
      paddingHorizontal: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptyHint: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    assistantButton: {
      minHeight: 48,
      marginTop: 16,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    assistantButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
