import { Platform, StyleSheet } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';

export const CHAT_COMMAND_SUGGESTION_ROW_HEIGHT = 56;
export const CHAT_COMMAND_SUGGESTION_VISIBLE_ROWS = 4;
export const CHAT_COMPOSER_INPUT_MAX_HEIGHT = 120;

export const createChatInputStyles = (colors: AppPalette, bottomInset: number) =>
  StyleSheet.create({
    container: {
      position: 'relative',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'visible',
      paddingBottom: Math.max(bottomInset, Platform.OS === 'ios' ? 6 : 8),
      shadowColor: '#000',
      shadowOpacity: Platform.OS === 'ios' ? 0.12 : 0,
      shadowOffset: { width: 0, height: -4 },
      shadowRadius: 12,
      elevation: 10,
    },
    voiceOverlayLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: Math.max(bottomInset, Platform.OS === 'ios' ? 6 : 8) + 56,
      zIndex: 3,
      elevation: 3,
    },
    editingBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.border,
    },
    editingLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 6,
    },
    attachBtn: {
      minWidth: 44,
      minHeight: 44,
      padding: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
    },
    attachBtnDisabled: {
      opacity: 0.45,
    },
    voiceBtnActive: {
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
    },
    input: {
      flex: 1,
      backgroundColor: colors.inputBackground,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
      maxHeight: CHAT_COMPOSER_INPUT_MAX_HEIGHT,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    sendBtn: {
      minWidth: 44,
      minHeight: 44,
      padding: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
    },
    sendBtnActive: {
      opacity: 1,
    },
    sendBtnDisabled: {
      opacity: 0.45,
    },
    suggestionsContainer: {
      maxHeight: CHAT_COMMAND_SUGGESTION_ROW_HEIGHT * CHAT_COMMAND_SUGGESTION_VISIBLE_ROWS,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    suggestionsList: {
      maxHeight: CHAT_COMMAND_SUGGESTION_ROW_HEIGHT * CHAT_COMMAND_SUGGESTION_VISIBLE_ROWS,
    },
    suggestionsListContent: {
      paddingVertical: 4,
    },
    voiceErrorBanner: {
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 12,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    voiceErrorText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '600',
    },
    suggestionItem: {
      minHeight: CHAT_COMMAND_SUGGESTION_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 10,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.subtleBorder || colors.border,
    },
    suggestionItemSelected: {
      borderLeftColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    suggestionName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
      fontFamily: 'monospace',
      minWidth: 80,
    },
    suggestionNameSelected: {
      color: colors.text,
    },
    suggestionDesc: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });

export type ChatInputStyles = ReturnType<typeof createChatInputStyles>;
