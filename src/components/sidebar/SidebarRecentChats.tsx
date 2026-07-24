import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Conversation } from '../../types/conversation';
import type { AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { getNavigableConversations } from '../../utils/conversationNavigation';
import { ConversationNavigationRow } from '../conversations/ConversationNavigationRow';

type SidebarRecentChatsProps = {
  activeConversationId: string | null;
  colors: AppPalette;
  conversations: ReadonlyArray<Conversation>;
  limit?: number;
  onSeeAll: () => void;
  onSelect: (conversationId: string) => void;
};

export const SidebarRecentChats: React.FC<SidebarRecentChatsProps> = ({
  activeConversationId,
  colors,
  conversations,
  limit = 3,
  onSeeAll,
  onSelect,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigableConversations = useMemo(
    () => getNavigableConversations(conversations),
    [conversations],
  );
  const recentConversations = navigableConversations.slice(0, limit);

  return (
    <View style={styles.section} testID="sidebar-recent-chats">
      <View style={styles.header}>
        <Text style={styles.heading}>{t('nav.recentChats')}</Text>
        {navigableConversations.length > 0 ? (
          <TouchableOpacity
            accessibilityLabel={t('nav.seeAllChats')}
            accessibilityRole="button"
            onPress={onSeeAll}
            style={styles.seeAllButton}
            testID="sidebar-see-all-chats"
          >
            <Text style={styles.seeAllText}>{t('nav.seeAllChats')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {recentConversations.length === 0 ? (
        <Text style={styles.emptyText}>{t('nav.noRecentChats')}</Text>
      ) : (
        recentConversations.map((conversation) => (
          <ConversationNavigationRow
            key={conversation.id}
            colors={colors}
            conversation={conversation}
            onPress={() => onSelect(conversation.id)}
            selected={conversation.id === activeConversationId}
            testID={`sidebar-recent-chat-${conversation.id}`}
          />
        ))
      )}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    section: {
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    header: {
      minHeight: 40,
      paddingLeft: 16,
      paddingRight: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heading: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    seeAllButton: {
      minHeight: 48,
      paddingHorizontal: 8,
      justifyContent: 'center',
    },
    seeAllText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    emptyText: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      color: colors.textTertiary,
      fontSize: 13,
    },
  });
