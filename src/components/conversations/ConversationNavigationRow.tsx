import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, GitBranch, MessageCircle } from 'lucide-react-native';
import type { Conversation } from '../../types/conversation';
import type { AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

type ConversationNavigationRowProps = {
  colors: AppPalette;
  conversation: Conversation;
  onPress: () => void;
  selected: boolean;
  testID: string;
};

export const ConversationNavigationRow: React.FC<ConversationNavigationRowProps> = ({
  colors,
  conversation,
  onPress,
  selected,
  testID,
}) => {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const title = conversation.title.trim() || t('nav.newConversation');
  const sideThreadLabel = conversation.isSideThread ? t('nav.sideThread') : null;

  return (
    <TouchableOpacity
      accessibilityLabel={sideThreadLabel ? `${title}, ${sideThreadLabel}` : title}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.row, selected ? styles.rowSelected : null]}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        {conversation.isSideThread ? (
          <GitBranch size={17} color={selected ? colors.primary : colors.textSecondary} />
        ) : (
          <MessageCircle size={17} color={selected ? colors.primary : colors.textSecondary} />
        )}
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, selected ? styles.titleSelected : null]} numberOfLines={2}>
          {title}
        </Text>
        {sideThreadLabel ? <Text style={styles.subtitle}>{sideThreadLabel}</Text> : null}
      </View>
      {selected ? <Check size={17} color={colors.primary} /> : null}
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
    subtitle: {
      marginTop: 1,
      color: colors.textTertiary,
      fontSize: 11,
    },
  });
