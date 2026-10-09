import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Pencil, Trash2, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '../../i18n/useTranslation';
import type { AppPalette } from '../../theme/useAppTheme';

export type ConversationAction = 'rename' | 'delete';

type ConversationActionsSheetProps = {
  colors: AppPalette;
  onChoose: (action: ConversationAction) => void;
  onClose: () => void;
  /** Called once the sheet has finished closing (iOS reports this; see the hook). */
  onDismissed: () => void;
  title: string;
  visible: boolean;
};

/** What can be done to one conversation, as an in-app sheet that closes from Back too. */
export function ConversationActionsSheet(props: ConversationActionsSheetProps) {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(props.colors), [props.colors]);
  const actions: ReadonlyArray<{
    action: ConversationAction;
    label: string;
    Icon: typeof Pencil;
    destructive: boolean;
  }> = [
    { action: 'rename', label: t('conversationActions.rename'), Icon: Pencil, destructive: false },
    { action: 'delete', label: t('conversationActions.delete'), Icon: Trash2, destructive: true },
  ];

  return (
    <Modal
      animationType="slide"
      onDismiss={props.onDismissed}
      onRequestClose={props.onClose}
      statusBarTranslucent
      transparent
      visible={props.visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={t('common.cancel')}
          accessibilityRole="button"
          onPress={props.onClose}
          style={styles.backdrop}
          testID="conversation-actions-backdrop"
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
              {props.title}
            </Text>
            <TouchableOpacity
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              onPress={props.onClose}
              style={styles.close}
              testID="conversation-actions-close"
            >
              <X size={22} color={props.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {actions.map(({ action, label, Icon, destructive }) => (
            <TouchableOpacity
              accessibilityLabel={label}
              accessibilityRole="button"
              key={action}
              onPress={() => props.onChoose(action)}
              style={styles.row}
              testID={`conversation-action-${action}`}
            >
              <View style={[styles.rowIcon, destructive ? styles.rowIconDestructive : null]}>
                <Icon size={20} color={destructive ? props.colors.danger : props.colors.primary} />
              </View>
              <Text style={[styles.rowTitle, destructive ? styles.rowTitleDestructive : null]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
    backdrop: { ...StyleSheet.absoluteFillObject },
    sheet: {
      gap: 8,
      paddingTop: 8,
      paddingHorizontal: 12,
      paddingBottom: 8,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.surface,
    },
    handle: {
      width: 36,
      height: 4,
      alignSelf: 'center',
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingStart: 8 },
    title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
    close: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 24,
    },
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
    },
    rowIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
      backgroundColor: colors.primarySoft,
    },
    rowIconDestructive: { backgroundColor: colors.dangerSoft },
    rowTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
    rowTitleDestructive: { color: colors.danger },
  });
