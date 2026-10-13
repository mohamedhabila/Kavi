import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, MessageCircle, MoreHorizontal } from 'lucide-react-native';
import type { Conversation } from '../../types/conversation';
import type { AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

type ConversationNavigationRowProps = {
  /** The row is being removed: its actions give way to a progress indicator. */
  busy?: boolean;
  colors: AppPalette;
  conversation: Conversation;
  /** Opens this conversation's actions; the row shows an options button when set. */
  onOpenActions?: () => void;
  onPress: () => void;
  selected: boolean;
  testID: string;
};

export const ConversationNavigationRow: React.FC<ConversationNavigationRowProps> = ({
  busy = false,
  colors,
  conversation,
  onOpenActions,
  onPress,
  selected,
  testID,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const title = conversation.title.trim() || t('nav.newConversation');

  return (
    <TouchableOpacity
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={busy ? { selected, busy } : { selected }}
      {...(busy ? { disabled: true } : {})}
      onLongPress={onOpenActions}
      onPress={onPress}
      style={[styles.row, selected ? styles.rowSelected : null]}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        <MessageCircle size={17} color={selected ? colors.primary : colors.textSecondary} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, selected ? styles.titleSelected : null]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {selected ? <Check size={17} color={colors.primary} /> : null}
      {busy ? (
        <View
          accessibilityLabel={t('conversationActions.deleting')}
          style={styles.actionsButton}
          testID={`${testID}-busy`}
        >
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : onOpenActions ? (
        <TouchableOpacity
          accessibilityLabel={t('conversationActions.menuAccessibility', { title })}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onOpenActions}
          style={styles.actionsButton}
          testID={`${testID}-actions`}
        >
          <MoreHorizontal size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    row: {
      minHeight: 48,
      marginHorizontal: 8,
      marginVertical: 1,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    rowSelected: {
      backgroundColor: colors.primarySoft,
    },
    iconWrap: {
      width: 24,
      alignItems: 'center',
    },
    textWrap: {
      flex: 1,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 18,
    },
    titleSelected: {
      color: colors.primary,
      fontWeight: '600',
    },
    actionsButton: {
      width: 40,
      height: 40,
      marginEnd: -6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
    },
  });
