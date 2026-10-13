import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTranslation } from '../../i18n/useTranslation';
import type { AppPalette } from '../../theme/useAppTheme';

type ConversationRenameDialogProps = {
  colors: AppPalette;
  initialTitle: string;
  onCancel: () => void;
  onSave: (title: string) => void;
  visible: boolean;
};

/**
 * A cross-platform rename prompt. `Alert.prompt` exists only on iOS, so the title is
 * edited in an in-app dialog that behaves the same on both platforms.
 *
 * The input sets no `maxLength`: it counts UTF-16 units, which stopped an emoji title at
 * half the limit and could split a surrogate pair on Android. `renameConversation` bounds
 * the saved title by graphemes.
 */
export function ConversationRenameDialog(props: ConversationRenameDialogProps) {
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(props.colors), [props.colors]);
  const [draft, setDraft] = useState(props.initialTitle);
  const canSave = draft.trim().length > 0;

  useEffect(() => {
    if (props.visible) setDraft(props.initialTitle);
  }, [props.initialTitle, props.visible]);

  const save = () => {
    if (canSave) props.onSave(draft);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={props.onCancel}
      statusBarTranslucent
      transparent
      visible={props.visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel={t('common.cancel')}
          accessibilityRole="button"
          onPress={props.onCancel}
          style={styles.backdrop}
          testID="conversation-rename-backdrop"
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('conversationActions.renameTitle')}
          </Text>
          <TextInput
            accessibilityLabel={t('conversationActions.renamePlaceholder')}
            autoFocus
            onChangeText={setDraft}
            onSubmitEditing={save}
            placeholder={t('conversationActions.renamePlaceholder')}
            placeholderTextColor={props.colors.textTertiary}
            returnKeyType="done"
            selectTextOnFocus
            style={styles.input}
            testID="conversation-rename-input"
            value={draft}
          />
          <View style={styles.buttons}>
            <TouchableOpacity
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              onPress={props.onCancel}
              style={styles.button}
              testID="conversation-rename-cancel"
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t('common.save')}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              onPress={save}
              style={[styles.button, styles.saveButton, canSave ? null : styles.saveDisabled]}
              testID="conversation-rename-save"
            >
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: colors.overlay,
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    card: {
      width: '100%',
      maxWidth: 420,
      gap: 16,
      padding: 20,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    input: {
      minHeight: 48,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      color: colors.text,
      fontSize: 15,
      backgroundColor: colors.inputBackground,
    },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    button: {
      minWidth: 88,
      minHeight: 44,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    saveButton: { backgroundColor: colors.primary },
    saveDisabled: { opacity: 0.5 },
    cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    saveText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
  });
